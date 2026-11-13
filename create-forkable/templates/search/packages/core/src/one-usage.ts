// Counts the calls Search sends through One, per user per UTC day. Buffered in
// memory and written every few seconds, so the indexer's thousands of calls do
// not each cost a database write. Settings shows today and this month.

import { and, eq, gte, sql } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { oneUsage } from "./db/schema.js";

const pending = new Map<string, { db: Db; userId: string; day: string; calls: number; refused: number }>();
let timer: NodeJS.Timeout | null = null;
const FLUSH_MS = 5_000;

export const usageDay = (d = new Date()) => d.toISOString().slice(0, 10);

export function countOneCall(db: Db, userId: string, refused: boolean): void {
  const day = usageDay();
  const k = `${userId}|${day}`;
  const cur = pending.get(k) ?? { db, userId, day, calls: 0, refused: 0 };
  cur.calls++;
  if (refused) cur.refused++;
  pending.set(k, cur);
  if (!timer) {
    timer = setTimeout(() => { timer = null; void flushOneUsage(); }, FLUSH_MS);
    timer.unref?.();
  }
}

export async function flushOneUsage(): Promise<void> {
  const rows = [...pending.values()];
  pending.clear();
  for (const r of rows) {
    try {
      await r.db.insert(oneUsage).values({ userId: r.userId, day: r.day, calls: r.calls, refused: r.refused })
        .onConflictDoUpdate({ target: [oneUsage.userId, oneUsage.day], set: { calls: sql`${oneUsage.calls} + ${r.calls}`, refused: sql`${oneUsage.refused} + ${r.refused}` } });
    } catch { /* a count is never worth failing a call */ }
  }
}

/** Calls today and this calendar month (UTC). One's own billing month may start on another day. */
export async function oneUsageTotals(db: Db, userId: string, now = new Date()): Promise<{ today: number; month: number }> {
  await flushOneUsage();
  const today = usageDay(now);
  const monthStart = `${today.slice(0, 7)}-01`;
  const rows = await db.select({ day: oneUsage.day, calls: oneUsage.calls }).from(oneUsage).where(and(eq(oneUsage.userId, userId), gte(oneUsage.day, monthStart)));
  return { today: rows.filter((r) => r.day === today).reduce((a, r) => a + r.calls, 0), month: rows.reduce((a, r) => a + r.calls, 0) };
}
