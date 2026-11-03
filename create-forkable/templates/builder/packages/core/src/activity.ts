// The Activity ledger: one row per preview call (the dev check) and per
// call the platform makes for a project (catalog reads, the receipt tests).

import { and, desc, eq, inArray, lt } from "drizzle-orm";
import type { Bus } from "./bus.js";
import type { Db } from "./db/client.js";
import { activity } from "./db/schema.js";
import type { ActivityRow, ActivitySource, ReceiptSource } from "./types.js";

type Row = typeof activity.$inferSelect;

export function toActivity(r: Row): ActivityRow {
  return {
    id: r.id,
    projectId: r.projectId,
    at: r.at.toISOString(),
    platform: r.platform,
    actionId: r.actionId,
    title: r.title,
    method: r.method,
    path: r.path,
    source: r.source as ActivitySource,
    status: r.status,
    ok: r.ok,
    blockedByGrant: r.blockedByGrant,
    refusal: (r.refusal as ActivityRow["refusal"]) ?? null,
    ms: r.ms,
    turnId: r.turnId,
  };
}

export interface ActivityInput {
  platform?: string | null;
  actionId?: string | null;
  title?: string | null;
  method?: string | null;
  path?: string | null;
  source: ActivitySource;
  status?: number | null;
  ok?: boolean | null;
  blockedByGrant?: boolean | null;
  refusal?: { source: ReceiptSource; code: string; message?: string } | null;
  ms?: number | null;
  turnId?: string | null;
}

export class ActivityLedger {
  constructor(
    private db: Db,
    private bus: Bus,
  ) {}

  async record(projectId: string, row: ActivityInput): Promise<ActivityRow> {
    const [r] = await this.db
      .insert(activity)
      .values({
        projectId,
        platform: row.platform ?? null,
        actionId: row.actionId ?? null,
        title: row.title ?? null,
        method: row.method ?? null,
        path: row.path ?? null,
        source: row.source,
        status: row.status ?? null,
        ok: row.ok ?? null,
        blockedByGrant: row.blockedByGrant ?? null,
        refusal: row.refusal ?? null,
        ms: row.ms ?? null,
        turnId: row.turnId ?? null,
      })
      .returning();
    const out = toActivity(r!);
    this.bus.emit(projectId, { type: "activity", row: out });
    return out;
  }

  async list(projectId: string, before?: number, limit = 50): Promise<{ rows: ActivityRow[]; nextBefore: number | null }> {
    const where = before ? and(eq(activity.projectId, projectId), lt(activity.id, before)) : eq(activity.projectId, projectId);
    const rows = await this.db.select().from(activity).where(where).orderBy(desc(activity.id)).limit(limit + 1);
    const page = rows.slice(0, limit).map(toActivity);
    return { rows: page, nextBefore: rows.length > limit ? page[page.length - 1]!.id : null };
  }

  /** The newest refusals (rows that carry one). */
  async refusals(projectId: string, limit = 8): Promise<ActivityRow[]> {
    const rows = await this.db
      .select()
      .from(activity)
      .where(and(eq(activity.projectId, projectId), inArray(activity.source, ["one", "local", "held", "sample"])))
      .orderBy(desc(activity.id))
      .limit(200);
    return rows
      .map(toActivity)
      .filter((r) => r.refusal)
      .slice(0, limit);
  }
}
