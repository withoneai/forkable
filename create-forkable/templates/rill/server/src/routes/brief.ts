import { Hono } from "hono";
import { and, desc, eq, gt, or, isNull, sql } from "drizzle-orm";
import { askInbox, brief, newId, schema, todaysMeetings, writer, type BriefResponse, type Ctx } from "@rill/core";
import type { AppEnv } from "../deps.js";
import { badRequest, HttpError } from "../errors.js";
import { detectedEngines } from "./engines.js";
import { loadMailboxCtx, readJson } from "./lib.js";

export const briefRoutes = new Hono<AppEnv>();

/** YYYY-MM-DD in the mailbox's timezone (or the server's). */
export function localDate(timezone: string | null, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone ?? undefined, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

type BriefRow = typeof schema.briefs.$inferSelect;
async function toApi(ctx: Ctx, b: BriefRow): Promise<BriefResponse> {
  const today = await todaysMeetings(ctx, b.forDate);
  return {
    forDate: b.forDate, generatedAt: b.createdAt.toISOString(), kpis: b.kpis,
    lines: b.lines as BriefResponse["lines"], text: b.text, engine: b.engine, model: b.model,
    today: { meetings: today, invitesWaiting: today.filter((m) => m.needsRsvp).length, conflicts: [] },
  };
}

/** "next at 2:00 PM" for the first meeting still ahead, in the user's zone. */
function nextAt(today: { start: string; end: string }[], tz: string | null): string {
  const next = today.find((m) => new Date(m.end).getTime() > Date.now());
  if (!next) return today.length ? "all done for today" : "nothing on the calendar";
  return `next at ${new Date(next.start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz ?? undefined })}`;
}

/** Without a writer the brief is still useful: counts and lines from stored judgments. */
export async function codeOnlyBrief(ctx: Ctx, forDate: string): Promise<BriefResponse> {
  const { db, mailbox } = ctx;
  const open = and(eq(schema.threadState.mailboxId, mailbox.id), eq(schema.threadState.done, false),
    or(isNull(schema.threadState.snoozedUntil), sql`${schema.threadState.snoozedUntil} <= now()`));
  const rows = await db
    .select({ state: schema.threadState, subject: schema.threads.subject, lastMessageAt: schema.threads.lastMessageAt, participants: schema.threads.participants })
    .from(schema.threadState)
    .innerJoin(schema.threads, eq(schema.threads.id, schema.threadState.threadId))
    .where(open)
    .orderBy(desc(schema.threadState.priority), desc(schema.threads.lastMessageAt));
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const [screened] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.threadState)
    .where(and(eq(schema.threadState.mailboxId, mailbox.id), eq(schema.threadState.lane, "screener"), gt(schema.threadState.updatedAt, since)));
  const goals = await db.select().from(schema.goals).where(eq(schema.goals.mailboxId, mailbox.id));
  const goalTitle = new Map(goals.map((g) => [g.id, g.title]));

  const vips = rows.filter((r) => r.state.lane === "vip");
  const goalMoves = rows.filter((r) => r.state.goalId && r.state.lane === "goals");
  const replies = rows.filter((r) => r.state.needsReply && r.state.ball === "me");
  const followUps = rows.filter((r) => r.state.followUpAt && r.state.followUpAt <= new Date());

  const lines: BriefResponse["lines"] = [];
  for (const r of vips.slice(0, 5)) lines.push({ when: "VIP", title: r.subject, detail: r.state.summary ?? r.participants[0]?.name ?? "", tone: "warning", threadId: r.state.threadId });
  for (const r of goalMoves.slice(0, 5)) lines.push({ when: goalTitle.get(r.state.goalId!) ?? "Goal", title: r.subject, detail: r.state.summary ?? "", tone: "positive", threadId: r.state.threadId });
  for (const r of replies.slice(0, 5)) lines.push({ when: "Reply owed", title: r.subject, detail: r.state.ask ?? r.state.summary ?? "", tone: "neutral", threadId: r.state.threadId });
  for (const r of followUps.slice(0, 3)) lines.push({ when: "Follow up", title: r.subject, detail: "You wrote last and nobody answered.", tone: "neutral", threadId: r.state.threadId });

  const today = await todaysMeetings(ctx, forDate);
  return {
    forDate,
    generatedAt: new Date().toISOString(),
    kpis: [
      { label: "Meetings today", value: today.length, hint: nextAt(today, ctx.settings.timezone) },
      { label: "VIPs waiting", value: vips.length, hint: "Threads in the VIP lane" },
      { label: "Goal moves", value: goalMoves.length, hint: "Threads that move a goal" },
      { label: "Replies owed", value: replies.length, hint: "The ball is with you" },
      { label: "Screened out", value: Number(screened?.n ?? 0), hint: "First-time senders held back in the last day" },
    ],
    lines,
    text: "",
    engine: "none",
    model: "none",
    today: { meetings: today, invitesWaiting: today.filter((m) => m.needsRsvp).length, conflicts: [] },
  };
}

briefRoutes.get("/mailboxes/:id/brief", async (c) => {
  const { ctx, mailbox, db } = await loadMailboxCtx(c);
  const dateParam = c.req.query("date");
  if (dateParam && !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) throw badRequest("date must be YYYY-MM-DD");
  const forDate = dateParam ?? localDate(ctx.settings.timezone);

  const [cached] = await db.select().from(schema.briefs).where(and(eq(schema.briefs.mailboxId, mailbox.id), eq(schema.briefs.forDate, forDate))).limit(1);
  if (cached && c.req.query("refresh") !== "1") return c.json(await toApi(ctx, cached));

  const w = await writer.pickWriter(ctx, await detectedEngines(c.get("deps"), ctx.user.id)).catch(() => null);
  let result: BriefResponse;
  if (w) {
    result = await brief.build(ctx, w, forDate);
  } else {
    result = await codeOnlyBrief(ctx, forDate);
  }
  // Core persists its own brief; make sure a row exists either way (upsert on mailbox+date).
  await db.insert(schema.briefs).values({
    id: newId("brf"), mailboxId: mailbox.id, forDate, kpis: result.kpis, lines: result.lines, text: result.text, engine: result.engine, model: result.model,
  }).onConflictDoUpdate({
    target: [schema.briefs.mailboxId, schema.briefs.forDate],
    set: { kpis: result.kpis, lines: result.lines, text: result.text, engine: result.engine, model: result.model, createdAt: new Date() },
  });
  return c.json(result);
});

briefRoutes.post("/mailboxes/:id/ask", async (c) => {
  const { ctx } = await loadMailboxCtx(c);
  const { q } = await readJson<{ q?: string }>(c);
  if (!q || !q.trim()) throw badRequest("Ask something");
  const w = await writer.pickWriter(ctx, await detectedEngines(c.get("deps"), ctx.user.id)).catch(() => null);
  if (!w) throw new HttpError(503, "no_writer", "No writer is available. Pick an engine in Settings.");
  return c.json(await askInbox(ctx, w, q.trim()));
});
