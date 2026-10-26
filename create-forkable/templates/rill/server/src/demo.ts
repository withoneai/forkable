import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { schema, type Db, type UserRow } from "@rill/core";

// Small queries the cli needs for `rill demo` and `rill record`, kept here so
// the cli depends on @rill/server and @rill/core only.

/** The "demo" user: one fixed row the cli reuses across runs. */
export async function ensureDemoUser(db: Db): Promise<UserRow> {
  const [existing] = await db.select().from(schema.users).where(eq(schema.users.id, "usr_demo")).limit(1);
  if (existing) return existing;
  const [u] = await db.insert(schema.users).values({ id: "usr_demo", name: "Dana Reyes", email: "dana@acme.com" }).returning();
  if (!u) throw new Error("could not create the demo user");
  return u;
}

/** The injection fixture: the newest inbound message carrying hidden text. */
export async function findInjectionMessage(db: Db, mailboxId: string) {
  const [m] = await db.select().from(schema.messages)
    .where(and(eq(schema.messages.mailboxId, mailboxId), eq(schema.messages.isFromMe, false), ne(schema.messages.hiddenText, "")))
    .orderBy(desc(schema.messages.date)).limit(1);
  return m ?? null;
}

/** Forget every judgment so judgePending asks again (recording). */
export async function resetJudgments(db: Db, mailboxId: string): Promise<void> {
  await db.update(schema.messages).set({ judgedAt: null }).where(eq(schema.messages.mailboxId, mailboxId));
}

export async function unjudgedCount(db: Db, mailboxId: string): Promise<number> {
  const rows = await db.select({ id: schema.messages.id }).from(schema.messages)
    .where(and(eq(schema.messages.mailboxId, mailboxId), isNull(schema.messages.judgedAt), eq(schema.messages.isFromMe, false)));
  return rows.length;
}

/** The most recently connected user (for `rill record`), or null. */
export async function latestConnectedUser(db: Db): Promise<UserRow | null> {
  const [row] = await db
    .select({ user: schema.users })
    .from(schema.connectUsers)
    .innerJoin(schema.users, eq(schema.users.id, schema.connectUsers.userId))
    .orderBy(desc(schema.connectUsers.createdAt))
    .limit(1);
  return row?.user ?? null;
}
