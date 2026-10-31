// The app's own record of every call it made and why (SPEC 4.10). Indexer page calls
// roll up to one row per action per run.

import { and, desc, eq, lt, sql } from "drizzle-orm";
import type { LedgerActor, LedgerRow } from "./contract.js";
import type { Db } from "./db/client.js";
import { ledger as ledgerTable, oauthClients } from "./db/schema.js";
import { newId } from "./ids.js";
import { platformName } from "./platforms.js";

type Row = typeof ledgerTable.$inferSelect;
export type LedgerInsert = Omit<Row, "id" | "at"> & { at?: Date };

export function ledgerSentence(r: Pick<Row, "platform" | "action" | "status" | "ok" | "blockedByGrant" | "refusal" | "note">): string {
  const outcome = r.blockedByGrant ? `declined, ${r.status || 403}` : r.ok ? "ok" : r.refusal ? `${r.refusal.replace("_", " ")}, ${r.status}` : `failed, ${r.status}`;
  return `${platformName(r.platform)} · ${r.action}   ${outcome}`;
}

export function toLedgerRow(r: Row, clientName: string | null = null): LedgerRow {
  return {
    id: r.id, at: r.at.toISOString(), actor: r.actor, clientName, platform: r.platform, action: r.action,
    actionId: r.actionId, method: r.method, path: r.path, mode: r.mode, level: r.level, status: r.status,
    ok: r.ok, blockedByGrant: r.blockedByGrant, refusal: r.refusal, ms: r.ms, summary: r.summary, note: r.note,
    sentence: ledgerSentence(r),
  };
}

export async function recordLedger(db: Db, row: LedgerInsert): Promise<LedgerRow> {
  const [inserted] = await db.insert(ledgerTable).values({ id: newId("led"), ...row }).returning();
  return toLedgerRow(inserted!);
}

export interface LedgerQuery { limit?: number; actor?: LedgerActor; sourceId?: string; before?: string }

export async function listLedger(db: Db, userId: string, q: LedgerQuery = {}): Promise<LedgerRow[]> {
  const conds = [eq(ledgerTable.userId, userId)];
  if (q.actor) conds.push(eq(ledgerTable.actor, q.actor));
  if (q.sourceId) conds.push(eq(ledgerTable.sourceId, q.sourceId));
  if (q.before) conds.push(lt(ledgerTable.at, new Date(q.before)));
  const rows = await db
    .select({ l: ledgerTable, clientName: oauthClients.clientName })
    .from(ledgerTable)
    .leftJoin(oauthClients, eq(oauthClients.clientId, ledgerTable.clientId))
    .where(and(...conds))
    .orderBy(desc(ledgerTable.at), desc(ledgerTable.id))
    .limit(Math.max(1, Math.min(q.limit ?? 100, 1000)));
  return rows.map((r) => toLedgerRow(r.l, r.clientName));
}

/** Indexer rollup: one row per action per run, `calls` counted in the note. */
export class LedgerRollup {
  private rows = new Map<string, { row: LedgerInsert; calls: number; failed: number }>();
  add(row: LedgerInsert): void {
    const k = `${row.actionId}|${row.action}`;
    const cur = this.rows.get(k);
    if (!cur) { this.rows.set(k, { row: { ...row }, calls: 1, failed: row.ok ? 0 : 1 }); return; }
    cur.calls++;
    if (!row.ok) cur.failed++;
    cur.row.ms += row.ms;
    // the rolled-up row shows the worst outcome
    if (!row.ok || cur.row.ok) Object.assign(cur.row, { status: row.status, ok: cur.row.ok && row.ok, blockedByGrant: cur.row.blockedByGrant || row.blockedByGrant, refusal: row.refusal ?? cur.row.refusal });
  }
  async flush(db: Db): Promise<LedgerRow[]> {
    const out: LedgerRow[] = [];
    for (const { row, calls, failed } of this.rows.values()) {
      out.push(await recordLedger(db, { ...row, note: `${calls} call${calls === 1 ? "" : "s"}${failed ? `, ${failed} failed` : ""}${row.note ? `; ${row.note}` : ""}` }));
    }
    this.rows.clear();
    return out;
  }
  get size(): number { return this.rows.size; }
}

export async function ledgerCount(db: Db, userId: string): Promise<number> {
  const r = await db.select({ n: sql<number>`count(*)::int` }).from(ledgerTable).where(eq(ledgerTable.userId, userId));
  return r[0]?.n ?? 0;
}
