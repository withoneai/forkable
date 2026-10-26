import { and, eq, isNull, sql } from "drizzle-orm";
import { OneConnectError } from "@withone/connect/server";
import { calendar, schema, sync, type Ctx, type MailboxRow } from "@rill/core";
import { buildCtx } from "./ctx.js";
import type { CoreDeps } from "./deps.js";

const TICK_MS = 2 * 60 * 1000;

export interface Scheduler {
  start(): void;
  stop(): void;
  /** Runs the mailbox now (after creation, POST /sync, goal edits). Resolves when the run ends. */
  kick(mailboxId: string, opts?: { full?: boolean }): Promise<void>;
  isSyncing(mailboxId: string): boolean;
  /** Messages still waiting for a judgment. */
  judgingCount(mailboxId: string): Promise<number>;
}

export function createScheduler(deps: CoreDeps): Scheduler {
  const inFlight = new Map<string, Promise<void>>();
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  const log = (line: string) => console.log(`[rill] ${line}`);

  async function loadMailbox(mailboxId: string): Promise<{ mailbox: MailboxRow; ctx: Ctx } | null> {
    const [mailbox] = await deps.db.select().from(schema.mailboxes).where(eq(schema.mailboxes.id, mailboxId)).limit(1);
    if (!mailbox) return null;
    const [user] = await deps.db.select().from(schema.users).where(eq(schema.users.id, mailbox.userId)).limit(1);
    if (!user) return null;
    return { mailbox, ctx: await buildCtx(deps, mailbox, user) };
  }

  async function unjudged(mailboxId: string): Promise<number> {
    const [r] = await deps.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.messages)
      .where(and(eq(schema.messages.mailboxId, mailboxId), isNull(schema.messages.judgedAt), eq(schema.messages.isFromMe, false)));
    return Number(r?.n ?? 0);
  }

  /** A key-mode mailbox learns its own address from the most common recipient of inbound mail. */
  async function resolveAddress(mailbox: MailboxRow): Promise<void> {
    if (mailbox.address || mailbox.source !== "live") return;
    const [r] = await deps.db.execute<{ addr: string }>(sql`
      select lower(addr) as addr, count(*) as n
      from ${schema.messages}, jsonb_array_elements_text(${schema.messages.to}) as addr
      where ${schema.messages.mailboxId} = ${mailbox.id} and ${schema.messages.isFromMe} = false
      group by lower(addr) order by n desc limit 1`).then((res) => res.rows);
    if (r?.addr) {
      await deps.db.update(schema.mailboxes).set({ address: r.addr, label: r.addr }).where(eq(schema.mailboxes.id, mailbox.id));
    }
  }

  async function run(mailboxId: string, opts: { full?: boolean }): Promise<void> {
    const loaded = await loadMailbox(mailboxId);
    if (!loaded) return;
    const { mailbox, ctx } = loaded;
    if (mailbox.status !== "active") return;

    const emit = ctx.emit;
    try {
      if (mailbox.source === "sample") {
        await sync.syncMailbox(ctx, { full: opts.full });
        if ((await unjudged(mailbox.id)) > 0) await sync.judgePending(ctx);
        await calendar.syncCalendar(ctx);
        return;
      }
      emit({ type: "sync", phase: "start" });
      const r = await sync.syncMailbox(ctx, { full: opts.full });
      await deps.db.update(schema.mailboxes).set({ lastSyncAt: new Date() }).where(eq(schema.mailboxes.id, mailbox.id));
      await resolveAddress(mailbox);
      emit({ type: "sync", phase: "done", imported: r.imported });
      if (r.toJudge > 0 || (await unjudged(mailbox.id)) > 0) await sync.judgePending(ctx);
      if (mailbox.calendarProvider) await calendar.syncCalendar(ctx).catch((e) => log(`mailbox ${mailbox.id}: calendar sync failed: ${String((e as Error).message ?? e)}`));
    } catch (err) {
      if (err instanceof OneConnectError && err.code === "reconnect_required") {
        await deps.db.update(schema.mailboxes).set({ status: "reconnect_required" }).where(eq(schema.mailboxes.id, mailbox.id));
        emit({ type: "reconnect_required" });
        log(`mailbox ${mailbox.id}: grant gone, reconnect required`);
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      log(`mailbox ${mailbox.id}: sync failed: ${message}`);
      emit({ type: "sync", phase: "error", error: "Sync failed. Rill will try again." });
    }
  }

  function kick(mailboxId: string, opts: { full?: boolean } = {}): Promise<void> {
    const running = inFlight.get(mailboxId);
    if (running) return running;
    const p = run(mailboxId, opts).finally(() => inFlight.delete(mailboxId));
    inFlight.set(mailboxId, p);
    return p;
  }

  async function tick(): Promise<void> {
    if (stopped) return;
    const due = await deps.db
      .select()
      .from(schema.mailboxes)
      .where(and(eq(schema.mailboxes.source, "live"), eq(schema.mailboxes.status, "active")));
    for (const m of due) {
      if (!inFlight.has(m.id)) void kick(m.id);
    }
  }

  return {
    start() {
      stopped = false;
      if (timer) return;
      timer = setInterval(() => void tick().catch((e) => log(`tick failed: ${String(e)}`)), TICK_MS);
      timer.unref?.();
      void tick().catch((e) => log(`tick failed: ${String(e)}`));
    },
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
    kick,
    isSyncing: (id) => inFlight.has(id),
    judgingCount: unjudged,
  };
}
