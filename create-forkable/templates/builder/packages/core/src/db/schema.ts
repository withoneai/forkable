// Platform DB. Drizzle over embedded Postgres.

import { bigserial, boolean, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { FeedEvent, FileChange, Selection, Usage } from "../types.js";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

// users, sessions and connect_users held Builder's own Sign in with One,
// which per-project Connect retired (2026-10-25). Kept, unused, so an older
// database still opens; nothing reads or writes them now.
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  oneUserId: text("one_user_id"),
  email: text("email"),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
});

export const connectUsers = pgTable("connect_users", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  connectUserId: text("connect_user_id").notNull(),
  /** The package's userStore value (key mode): an identifier, not a credential. */
  reference: text("reference"),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/**
 * A Connect app the builder made in the One dashboard (per-project Connect).
 * Names and links only: the client id, secret, connect key and ask id live
 * in the environment store (scope connect:<id>), write-only. kind "project"
 * belongs to the project that made it (ownerProjectId); kind "template" is a
 * saved setup any project can link to or copy.
 */
export const connectSetups = pgTable("connect_setups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  ownerProjectId: text("owner_project_id"),
  /** Made by the keyless sample (stub One): never a real app. */
  sample: boolean("sample").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>(),
});

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    path: text("path").notNull(),
    templateVersion: text("template_version").notNull(),
    harness: text("harness").notNull(),
    model: text("model"),
    permission: text("permission").notNull().default("build"),
    autoFix: boolean("auto_fix").notNull().default(true),
    devPort: integer("dev_port"),
    relayTokenHash: text("relay_token_hash"),
    /** VisitorGrant: may visitors trigger owner-run actions (off by default; the agent cannot write it). */
    visitorGrant: jsonb("visitor_grant").$type<{ enabled: boolean; actions: string[] }>(),
    /** ProjectConnect: One Connect for this app (off by default), and which Connect app it uses. */
    oneConnect: jsonb("one_connect").$type<{ enabled: boolean; setupId: string | null; via: "new" | "template" | "project" | null }>(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    archivedAt: ts("archived_at"),
  },
  (t) => [uniqueIndex("projects_slug").on(t.slug)],
);

export const turns = pgTable(
  "turns",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    kind: text("kind").notNull(),
    parentTurnId: text("parent_turn_id"),
    fixAttempt: integer("fix_attempt").notNull().default(0),
    prompt: text("prompt").notNull(),
    selections: jsonb("selections").$type<Selection[]>().notNull().default([]),
    harness: text("harness").notNull(),
    model: text("model"),
    sessionId: text("session_id"),
    status: text("status").notNull(),
    exit: text("exit"),
    error: text("error"),
    usage: jsonb("usage").$type<Usage>().notNull().default({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }),
    costUsd: doublePrecision("cost_usd"),
    /** Claude: the session's running total after this turn, so the next resume reports a delta. */
    sessionCostUsd: doublePrecision("session_cost_usd"),
    text: text("text").notNull().default(""),
    createdAt: ts("created_at").notNull().defaultNow(),
    startedAt: ts("started_at"),
    endedAt: ts("ended_at"),
    checkpointSha: text("checkpoint_sha"),
  },
  (t) => [index("turns_project").on(t.projectId, t.createdAt)],
);

export const turnEvents = pgTable(
  "turn_events",
  {
    turnId: text("turn_id").notNull(),
    seq: integer("seq").notNull(),
    payload: jsonb("payload").$type<FeedEvent>().notNull(),
    at: ts("at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.turnId, t.seq] })],
);

export const checkpoints = pgTable(
  "checkpoints",
  {
    sha: text("sha").notNull(),
    projectId: text("project_id").notNull(),
    turnId: text("turn_id"),
    kind: text("kind").notNull(),
    subject: text("subject").notNull(),
    harness: text("harness"),
    files: jsonb("files").$type<FileChange[]>().notNull().default([]),
    additions: integer("additions").notNull().default(0),
    deletions: integer("deletions").notNull().default(0),
    shot: text("shot"),
    bookmarked: boolean("bookmarked").notNull().default(false),
    restoredFrom: text("restored_from"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.sha] })],
);

export const errors = pgTable(
  "errors",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    signature: text("signature").notNull(),
    source: text("source").notNull(),
    severity: text("severity").notNull().default("error"),
    file: text("file"),
    line: integer("line"),
    col: integer("col"),
    message: text("message").notNull(),
    stack: text("stack"),
    firstSeen: ts("first_seen").notNull().defaultNow(),
    lastSeen: ts("last_seen").notNull().defaultNow(),
    count: integer("count").notNull().default(1),
    turnId: text("turn_id"),
    resolvedAt: ts("resolved_at"),
  },
  (t) => [index("errors_project").on(t.projectId, t.signature)],
);

export const activity = pgTable(
  "activity",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    projectId: text("project_id").notNull(),
    at: ts("at").notNull().defaultNow(),
    platform: text("platform"),
    actionId: text("action_id"),
    title: text("title"),
    method: text("method"),
    path: text("path"),
    source: text("source").notNull(),
    status: integer("status"),
    ok: boolean("ok"),
    blockedByGrant: boolean("blocked_by_grant"),
    refusal: jsonb("refusal").$type<Record<string, unknown> | null>(),
    ms: integer("ms"),
    turnId: text("turn_id"),
  },
  (t) => [index("activity_project").on(t.projectId, t.at)],
);

export const publishes = pgTable("publishes", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  projectId: text("project_id").notNull(),
  target: text("target").notNull(),
  sha: text("sha").notNull(),
  status: text("status").notNull(),
  url: text("url"),
  repo: text("repo"),
  scan: jsonb("scan").$type<Record<string, unknown> | null>(),
  manifestHash: text("manifest_hash"),
  at: ts("at").notNull().defaultNow(),
  // What came back, what to reuse next time (never a token), the steps shown.
  result: jsonb("result").$type<Record<string, unknown> | null>(),
  options: jsonb("options").$type<Record<string, unknown> | null>(),
  steps: jsonb("steps").$type<Record<string, unknown>[] | null>(),
  error: text("error"),
  grant: text("grant"),
});

export const schema = { users, sessions, connectUsers, connectSetups, settings, projects, turns, turnEvents, checkpoints, errors, activity, publishes };
