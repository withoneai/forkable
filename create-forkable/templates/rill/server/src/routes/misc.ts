import { Hono } from "hono";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { schema, type ApiSettings, type PaletteResponse, type SyncResponse, type Thresholds } from "@rill/core";
import type { AppEnv } from "../deps.js";
import { badRequest } from "../errors.js";
import { loadMailboxCtx, readJson } from "./lib.js";

export const miscRoutes = new Hono<AppEnv>();

miscRoutes.post("/mailboxes/:id/sync", async (c) => {
  const { mailbox } = await loadMailboxCtx(c);
  const { scheduler } = c.get("deps");
  if (scheduler.isSyncing(mailbox.id)) {
    return c.json({ error: { code: "already_syncing", message: "A sync is already running." }, started: false, reason: "already_syncing" }, 409);
  }
  if (mailbox.status !== "active") {
    const body: SyncResponse = { started: false, reason: mailbox.status };
    return c.json(body);
  }
  const full = c.req.query("full") === "1";
  void scheduler.kick(mailbox.id, { full });
  const body: SyncResponse = { started: true };
  return c.json(body);
});

miscRoutes.get("/mailboxes/:id/events", async (c) => {
  const { mailbox } = await loadMailboxCtx(c);
  return c.get("deps").hub.subscribe(c, mailbox.id);
});

miscRoutes.get("/mailboxes/:id/palette", async (c) => {
  const { mailbox, db } = await loadMailboxCtx(c);
  const q = (c.req.query("q") ?? "").trim();
  const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
  const vipRows = await db.select().from(schema.vips).where(eq(schema.vips.mailboxId, mailbox.id));
  const tierFor = (email: string) => {
    const e = email.toLowerCase();
    const d = e.split("@")[1] ?? "";
    return vipRows.find((v) => (v.matchKind === "address" && v.match.toLowerCase() === e) || (v.matchKind === "domain" && v.match.toLowerCase() === d))?.tier ?? null;
  };
  const senderRows = await db.select().from(schema.senders)
    .where(and(eq(schema.senders.mailboxId, mailbox.id), q ? or(ilike(schema.senders.email, like), ilike(schema.senders.name, like)) : undefined))
    .orderBy(desc(schema.senders.messageCount)).limit(8);
  const contacts: PaletteResponse["contacts"] = senderRows.map((s) => ({ name: s.name ?? s.email, email: s.email, vip: tierFor(s.email) }));
  for (const v of vipRows) {
    if (contacts.length >= 8) break;
    if (v.matchKind !== "address") continue;
    if (contacts.some((x) => x.email === v.match)) continue;
    if (q && !v.name.toLowerCase().includes(q.toLowerCase()) && !v.match.toLowerCase().includes(q.toLowerCase())) continue;
    contacts.push({ name: v.name, email: v.match, vip: v.tier });
  }

  const threadRows = await db
    .select({ id: schema.threads.id, subject: schema.threads.subject, participants: schema.threads.participants, lastMessageAt: schema.threads.lastMessageAt, lane: schema.threadState.lane })
    .from(schema.threads)
    .innerJoin(schema.threadState, eq(schema.threadState.threadId, schema.threads.id))
    .where(and(eq(schema.threads.mailboxId, mailbox.id), q ? or(ilike(schema.threads.subject, like), sql`${schema.threads.participants}::text ilike ${like}`) : undefined))
    .orderBy(desc(schema.threads.lastMessageAt)).limit(8);
  const body: PaletteResponse = {
    contacts,
    threads: threadRows.map((t) => ({ threadId: t.id, subject: t.subject, from: t.participants[0]?.name ?? t.participants[0]?.email ?? "", lane: t.lane, lastMessageAt: t.lastMessageAt.toISOString() })),
  };
  return c.json(body);
});

