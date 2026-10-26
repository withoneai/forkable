import { Hono } from "hono";
import { and, desc, eq, ne } from "drizzle-orm";
import { CALENDAR_SCOPES, GMAIL_SCOPES, OUTLOOK_CALENDAR_SCOPES, OUTLOOK_MAIL_SCOPES, ZOOM_SCOPES, calendarReceiptDemo, conferencing, getMailProvider, ledger, schema, type AccessResponse } from "@rill/core";
import { connectConfigured } from "../config.js";
import type { AppEnv } from "../deps.js";
import { badRequest, notFound } from "../errors.js";
import { loadMailboxCtx } from "./lib.js";

export const accessRoutes = new Hono<AppEnv>();

const RECEIPT_NOTE = "Hidden text in an email asked the assistant to delete the inbox";

accessRoutes.get("/mailboxes/:id/access", async (c) => {
  const { ctx, mailbox, user, db } = await loadMailboxCtx(c);
  const env = c.get("deps").env;
  const limit = Math.min(Number(c.req.query("limit") ?? 100) || 100, 500);
  const holder = mailbox.source === "sample"
    ? (mailbox.address ?? mailbox.label)
    : mailbox.mode === "connect"
      ? (user.email ?? mailbox.address ?? mailbox.label)
      : mailbox.label;
  const status: AccessResponse["grant"]["status"] =
    mailbox.status === "active" ? "active" : mailbox.status === "reconnect_required" ? "reconnect_required" : "revoked";
  const outlook = mailbox.mailProvider === "outlook-mail";
  const mailScopes = outlook ? OUTLOOK_MAIL_SCOPES : GMAIL_SCOPES;
  const calendarScopes = mailbox.calendarProvider === "outlook-calendar" ? OUTLOOK_CALENDAR_SCOPES : CALENDAR_SCOPES;
  const scopes = [
    ...mailScopes.map((s) => ({ action: s.action as string, level: s.level, granted: "granted" in s ? s.granted : true, why: s.why })),
    ...(mailbox.calendarProvider
      ? calendarScopes.map((s) => ({ action: s.action as string, level: s.level, granted: "granted" in s ? s.granted : true, why: s.why }))
      : [{ action: "calendar.connect", level: "read" as const, granted: false, why: `Connect ${outlook ? "Outlook Calendar" : "Google Calendar"} to see your day beside your mail` }]),
    ...((await conferencing.available(ctx)).available.includes("zoom") ? ZOOM_SCOPES.map((s) => ({ action: s.action, level: s.level, granted: true, why: s.why })) : []),
  ];
  const body: AccessResponse = {
    grant: {
      mode: mailbox.mode,
      holder,
      status,
      scopes,
      oneActivityUrl: connectConfigured(env) ? "https://app.withone.ai/connect/activity" : null,
    },
    // Replayed recordings are bookkeeping, not calls the user granted; keep them out of the trust screen.
    activity: (await ledger.list(db, mailbox.id, limit)).filter((r) => r.platform !== "recording"),
    today: await ledger.today(db, mailbox.id),
  };
  return c.json(body);
});

/** The receipt: an email's hidden text asked for a delete. Delete is never in the grant. */
accessRoutes.post("/mailboxes/:id/access/receipt-demo", async (c) => {
  const { ctx, mailbox, db } = await loadMailboxCtx(c);
  const [hidden] = await db.select().from(schema.messages)
    .where(and(eq(schema.messages.mailboxId, mailbox.id), ne(schema.messages.hiddenText, "")))
    .orderBy(desc(schema.messages.date)).limit(1);
  let target = hidden ?? null;
  if (!target) {
    const [q] = await db.select({ threadId: schema.threadState.threadId }).from(schema.threadState)
      .where(and(eq(schema.threadState.mailboxId, mailbox.id), eq(schema.threadState.screen, "quarantine")))
      .orderBy(desc(schema.threadState.updatedAt)).limit(1);
    if (q) {
      [target] = await db.select().from(schema.messages).where(eq(schema.messages.threadId, q.threadId)).orderBy(desc(schema.messages.date)).limit(1);
    }
  }
  if (!target) throw notFound("An email with hidden instructions");
  const row = await getMailProvider(ctx.mailbox.mailProvider).attemptDelete(ctx, target.gmailId, RECEIPT_NOTE);
  ctx.emit({ type: "ledger", row });
  return c.json(row);
});

/** The calendar receipt: Rill can answer invites and create events, but it cannot delete your meetings. */
accessRoutes.post("/mailboxes/:id/access/calendar-receipt-demo", async (c) => {
  const { ctx } = await loadMailboxCtx(c);
  const row = await calendarReceiptDemo(ctx);
  if (!row) throw notFound("A connected calendar with a synced event");
  ctx.emit({ type: "ledger", row });
  return c.json(row);
});

accessRoutes.get("/mailboxes/:id/ledger", async (c) => {
  const { mailbox, db } = await loadMailboxCtx(c);
  const limit = Number(c.req.query("limit") ?? 100);
  if (!Number.isFinite(limit) || limit < 1) throw badRequest("limit must be a positive number");
  return c.json(await ledger.list(db, mailbox.id, Math.min(limit, 1000)));
});

