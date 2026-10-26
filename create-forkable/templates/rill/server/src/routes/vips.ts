import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { fixtures, getMailProvider, newId, schema, sync, type ApiVip, type OnboardingSuggestions, type VipInput, type VipRules } from "@rill/core";
import type { AppEnv } from "../deps.js";
import { badRequest, notFound } from "../errors.js";
import { loadMailboxCtx, matched7d, readJson } from "./lib.js";

export const vipRoutes = new Hono<AppEnv>();

type VipRow = typeof schema.vips.$inferSelect;
const KINDS = ["address", "domain", "description"] as const;
const TIERS = ["inner", "key", "team"] as const;
const toApi = (v: VipRow, m: Map<string, number>): ApiVip => ({
  id: v.id, name: v.name, matchKind: v.matchKind, match: v.match, tier: v.tier, rules: v.rules, matched7d: m.get(v.id) ?? 0,
});

function cleanRules(r: unknown): VipRules {
  if (!r || typeof r !== "object") return {};
  const o = r as Record<string, unknown>;
  const out: VipRules = {};
  if (typeof o.alwaysTop === "boolean") out.alwaysTop = o.alwaysTop;
  if (typeof o.notify === "boolean") out.notify = o.notify;
  if (typeof o.neverDraft === "boolean") out.neverDraft = o.neverDraft;
  if (o.replyWithinHours === null || typeof o.replyWithinHours === "number") out.replyWithinHours = o.replyWithinHours;
  if (o.followUpDays === null || typeof o.followUpDays === "number") out.followUpDays = o.followUpDays;
  return out;
}

vipRoutes.get("/mailboxes/:id/vips", async (c) => {
  const { mailbox, db } = await loadMailboxCtx(c);
  const [rows, m] = await Promise.all([
    db.select().from(schema.vips).where(eq(schema.vips.mailboxId, mailbox.id)).orderBy(schema.vips.createdAt),
    matched7d(db, mailbox.id, "vipId"),
  ]);
  return c.json(rows.map((v) => toApi(v, m)));
});

vipRoutes.post("/mailboxes/:id/vips", async (c) => {
  const { ctx, mailbox, db } = await loadMailboxCtx(c);
  const input = await readJson<VipInput>(c);
  const name = input.name?.trim();
  const match = input.match?.trim();
  if (!name || !match) throw badRequest("A VIP needs a name and what to match");
  if (!KINDS.includes(input.matchKind)) throw badRequest("matchKind must be address, domain or description");
  const tier = input.tier && TIERS.includes(input.tier) ? input.tier : "key";
  const [row] = await db.insert(schema.vips).values({
    id: newId("vip"), mailboxId: mailbox.id, name, matchKind: input.matchKind, match: input.matchKind === "description" ? match : match.toLowerCase(), tier, rules: cleanRules(input.rules),
  }).returning();
  await sync.redecide(ctx);
  if (input.matchKind === "description") {
    // A description VIP is a Jev question; the next judge pass asks it.
    await sync.invalidateJudgments(ctx, "vips-changed");
    void c.get("deps").scheduler.kick(mailbox.id);
  }
  return c.json(toApi(row!, new Map()), 201);
});

vipRoutes.put("/mailboxes/:id/vips/:vipId", async (c) => {
  const { ctx, mailbox, db } = await loadMailboxCtx(c);
  const [v] = await db.select().from(schema.vips).where(and(eq(schema.vips.id, c.req.param("vipId")), eq(schema.vips.mailboxId, mailbox.id))).limit(1);
  if (!v) throw notFound("VIP");
  const input = await readJson<Partial<VipInput>>(c);
  const patch: Partial<VipRow> = {};
  if (typeof input.name === "string" && input.name.trim()) patch.name = input.name.trim();
  if (input.matchKind !== undefined) {
    if (!KINDS.includes(input.matchKind)) throw badRequest("matchKind must be address, domain or description");
    patch.matchKind = input.matchKind;
  }
  if (typeof input.match === "string" && input.match.trim()) {
    const kind = patch.matchKind ?? v.matchKind;
    patch.match = kind === "description" ? input.match.trim() : input.match.trim().toLowerCase();
  }
  if (input.tier !== undefined) {
    if (!TIERS.includes(input.tier)) throw badRequest("tier must be inner, key or team");
    patch.tier = input.tier;
  }
  if (input.rules !== undefined) patch.rules = cleanRules(input.rules);
  const [row] = await db.update(schema.vips).set(patch).where(eq(schema.vips.id, v.id)).returning();
  await sync.redecide(ctx);
  return c.json(toApi(row!, await matched7d(db, mailbox.id, "vipId")));
});

vipRoutes.delete("/mailboxes/:id/vips/:vipId", async (c) => {
  const { ctx, mailbox, db } = await loadMailboxCtx(c);
  const deleted = await db.delete(schema.vips).where(and(eq(schema.vips.id, c.req.param("vipId")), eq(schema.vips.mailboxId, mailbox.id))).returning({ id: schema.vips.id });
  if (deleted.length === 0) throw notFound("VIP");
  await db.update(schema.threadState).set({ vipId: null }).where(and(eq(schema.threadState.mailboxId, mailbox.id), eq(schema.threadState.vipId, deleted[0]!.id)));
  await sync.redecide(ctx);
  return c.body(null, 204);
});

vipRoutes.post("/mailboxes/:id/vips/suggest", async (c) => {
  const { ctx } = await loadMailboxCtx(c);
  return c.json(await getMailProvider(ctx.mailbox.mailProvider).sentTo(ctx, 50));
});

vipRoutes.get("/mailboxes/:id/onboarding/suggestions", async (c) => {
  const { ctx } = await loadMailboxCtx(c);
  const body: OnboardingSuggestions = { goals: fixtures.suggestGoals(), vips: await getMailProvider(ctx.mailbox.mailProvider).sentTo(ctx, 8).catch(() => []) };
  return c.json(body);
});