async function settingsBody(c: Parameters<typeof loadMailboxCtx>[0], s: typeof schema.settings.$inferSelect): Promise<ApiSettings> {
  const { db, dbInfo } = c.get("deps");
  const size = await db.execute<{ size: string }>(sql`select pg_database_size(current_database())::text as size`).then((r) => Number(r.rows[0]?.size ?? NaN)).catch(() => NaN);
  return {
    writerEngine: s.writerEngine, writerProvider: s.writerProvider, writerModel: s.writerModel,
    thresholds: s.thresholds, briefTime: s.briefTime, timezone: s.timezone,
    allowWrites: s.allowWrites, applyLabels: s.applyLabels, showImages: s.showImages, autoDraft: s.autoDraft, onboarded: s.onboarded, me: s.me,
    database: { kind: dbInfo.kind, url: dbInfo.url, sizeBytes: Number.isFinite(size) ? size : null, dataDir: dbInfo.dataDir },
    secondaryTimezone: s.secondaryTimezone, workingHours: s.workingHours, defaultCalendarId: s.defaultCalendarId, todayRail: s.todayRail, defaultConferencing: s.defaultConferencing ?? null,
  };
}

miscRoutes.get("/mailboxes/:id/settings", async (c) => {
  const { ctx } = await loadMailboxCtx(c);
  return c.json(await settingsBody(c, ctx.settings));
});

const THRESHOLD_KEYS: (keyof Thresholds)[] = ["quarantine", "strip", "needsReply", "goal", "check", "coldPitch"];

miscRoutes.put("/mailboxes/:id/settings", async (c) => {
  const { ctx, mailbox, db } = await loadMailboxCtx(c);
  const input = await readJson<Partial<ApiSettings>>(c);
  const patch: Partial<typeof schema.settings.$inferInsert> = { updatedAt: new Date() };
  if (input.writerEngine !== undefined) {
    if (input.writerEngine !== null && !["local", "one", "connect"].includes(input.writerEngine)) throw badRequest("writerEngine must be local, one or connect");
    patch.writerEngine = input.writerEngine;
  }
  if (input.writerProvider !== undefined) patch.writerProvider = input.writerProvider;
  if (input.writerModel !== undefined) patch.writerModel = input.writerModel;
  if (input.thresholds !== undefined) {
    const t: Partial<Thresholds> = {};
    for (const k of THRESHOLD_KEYS) {
      const v = input.thresholds[k];
      if (typeof v === "number" && v >= 0 && v <= 1) t[k] = v;
    }
    patch.thresholds = t;
  }
  if (typeof input.briefTime === "string") {
    if (!/^\d{2}:\d{2}$/.test(input.briefTime)) throw badRequest("briefTime must be HH:MM");
    patch.briefTime = input.briefTime;
  }
  if (input.timezone !== undefined) patch.timezone = input.timezone;
  for (const k of ["allowWrites", "applyLabels", "showImages", "autoDraft", "onboarded", "todayRail"] as const) {
    if (typeof input[k] === "boolean") patch[k] = input[k];
  }
  if (input.me !== undefined) patch.me = input.me;
  if (input.secondaryTimezone !== undefined) patch.secondaryTimezone = input.secondaryTimezone;
  if (input.defaultCalendarId !== undefined) patch.defaultCalendarId = input.defaultCalendarId;
  if (input.defaultConferencing !== undefined) {
    if (input.defaultConferencing !== null && !["google-meet", "teams", "zoom"].includes(input.defaultConferencing)) throw badRequest("defaultConferencing must be google-meet, teams, zoom or null");
    patch.defaultConferencing = input.defaultConferencing;
  }
  if (input.workingHours) {
    const wh = input.workingHours;
    if (!Array.isArray(wh.days) || typeof wh.startMinute !== "number" || typeof wh.endMinute !== "number") throw badRequest("workingHours needs days[], startMinute and endMinute");
    patch.workingHours = { days: wh.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6), startMinute: wh.startMinute, endMinute: wh.endMinute };
  }
  const [row] = await db.update(schema.settings).set(patch).where(eq(schema.settings.mailboxId, mailbox.id)).returning();
  void ctx;
  return c.json(await settingsBody(c, row!));
});
