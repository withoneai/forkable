import {
  boolean, index, integer, jsonb, pgTable, primaryKey, real, serial, text, timestamp, uniqueIndex,
} from "drizzle-orm/pg-core";
import type { MailCategory } from "../categories.js";
import type { Attendee, CalendarProviderKey, ChatBlocks, Decision, EventStatus, Judgment, MailProviderKey, RsvpResponse, Thresholds, VipRules, WorkingHours, ConferencingProvider } from "../types.js";

// One schema, local (embedded Postgres) or hosted (Hyperdrive + Neon).
// Ids are text: Gmail ids for threads/messages, random ids elsewhere.

export interface MailboxSyncState {
  historyId?: string;
  newestInternalDate?: string;
  initialImportDone?: boolean;
  lastError?: string | null;
  /** Set on the first failed Jev call, cleared on the next good one. Rill holds mail while it is set and only lets the writer judge after an hour, with drafting off. */
  jevDownSince?: string | null;
  /** The last reconcile: what the provider listed against what Rill has judged. */
  reconcile?: { at: string; listed: number; missing: number; requeued: number; stuck: number } | null;
}

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email"),
  oneUserId: text("one_user_id"),          // from /v1/users/whoami
  avatarUrl: text("avatar_url"),           // from /v1/users/me (One's profile picture)
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** rill_sid cookie -> user. The cookie is the session; nothing expires. */
export const sessions = pgTable("sessions", {
  sid: text("sid").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Key mode: the one string @withone/connect hands us per user. Stored as given. */
export const connectUsers = pgTable("connect_users", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  reference: text("reference").notNull(),
  connectUserId: text("connect_user_id"),  // cu_… parsed for the dedup lookup
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("connect_users_cu_idx").on(t.connectUserId)]);

export const mailboxes = pgTable("mailboxes", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  source: text("source").$type<"sample" | "live">().notNull(),
  mode: text("mode").$type<"fixture" | "connect" | "key">().notNull(),
  connectionKey: text("connection_key"),   // key mode (dev) or the granted connection's key
  address: text("address"),                // the mailbox address when known
  label: text("label").notNull(),          // "Acme sample inbox", "moe@…"
  status: text("status").$type<"active" | "reconnect_required" | "paused">().default("active").notNull(),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  syncState: jsonb("sync_state").$type<MailboxSyncState>().default({}).notNull(),
  /** Which MailProvider this mailbox talks through: "gmail", or "outlook-mail" when the grant reaches Outlook and no Gmail (fixture-verified, not yet on a real grant). */
  mailProvider: text("mail_provider").$type<MailProviderKey>().default("gmail").notNull(),
  /** null until the user connects a calendar. */
  calendarProvider: text("calendar_provider").$type<CalendarProviderKey>(),
  calendarConnectionKey: text("calendar_connection_key"),
  calendarSyncState: jsonb("calendar_sync_state").$type<{ lastError?: string | null }>().default({}).notNull(),
  calendarLastSyncAt: timestamp("calendar_last_sync_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const threads = pgTable("threads", {
  id: text("id").primaryKey(),             // `${mailboxId}:${gmailThreadId}`
  gmailId: text("gmail_id").notNull(),
  mailboxId: text("mailbox_id").notNull().references(() => mailboxes.id, { onDelete: "cascade" }),
  subject: text("subject").notNull(),
  snippet: text("snippet").default("").notNull(),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull(),
  messageCount: integer("message_count").default(1).notNull(),
  participants: jsonb("participants").$type<{ name: string; email: string }[]>().default([]).notNull(),
  historyId: text("history_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("threads_mailbox_idx").on(t.mailboxId, t.lastMessageAt)]);

export const messages = pgTable("messages", {
  id: text("id").primaryKey(),             // `${mailboxId}:${gmailMessageId}`
  gmailId: text("gmail_id").notNull(),
  threadId: text("thread_id").notNull().references(() => threads.id, { onDelete: "cascade" }),
  mailboxId: text("mailbox_id").notNull().references(() => mailboxes.id, { onDelete: "cascade" }),
  fromName: text("from_name").notNull(),
  fromEmail: text("from_email").notNull(),
  to: jsonb("to").$type<string[]>().default([]).notNull(),
  cc: jsonb("cc").$type<string[]>().default([]).notNull(),
  date: timestamp("date", { withTimezone: true }).notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),            // sanitized: quotes stripped, html to text
  rawBody: text("raw_body"),
  /** The message's own text/html part, fetched once from Gmail when the reader opens it. Null until then, or when the mail has no HTML part. */
  html: text("html"),
  hiddenText: text("hidden_text").default("").notNull(),
  snippet: text("snippet").default("").notNull(),
  labelIds: jsonb("label_ids").$type<string[]>().default([]).notNull(),
  isFromMe: boolean("is_from_me").default(false).notNull(),
  messageIdHeader: text("message_id_header"),
  judgedAt: timestamp("judged_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("messages_thread_idx").on(t.threadId, t.date), index("messages_mailbox_idx").on(t.mailboxId, t.judgedAt)]);

/** Every answer Jev (or the fallback) gave, one row per question per message. */
export const judgments = pgTable("judgments", {
  id: serial("id").primaryKey(),
  messageId: text("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  mailboxId: text("mailbox_id").notNull(),
  question: text("question").notNull(),
  label: text("label").notNull(),
  kind: text("kind").$type<Judgment["kind"]>().notNull(),
  answer: text("answer").notNull(),
  probability: real("probability").notNull(),
  confidence: real("confidence").notNull(),
  probabilities: jsonb("probabilities").$type<Record<string, number>>(),
  model: text("model").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("judgments_message_idx").on(t.messageId)]);

/** Where a thread sits and why. Recomputed from stored judgments when goals/weights change. */
export const threadState = pgTable("thread_state", {
  threadId: text("thread_id").primaryKey().references(() => threads.id, { onDelete: "cascade" }),
  mailboxId: text("mailbox_id").notNull(),
  lane: text("lane").$type<Decision["lane"]>().notNull(),
  rule: text("rule").notNull(),
  priority: integer("priority").default(0).notNull(),
  confidence: real("confidence").default(1).notNull(),
  check: boolean("check").default(false).notNull(),
  checkReason: text("check_reason"),
  goalId: text("goal_id"),
  vipId: text("vip_id"),
  needsReply: boolean("needs_reply").default(false).notNull(),
  ball: text("ball"),
  urgency: integer("urgency").default(0).notNull(),
  kind: text("kind"),
  screen: text("screen").$type<"pass" | "strip" | "quarantine">().default("pass").notNull(),
  summary: text("summary"),
  ask: text("ask"),
  done: boolean("done").default(false).notNull(),
  doneReason: text("done_reason"),
  snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
  replyLater: boolean("reply_later").default(false).notNull(),
  followUpAt: timestamp("follow_up_at", { withTimezone: true }),
  /** When a due follow-up last brought the thread back. Cleared when anyone writes again. */
  followUpShownAt: timestamp("follow_up_shown_at", { withTimezone: true }),
  judgedBy: text("judged_by"),              // jev | writer-fallback
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("thread_state_lane_idx").on(t.mailboxId, t.lane, t.done)]);

export const drafts = pgTable("drafts", {
  id: text("id").primaryKey(),
  threadId: text("thread_id").notNull().references(() => threads.id, { onDelete: "cascade" }),
  mailboxId: text("mailbox_id").notNull(),
  replyToMessageId: text("reply_to_message_id"),
  to: jsonb("to").$type<string[]>().default([]).notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  engine: text("engine").notNull(),         // local | one | connect | fixture
  model: text("model").notNull(),
  status: text("status").$type<"proposed" | "edited" | "saved" | "sent" | "discarded">().default("proposed").notNull(),
  gmailDraftId: text("gmail_draft_id"),
  validator: jsonb("validator").$type<{ ok: boolean; reasons: string[] }>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("drafts_thread_idx").on(t.threadId)]);

export const goals = pgTable("goals", {
  id: text("id").primaryKey(),
  mailboxId: text("mailbox_id").notNull().references(() => mailboxes.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  detail: text("detail").default("").notNull(),
  weight: integer("weight").default(5).notNull(),   // 0..10
  paused: boolean("paused").default(false).notNull(),
  position: integer("position").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const vips = pgTable("vips", {
  id: text("id").primaryKey(),
  mailboxId: text("mailbox_id").notNull().references(() => mailboxes.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  matchKind: text("match_kind").$type<"address" | "domain" | "description">().notNull(),
  match: text("match").notNull(),
  tier: text("tier").$type<"inner" | "key" | "team">().default("key").notNull(),
  rules: jsonb("rules").$type<VipRules>().default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Screener memory: let in or screened out once, remembered forever. */
export const senders = pgTable("senders", {
  mailboxId: text("mailbox_id").notNull().references(() => mailboxes.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  name: text("name"),
  status: text("status").$type<"unknown" | "let_in" | "screened_out">().default("unknown").notNull(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
  messageCount: integer("message_count").default(0).notNull(),
  iWroteToThem: boolean("i_wrote_to_them").default(false).notNull(),
}, (t) => [primaryKey({ columns: [t.mailboxId, t.email] })]);

export const calendars = pgTable("calendars", {
  id: text("id").primaryKey(),               // `${mailboxId}:${providerCalendarId}`
  providerId: text("provider_id").notNull(), // the provider's own calendar id
  mailboxId: text("mailbox_id").notNull().references(() => mailboxes.id, { onDelete: "cascade" }),
  provider: text("provider").$type<CalendarProviderKey>().notNull(),
  connectionKey: text("connection_key"),
  name: text("name").notNull(),
  color: text("color"),
  shown: boolean("shown").default(true).notNull(),
  countsForAvailability: boolean("counts_for_availability").default(true).notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  accessRole: text("access_role").$type<"owner" | "writer" | "reader" | "freeBusyReader">().default("owner").notNull(),
  syncState: text("sync_state").$type<"live" | "resyncing" | "reconnect_required">().default("live").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("calendars_mailbox_idx").on(t.mailboxId)]);

export const events = pgTable("events", {
  id: text("id").primaryKey(),                // `${calendarId}:${providerEventId}`
  providerId: text("provider_id").notNull(),  // the provider's own event id
  calendarId: text("calendar_id").notNull().references(() => calendars.id, { onDelete: "cascade" }),
  mailboxId: text("mailbox_id").notNull(),
  iCalUid: text("ical_uid"),
  recurringEventId: text("recurring_event_id"),
  title: text("title").default("(no title)").notNull(),
  description: text("description"),
  location: text("location"),
  start: timestamp("start", { withTimezone: true }).notNull(),
  end: timestamp("end", { withTimezone: true }).notNull(),
  timeZone: text("time_zone"),
  allDay: boolean("all_day").default(false).notNull(),
  status: text("status").$type<EventStatus>().default("confirmed").notNull(),
  organizer: jsonb("organizer").$type<{ name: string | null; email: string } | null>(),
  attendees: jsonb("attendees").$type<Attendee[]>().default([]).notNull(),
  joinUrl: text("join_url"),
  myResponse: text("my_response").$type<RsvpResponse>().default("needsAction").notNull(),
  updated: timestamp("updated", { withTimezone: true }).defaultNow().notNull(),
  /** Set when a sync detects start/end changed since the previous sync; cleared once the invite card has shown it once. */
  movedFrom: jsonb("moved_from").$type<{ start: string; end: string } | null>(),
  /** Set when the user changed the event in Rill. The sample sync leaves such rows alone instead of re-resolving them from the fixture. */
  editedAt: timestamp("edited_at", { withTimezone: true }),
  raw: jsonb("raw").$type<unknown>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("events_calendar_idx").on(t.calendarId, t.start),
  index("events_mailbox_idx").on(t.mailboxId, t.start),
  index("events_ical_uid_idx").on(t.iCalUid),
]);

/** Links an event to the email thread it came from (an ICS invite, or Jev's calendar classification). */
export const eventThreads = pgTable("event_threads", {
  eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  threadId: text("thread_id").notNull().references(() => threads.id, { onDelete: "cascade" }),
  source: text("source").$type<"ics" | "ical-uid" | "jev">().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.eventId, t.threadId] }), index("event_threads_thread_idx").on(t.threadId)]);

/** Phase C: a shareable booking link, one calendar's open slots behind a slug. */
export const bookingLinks = pgTable("booking_links", {
  id: text("id").primaryKey(),
  mailboxId: text("mailbox_id").notNull().references(() => mailboxes.id, { onDelete: "cascade" }),
  calendarId: text("calendar_id").notNull().references(() => calendars.id, { onDelete: "cascade" }),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  durationMinutes: integer("duration_minutes").default(30).notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("booking_links_slug_idx").on(t.slug)]);

/** Every call: platform, action, status, blockedByGrant, engine, cost. The app's own record of why. */
export const ledger = pgTable("ledger", {
  id: serial("id").primaryKey(),
  mailboxId: text("mailbox_id"),
  userId: text("user_id"),
  at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  platform: text("platform").notNull(),       // gmail | typesafe | anthropic | openai | gemini | claude-code | codex
  action: text("action").notNull(),           // get-threads, create-draft, systemone, messages, …
  method: text("method").notNull(),
  path: text("path").notNull(),
  mode: text("mode").$type<"fixture" | "connect" | "key" | "local">().notNull(),
  level: text("level").$type<"read" | "write">().notNull(),
  status: integer("status").notNull(),
  ok: boolean("ok").notNull(),
  blockedByGrant: boolean("blocked_by_grant").default(false).notNull(),
  refusal: text("refusal"),
  engine: text("engine"),
  model: text("model"),
  ms: integer("ms").default(0).notNull(),
  summary: text("summary").notNull(),
  note: text("note"),
  costUsd: real("cost_usd"),
}, (t) => [index("ledger_mailbox_idx").on(t.mailboxId, t.at)]);

export const settings = pgTable("settings", {
  mailboxId: text("mailbox_id").primaryKey().references(() => mailboxes.id, { onDelete: "cascade" }),
  writerEngine: text("writer_engine").$type<"local" | "one" | "connect">(),
  writerProvider: text("writer_provider"),
  writerModel: text("writer_model"),
  thresholds: jsonb("thresholds").$type<Partial<Thresholds>>().default({}).notNull(),
  briefTime: text("brief_time").default("07:30").notNull(),
  timezone: text("timezone"),
  allowWrites: boolean("allow_writes").default(false).notNull(),   // unused since key mode was removed; kept so the migration stays stable
  applyLabels: boolean("apply_labels").default(true).notNull(),
  /** Load remote images in the reader. Off shows placeholders and the "Images are blocked" banner. */
  showImages: boolean("show_images").default(true).notNull(),
  autoDraft: boolean("auto_draft").default(true).notNull(),
  onboarded: boolean("onboarded").default(false).notNull(),
  me: text("me"),                             // "Dana, CEO of Acme Inc": who Jev judges for
  secondaryTimezone: text("secondary_timezone"),
  workingHours: jsonb("working_hours").$type<WorkingHours>().default({ days: [1, 2, 3, 4, 5], startMinute: 540, endMinute: 1080 }).notNull(),
  defaultCalendarId: text("default_calendar_id"),
  defaultConferencing: text("default_conferencing").$type<ConferencingProvider>(),
  todayRail: boolean("today_rail").default(true).notNull(),
  /** Inbox tabs Rill reads: Gmail's Primary/Promotions/Updates/Social/Forums, Outlook's Focused ("primary") and Other. */
  mailCategories: jsonb("mail_categories").$type<MailCategory[]>().default(["primary"]).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const briefs = pgTable("briefs", {
  id: text("id").primaryKey(),
  mailboxId: text("mailbox_id").notNull().references(() => mailboxes.id, { onDelete: "cascade" }),
  forDate: text("for_date").notNull(),        // YYYY-MM-DD local
  kpis: jsonb("kpis").$type<{ label: string; value: number; hint: string }[]>().default([]).notNull(),
  lines: jsonb("lines").$type<{ when: string; title: string; detail: string; tone?: string; threadId?: string }[]>().default([]).notNull(),
  text: text("text").default("").notNull(),
  engine: text("engine").notNull(),
  model: text("model").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("briefs_mailbox_date_idx").on(t.mailboxId, t.forDate)]);

/** The inbox assistant: a chat per mailbox, scoped by whatever the user had open when they asked. */
export const chats = pgTable("chats", {
  id: text("id").primaryKey(),
  mailboxId: text("mailbox_id").notNull().references(() => mailboxes.id, { onDelete: "cascade" }),
  title: text("title").default("New chat").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("chats_mailbox_idx").on(t.mailboxId, t.updatedAt)]);

export const chatMessages = pgTable("chat_messages", {
  id: text("id").primaryKey(),
  chatId: text("chat_id").notNull().references(() => chats.id, { onDelete: "cascade" }),
  role: text("role").$type<"user" | "assistant" | "system">().notNull(),
  content: text("content").notNull(),
  blocks: jsonb("blocks").$type<ChatBlocks>().default({}).notNull(),
  engine: text("engine"),
  model: text("model"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("chat_messages_chat_idx").on(t.chatId, t.createdAt)]);

export const schema = {
  users, sessions, connectUsers, mailboxes, threads, messages, judgments, threadState, drafts, goals, vips, senders, ledger, settings, briefs, chats, chatMessages,
  calendars, events, eventThreads, bookingLinks,
};
