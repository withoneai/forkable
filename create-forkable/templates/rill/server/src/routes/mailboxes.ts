import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { calendar, fixtures, newId, schema, sync, type MailboxRow } from "@rill/core";
import { buildCtx } from "../ctx.js";
import type { AppEnv, Deps } from "../deps.js";
import { HttpError } from "../errors.js";
import { currentUser } from "../session.js";
import { toApiMailbox } from "./lib.js";

export const mailboxRoutes = new Hono<AppEnv>();

const SAMPLE_LABEL = "Acme sample inbox";

/** The Acme inbox for a user, created and judged on first ask. Idempotent. */
export async function ensureSampleMailbox(deps: Deps, user: { id: string }): Promise<MailboxRow> {
  const { db, env } = deps;
  const [existing] = await db.select().from(schema.mailboxes)
    .where(and(eq(schema.mailboxes.userId, user.id), eq(schema.mailboxes.source, "sample"))).limit(1);
  if (existing) return existing;

  const inbox = fixtures.loadInbox(env.ROOT);
  const mailboxId = newId("mbx");
  const [mailbox] = await db.insert(schema.mailboxes).values({
    id: mailboxId, userId: user.id, source: "sample", mode: "fixture", label: SAMPLE_LABEL, address: inbox.address,
    mailProvider: "gmail", calendarProvider: "google-calendar",
  }).returning();
  if (!mailbox) throw new Error("could not create the sample mailbox");
  // The fixture calendar's events are all authored in America/Los_Angeles; pin the
  // sample's own timezone there so the demo reads correctly on any machine.
  // The sample reads every Gmail tab so the demo shows its newsletters and receipts; turn tabs off in Settings to watch them go.
  await db.insert(schema.settings).values({ mailboxId, me: inbox.me, onboarded: true, timezone: "America/Los_Angeles", mailCategories: ["primary", "promotions", "updates", "social", "forums"] }).onConflictDoNothing();

  // Fixture ids are kept when free so recordings line up; a second sample mailbox gets prefixed ids.
  const taken = new Set((await db.select({ id: schema.goals.id }).from(schema.goals)).map((r) => r.id));
  const takenVips = new Set((await db.select({ id: schema.vips.id }).from(schema.vips)).map((r) => r.id));
  if (inbox.goals.length) {
    await db.insert(schema.goals).values(inbox.goals.map((g, i) => ({
      id: taken.has(g.id) ? `${mailboxId}:${g.id}` : g.id, mailboxId, title: g.title, detail: g.detail, weight: g.weight, position: i,
    })));
  }
  if (inbox.vips.length) {
    await db.insert(schema.vips).values(inbox.vips.map((v) => ({
      id: takenVips.has(v.id) ? `${mailboxId}:${v.id}` : v.id, mailboxId, name: v.name, matchKind: v.matchKind, match: v.match, tier: v.tier, rules: (v.rules ?? {}) as Record<string, never>,
    })));
  }

  const [fullUser] = await db.select().from(schema.users).where(eq(schema.users.id, user.id)).limit(1);
  const ctx = await buildCtx(deps, mailbox, fullUser!);
  await sync.syncMailbox(ctx, { full: true });
  await sync.judgePending(ctx);
  await calendar.syncCalendar(ctx);
  const [fresh] = await db.select().from(schema.mailboxes).where(eq(schema.mailboxes.id, mailboxId)).limit(1);
  return fresh ?? mailbox;
}

mailboxRoutes.post("/mailboxes/sample", async (c) => {
  const deps = c.get("deps");
  const user = await currentUser(c, { create: true });
  const mailbox = await ensureSampleMailbox(deps, user!);
  return c.json(await toApiMailbox(deps.db, mailbox));
});
