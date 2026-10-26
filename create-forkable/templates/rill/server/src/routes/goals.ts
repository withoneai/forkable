import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import { newId, schema, sync, type ApiGoal, type GoalInput } from "@rill/core";
import type { AppEnv } from "../deps.js";
import { badRequest, notFound } from "../errors.js";
import { loadMailboxCtx, matched7d, readJson } from "./lib.js";

export const goalRoutes = new Hono<AppEnv>();

type GoalRow = typeof schema.goals.$inferSelect;
const toApi = (g: GoalRow, m: Map<string, number>): ApiGoal => ({
  id: g.id, title: g.title, detail: g.detail, weight: g.weight, paused: g.paused, position: g.position, matched7d: m.get(g.id) ?? 0,
});

function clampWeight(w: unknown, fallback: number): number {
  const n = typeof w === "number" ? w : Number(w);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(10, Math.round(n)));
}

goalRoutes.get("/mailboxes/:id/goals", async (c) => {
  const { mailbox, db } = await loadMailboxCtx(c);
  const [rows, m] = await Promise.all([
    db.select().from(schema.goals).where(eq(schema.goals.mailboxId, mailbox.id)).orderBy(schema.goals.position, schema.goals.createdAt),
    matched7d(db, mailbox.id, "goalId"),
  ]);
  return c.json(rows.map((g) => toApi(g, m)));
});

goalRoutes.post("/mailboxes/:id/goals", async (c) => {
  const { ctx, mailbox, db } = await loadMailboxCtx(c);
  const input = await readJson<GoalInput>(c);
  const title = input.title?.trim();
  if (!title) throw badRequest("A goal needs a title");
  const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${schema.goals.position}), -1)::int` }).from(schema.goals).where(eq(schema.goals.mailboxId, mailbox.id));
  const [row] = await db.insert(schema.goals).values({
    id: newId("goal"), mailboxId: mailbox.id, title, detail: input.detail?.trim() ?? "", weight: clampWeight(input.weight, 5),
    paused: !!input.paused, position: input.position ?? Number(max) + 1,
  }).returning();
  await sync.invalidateJudgments(ctx, "goals-changed");
  await sync.redecide(ctx);
  void c.get("deps").scheduler.kick(mailbox.id);
  return c.json(toApi(row!, new Map()), 201);
});

goalRoutes.put("/mailboxes/:id/goals/:goalId", async (c) => {
  const { ctx, mailbox, db } = await loadMailboxCtx(c);
  const [g] = await db.select().from(schema.goals).where(and(eq(schema.goals.id, c.req.param("goalId")), eq(schema.goals.mailboxId, mailbox.id))).limit(1);
  if (!g) throw notFound("Goal");
  const input = await readJson<Partial<GoalInput>>(c);
  const patch: Partial<GoalRow> = {};
  if (typeof input.title === "string") {
    if (!input.title.trim()) throw badRequest("A goal needs a title");
    patch.title = input.title.trim();
  }
  if (typeof input.detail === "string") patch.detail = input.detail.trim();
  if (input.weight !== undefined) patch.weight = clampWeight(input.weight, g.weight);
  if (typeof input.paused === "boolean") patch.paused = input.paused;
  if (typeof input.position === "number") patch.position = input.position;
  const [row] = await db.update(schema.goals).set(patch).where(eq(schema.goals.id, g.id)).returning();
  const textChanged = (patch.title !== undefined && patch.title !== g.title) || (patch.detail !== undefined && patch.detail !== g.detail);
  if (textChanged) {
    await sync.invalidateJudgments(ctx, "goals-changed");
    void c.get("deps").scheduler.kick(mailbox.id);
  }
  await sync.redecide(ctx);
  return c.json(toApi(row!, await matched7d(db, mailbox.id, "goalId")));
});

goalRoutes.delete("/mailboxes/:id/goals/:goalId", async (c) => {
  const { ctx, mailbox, db } = await loadMailboxCtx(c);
  const deleted = await db.delete(schema.goals).where(and(eq(schema.goals.id, c.req.param("goalId")), eq(schema.goals.mailboxId, mailbox.id))).returning({ id: schema.goals.id });
  if (deleted.length === 0) throw notFound("Goal");
  await db.update(schema.threadState).set({ goalId: null }).where(and(eq(schema.threadState.mailboxId, mailbox.id), eq(schema.threadState.goalId, deleted[0]!.id)));
  await sync.redecide(ctx);
  return c.body(null, 204);
});
