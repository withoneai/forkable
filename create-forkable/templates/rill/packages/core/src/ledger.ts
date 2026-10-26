import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { LedgerRow } from "./api-types.js";
import type { LedgerLayer } from "./contract.js";
import type { Db } from "./db/client.js";
import { ledger as ledgerTable } from "./db/schema.js";

// The app's own record of every call it made and why. One records the calls
// on its side; this table records the reason, the mode and the outcome, so the
// access screen can show "Gmail · delete   declined, 403" from local data.

type Row = typeof ledgerTable.$inferSelect;

export function toLedgerRow(r: Row): LedgerRow {
  return {
    id: r.id,
    at: r.at.toISOString(),
    platform: r.platform,
    action: r.action,
    method: r.method,
    path: r.path,
    mode: r.mode,
    level: r.level,
    status: r.status,
    ok: r.ok,
    blockedByGrant: r.blockedByGrant,
    refusal: r.refusal,
    engine: r.engine,
    model: r.model,
    ms: r.ms,
    summary: r.summary,
    note: r.note,
  };
}

export const ledger: LedgerLayer = {
  async record(db, row) {
    const [inserted] = await db
      .insert(ledgerTable)
      .values({
        mailboxId: row.mailboxId,
        userId: row.userId,
        platform: row.platform,
        action: row.action,
        method: row.method,
        path: row.path,
        mode: row.mode,
        level: row.level,
        status: row.status,
        ok: row.ok,
        blockedByGrant: row.blockedByGrant,
        refusal: row.refusal,
        engine: row.engine,
        model: row.model,
        ms: row.ms,
        summary: row.summary,
        note: row.note,
        costUsd: row.costUsd ?? null,
      })
      .returning();
    if (!inserted) throw new Error("ledger insert returned no row");
    return toLedgerRow(inserted);
  },

  async list(db, mailboxId, limit) {
    const rows = await db
      .select()
      .from(ledgerTable)
      .where(eq(ledgerTable.mailboxId, mailboxId))
      .orderBy(desc(ledgerTable.at), desc(ledgerTable.id))
      .limit(Math.max(1, Math.min(limit, 1000)));
    return rows.map(toLedgerRow);
  },

  async today(db, mailboxId) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const [r] = await db
      .select({
        calls: sql<number>`count(*)::int`,
        declined: sql<number>`count(*) filter (where ${ledgerTable.blockedByGrant} = true)::int`,
      })
      .from(ledgerTable)
      .where(and(eq(ledgerTable.mailboxId, mailboxId), gte(ledgerTable.at, start)));
    return { calls: Number(r?.calls ?? 0), declined: Number(r?.declined ?? 0) };
  },
};
