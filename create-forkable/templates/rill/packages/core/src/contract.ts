// Signatures every package codes against. packages/core implements them in
// the modules named in docs/CONTRACT.md and re-exports from index.ts. The
// server imports only through "@rill/core". Change here first, then both sides.
import type { OneConnectClient } from "@withone/connect/server";
import type { Db } from "./db/client.js";
import type { mailboxes, users, settings, goals, vips } from "./db/schema.js";
import type {
  ApiEvent, AskResponse, BriefResponse, EngineOption, LedgerRow, OnboardingSuggestions, SeriesEditScope, VipSuggestion,
} from "./api-types.js";
import type { Attendee, CalendarEvent, CalendarRecord, CallMode, Decision, EventStatus, Facts, FreeBusySlot, JevAnswers, Judgment, Mail, Platform, RsvpResponse, ThreadRecord, Thresholds, WriterEngine, ConferencingProvider } from "./types.js";

export type MailboxRow = typeof mailboxes.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type SettingsRow = typeof settings.$inferSelect;
export type GoalRow = typeof goals.$inferSelect;
export type VipRow = typeof vips.$inferSelect;

/** Everything a core function needs to act for one mailbox. */
export interface Ctx {
  db: Db;
  mailbox: MailboxRow;
  user: UserRow;
  settings: SettingsRow;
  /** The Connect client, when the app is configured for Connect. */
  oneConnect: OneConnectClient | null;
  env: RillEnv;
  /** Fires for live UI updates; the server wires it to SSE. */
  emit: (event: import("./api-types.js").MailboxEvent) => void;
}

/** No platform secret lives here. Every platform call runs on the signed-in user's Connect grant. */
export interface RillEnv {
  ONE_CLIENT_ID?: string;
  ONE_CLIENT_SECRET?: string;
  ONE_CONNECT_KEY?: string;
  ONE_REDIRECT_URI?: string;
  ONE_PERMISSION_SET?: string;
  AI_ENGINE?: string;
  AI_PROVIDER?: string;
  AI_MODEL?: string;
  JEV_MODEL?: string;
  RECORD?: string;
  /** true when running on the user's machine (npx, pnpm dev). Hosted sets false. */
  LOCAL: boolean;
  /** Repo root, for INBOX.md and fixtures/. */
  ROOT: string;
}

// ---- one.ts -----------------------------------------------------------------

export interface CallInput<Out, T = Out> {
  platform: Platform;
  /** Short action name for the ledger: get-threads, create-draft, systemone, messages … */
  action: string;
  level: "read" | "write";
  actionId: string;
  method: string;
  path: string;
  body?: unknown;
  pathParams?: Record<string, string | number | boolean>;
  query?: Record<string, string | string[]>;
  headers?: Record<string, string>;
  summary: string;
  /** Replayed on sample mailboxes, and for Jev/writer when recordings exist. */
  fixture: () => T | Promise<T>;
  pick?: (data: Out) => T;
  /** Which connection of the user's grant: the mailbox's Gmail, or the grant's connection for that platform (TypeSafe, LLMs). Default by platform. */
  credential?: "mailbox" | "grant";
}

/** What patchEvent sends. `current` is the event as Rill has it, so a fixture can answer with the patch applied. */
export interface EventPatch {
  title?: string;
  description?: string | null;
  location?: string | null;
  start?: string;
  end?: string;
  timeZone?: string;
  allDay?: boolean;
  /** Full list including you; replies carried over by the caller. */
  attendees?: Attendee[];
  status?: "cancelled";
  /** "google-meet" / "teams": the calendar makes the link. null: remove it. undefined: leave it. */
  conferencing?: ConferencingProvider | null;
  /** A third-party link to write (zoom), already created. */
  link?: { url: string; passcode: string | null; label: string } | null;
  notify?: "all" | "none";
  current: CalendarEvent;
}

export interface CallResultMeta { mode: CallMode; status: number; ok: boolean; blockedByGrant: boolean; refusal: string | null; ms: number }

export interface OneLayer {
  /** Resolves how a platform would be called for this mailbox, without calling. */
  modeFor(ctx: Ctx, platform: Platform, credential?: "mailbox" | "grant"): Promise<CallMode | "missing">;
  /** platform -> connection key the user's grant reaches (cached briefly). Empty when Connect is not configured or the user never connected. */
  grantedConnections(oneConnect: OneConnectClient | null, userId: string): Promise<Map<string, string>>;
  /** Drop the cached grant for a user (after connect, disconnect or reconnect_required). */
  forgetGrant(userId: string): void;
  /** Runs one platform call, writes one ledger row, returns the picked data. Throws BlockedByGrant on a 403 grant refusal. */
  call<Out, T = Out>(ctx: Ctx, input: CallInput<Out, T>): Promise<T>;
  /** Same as call but never throws on refusal; returns the ledger row (for the receipt demo). */
  attempt<Out>(ctx: Ctx, input: CallInput<Out, Out>): Promise<{ row: LedgerRow; data: Out | null; meta: CallResultMeta }>;
  /** Jev reachable for this mailbox: recordings for a sample, the user's TypeSafe connection for a live one. */
  jevAvailable(ctx: Ctx): Promise<boolean>;
}

export class BlockedByGrant extends Error {
  constructor(public readonly action: string, public readonly row: LedgerRow) { super(`${action} is outside what you granted this app in One`); }
}
export class NotConnected extends Error {
  constructor(public readonly platform: Platform) { super(`${platform} is not connected`); }
}

// ---- providers/ ---------------------------------------------------------------
//
// A provider is a mail or calendar account at one platform, reached through
// the user's Connect grant. Nothing above providers/ (sync.ts, judge.ts, the
// routes) knows which provider it is talking to: it asks the registry
// (providers/registry.ts) for "the mail provider" or "the calendar provider"
// for a mailbox, and calls the interface below. Each provider's own module
// maps its wire payloads into Rill's types (ThreadRecord, CalendarEvent, …)
// with pure functions, kept in a sibling `mappers.ts` so they can be unit
// tested against recorded payloads without a network call.

export interface ProviderInfo { platform: Platform; verified: boolean }

export interface MailProvider extends ProviderInfo {
  /** The address the connected mailbox sends as, from the provider itself. Sample: the mailbox's own address. */
  address?(ctx: Ctx): Promise<string | null>;
  /** Threads matching the query, newest first, with sanitized messages. Sample: fixtures. */
  listThreads(ctx: Ctx, opts: { query?: string; label?: string; max: number; pageToken?: string }): Promise<{ threads: ThreadRecord[]; nextPageToken?: string }>;
  /** Thread as of now (re-fetch). */
  getThread(ctx: Ctx, providerThreadId: string): Promise<ThreadRecord | null>;
  /** The HTML part of each message in the thread, keyed by the provider's message id. Messages without an HTML part are absent. */
  threadHtml(ctx: Ctx, providerThreadId: string): Promise<Record<string, string>>;
  ensureLabel(ctx: Ctx, name: string): Promise<string>;
  modifyThreadLabels(ctx: Ctx, providerThreadId: string, add: string[], remove: string[]): Promise<void>;
  /** `replyToMessageId` is the provider's own id of the message answered: Graph replies by message id, Gmail by thread and Message-ID header. */
  createDraft(ctx: Ctx, d: { to: string[]; subject: string; body: string; threadId?: string; inReplyTo?: string; replyToMessageId?: string }): Promise<{ gmailDraftId: string }>;
  send(ctx: Ctx, d: { to: string[]; subject: string; body: string; threadId?: string; inReplyTo?: string; replyToMessageId?: string }): Promise<{ messageId: string }>;
  /** The receipt demo: a delete call that is never in the grant. Returns the ledger row (403, blockedByGrant). */
  attemptDelete(ctx: Ctx, providerMessageId: string, note: string): Promise<LedgerRow>;
  /** Senders the user wrote to most, for VIP suggestions. */
  sentTo(ctx: Ctx, max: number): Promise<VipSuggestion[]>;
}

export interface CalendarProviderCapabilities { rsvp: boolean; create: boolean; patch: boolean; freeBusy: boolean; watch: boolean }

export interface CalendarProvider extends ProviderInfo {
  capabilities: CalendarProviderCapabilities;
  listCalendars(ctx: Ctx): Promise<CalendarRecord[]>;
  /** Events in [from, to), single instances expanded, newest changes last. */
  listEvents(ctx: Ctx, calendarId: string, opts: { from: string; to: string }): Promise<{ events: CalendarEvent[] }>;
  getEvent(ctx: Ctx, calendarId: string, eventId: string): Promise<CalendarEvent | null>;
  /** Patches the signed-in user's own attendee response; the organizer is notified by the provider. */
  rsvp(ctx: Ctx, calendarId: string, eventId: string, response: RsvpResponse, note?: string): Promise<CalendarEvent>;
  createEvent(ctx: Ctx, calendarId: string, input: { title: string; description?: string; location?: string; start: string; end: string; timeZone: string; attendees: string[]; attendeeNames?: Record<string, string>;
    /** "google-meet" or "teams": the calendar makes the link itself. "zoom": `link` carries one the server already created. */
    conferencing?: ConferencingProvider | null;
    link?: { url: string; passcode: string | null; label: string } | null;
  }): Promise<CalendarEvent>;
  patchEvent(ctx: Ctx, calendarId: string, eventId: string, patch: EventPatch, scope?: SeriesEditScope): Promise<CalendarEvent>;
  /** Free/busy for the signed-in user's own calendars only; never claims to know anyone else's. */
  freeBusy(ctx: Ctx, calendarIds: string[], from: string, to: string): Promise<Record<string, FreeBusySlot[]>>;
  /** The receipt demo: a delete call that is never in the grant. Returns the ledger row (403, blockedByGrant). */
  attemptDelete(ctx: Ctx, calendarId: string, eventId: string, note: string): Promise<LedgerRow>;
  /** Hosted push (Phase C): subscribe to changes. Returns the provider's channel/subscription id and expiry. Not available locally. */
  watch?(ctx: Ctx, calendarId: string, webhookUrl: string): Promise<{ channelId: string; resourceId?: string; expiresAt: string }>;
  stopWatch?(ctx: Ctx, channelId: string, resourceId?: string): Promise<void>;
}

// ---- jev.ts -----------------------------------------------------------------

export interface JevInput {
  me: string;
  goals: GoalRow[];
  vips: VipRow[];
  mail: Mail;
  thread: ThreadRecord;
  facts: Facts;
}

export interface JevLayer {
  buildRequest(input: JevInput, model: string): unknown;
  parse(raw: unknown, input: JevInput): JevAnswers;
  /** One request per message through One on the user's grant. Sample: recordings. Throws when unavailable. */
  judge(ctx: Ctx, input: JevInput): Promise<JevAnswers>;
  /** The typed answers as "Why it's here" rows. */
  toJudgments(answers: JevAnswers, input: JevInput): Judgment[];
  /** Rebuild JevAnswers from stored judgment rows (for re-deciding without Jev). */
  fromJudgments(rows: Judgment[], input: Pick<JevInput, "goals" | "vips">): JevAnswers | null;
  screenOf(answers: JevAnswers, thresholds: Thresholds): { screen: "pass" | "strip" | "quarantine"; reason: string | null };
}

// ---- policy.ts --------------------------------------------------------------

export interface DecideInput {
  facts: Facts;
  answers: JevAnswers | null;        // null when nothing judged yet
  goals: GoalRow[];
  vips: VipRow[];
  senderStatus: "unknown" | "let_in" | "screened_out";
  thresholds: Thresholds;
  judgedBy: "jev" | "writer-fallback" | null;
}

export interface Policy {
  lanes: { lane: Decision["lane"]; rule: string }[];
  source: string;
}

export interface PolicyLayer {
  compileInbox(markdown: string): Policy;
  loadPolicy(root: string): Policy;
  decide(policy: Policy, input: DecideInput): Decision;
}

// ---- writer -----------------------------------------------------------------

export interface WriterCompletion { text: string; model: string; costUsd: number | null; ms: number }

export interface Writer {
  engine: WriterEngine;
  provider: string;  // claude-code | codex | gemini-cli | anthropic | openai | gemini
  model: string;
  complete(ctx: Ctx, input: {
    system: string; user: string; json?: boolean; maxTokens?: number; summary: string;
    recordingKey?: { threadId: string; key: string };
    /** Called with each text chunk as it arrives. The local engine streams tokens; others (One, fixture) call it once with the whole text at the end. */
    stream?: (delta: string) => void;
  }): Promise<WriterCompletion>;
}

export interface Person { name: string; email: string; vipName: string | null; tier: string | null; recentSubjects: string[] }

export interface WriterLayer {
  /** `granted` = platforms the user's grant reaches; decides which "through One" rows are available. */
  detectEngines(env: RillEnv, granted?: string[]): Promise<EngineOption[]>;
  /** The writer to use for this mailbox, or null when none is usable (sample mailboxes always get a fixture writer). */
  pickWriter(ctx: Ctx, detected: EngineOption[]): Promise<Writer | null>;
  summarize(ctx: Ctx, w: Writer, mail: Mail, thread: ThreadRecord): Promise<{ summary: string; ask: string | null }>;
  draft(ctx: Ctx, w: Writer, input: { mail: Mail; thread: ThreadRecord; me: string; person: Person; goal: GoalRow | null; instructions?: string }): Promise<{ body: string; validator: { ok: boolean; reasons: string[] } }>;
  brief(ctx: Ctx, w: Writer, input: BriefInput): Promise<BriefResponse>;
  ask(ctx: Ctx, w: Writer, q: string, evidence: AskEvidence[]): Promise<AskResponse>;
  judgeFallback(ctx: Ctx, w: Writer, input: JevInput): Promise<JevAnswers>;
  prep(ctx: Ctx, w: Writer, input: MeetingPrepInput): Promise<import("./api-types.js").MeetingPrep>;
  validateDraft(text: string, inbound: string): { ok: boolean; reasons: string[] };
}

export interface MeetingPrepInput {
  title: string;
  start: string;
  attendees: { name: string | null; email: string; vip: { name: string; tier: import("./types.js").VipTier } | null; lastThread: { threadId: string; subject: string; lastMessageAt: string } | null; recentSubjects: string[] }[];
  goal: { id: string; title: string } | null;
}

export interface BriefInput {
  forDate: string;
  me: string;
  goals: GoalRow[];
  vipsWaiting: { threadId: string; subject: string; from: string; age: string; hasDraft: boolean }[];
  goalMoves: { goalTitle: string; threadId: string; subject: string; from: string; summary: string | null; confidence: number }[];
  repliesOwed: { threadId: string; subject: string; from: string; hasDraft: boolean }[];
  followUps: { threadId: string; subject: string; to: string; daysSilent: number }[];
  screenedOut: number;
  /** Today's meetings, in order, for the brief's Today section. Empty when no calendar is connected. */
  today: import("./types.js").EventSummary[];
}

export interface AskEvidence { threadId: string; subject: string; from: string; date: string; excerpt: string }

// ---- agents.ts --------------------------------------------------------------

export interface DetectedCli { id: "claude-code" | "codex" | "gemini-cli"; bin: string | null; version: string | null; signedIn: boolean | null }
export interface AgentsLayer {
  detect(): Promise<DetectedCli[]>;
  resolveBin(name: string): string | null;
}

// ---- ledger.ts --------------------------------------------------------------

export interface LedgerLayer {
  record(db: Db, row: Omit<LedgerRow, "id" | "at"> & { mailboxId: string | null; userId: string | null; costUsd?: number | null }): Promise<LedgerRow>;
  list(db: Db, mailboxId: string, limit: number): Promise<LedgerRow[]>;
  today(db: Db, mailboxId: string): Promise<{ calls: number; declined: number }>;
}

// ---- fixtures.ts ------------------------------------------------------------

export interface FixtureInbox {
  me: string;
  address: string;
  team_domain: string;
  goals: { id: string; title: string; detail: string; weight: number }[];
  vips: { id: string; name: string; matchKind: "address" | "domain" | "description"; match: string; tier: "inner" | "key" | "team"; rules?: Record<string, unknown> }[];
  threads: FixtureThread[];
}
export interface FixtureThread {
  id: string;
  subject: string;
  messages: {
    id: string;
    from: { name: string; email: string };
    to: string[];
    cc?: string[];
    minutesAgo: number;
    body: string;
    html?: string;            // when present, hidden text is extracted from it
    labelIds?: string[];
    isFromMe?: boolean;
    listUnsubscribe?: boolean;
  }[];
  /** For the keyless CLI's expected output and tests. */
  expect?: { lane: Decision["lane"]; note?: string };
}
export interface Recording { jev?: unknown; summary?: { summary: string; ask: string | null }; draft?: string; judgedModel?: string; writerModel?: string }

export interface FixturesLayer {
  loadInbox(root: string): FixtureInbox;
  /** Fixture threads as ThreadRecords with absolute dates. */
  threadRecords(inbox: FixtureInbox, now?: Date): ThreadRecord[];
  readRecording(root: string, threadId: string): Recording | null;
  writeRecording(root: string, threadId: string, patch: Partial<Recording>): void;
  recording(env: RillEnv): boolean;
  suggestGoals(): OnboardingSuggestions["goals"];
  loadCalendar(root: string): FixtureCalendar;
  /** Fixture calendars/events as CalendarRecords/CalendarEvents with absolute dates. */
  calendarRecords(fixture: FixtureCalendar, now?: Date): { calendars: CalendarRecord[]; events: CalendarEvent[] };
}

export interface FixtureCalendarDef { id: string; name: string; color?: string; isDefault?: boolean }
export interface FixtureEventAttendee { name: string; email: string; response?: RsvpResponse; self?: boolean; organizer?: boolean }
export interface FixtureEvent {
  id: string;
  calendarId: string;
  title: string;
  description?: string;
  location?: string;
  /** When it happens, as a wall-clock time in the event's own timeZone. Whole-day shifts only, so a sample week always lands on :00/:15/:30. */
  when: FixtureWhen;
  durationMinutes: number;
  timeZone: string;
  allDay?: boolean;
  status?: EventStatus;
  organizer: { name: string; email: string };
  attendees: FixtureEventAttendee[];
  joinUrl?: string;
  /** Shows the "moved" state: the event's previous time, struck through in the invite card. */
  movedFrom?: { when: FixtureWhen; durationMinutes: number };
  /** Links this event to a thread in fixtures/inbox.json for the invite card. */
  threadId?: string;
  /** Instances of one recurring series share this id. */
  recurringEventId?: string;
}
export interface FixtureCalendar { calendars: FixtureCalendarDef[]; events: FixtureEvent[] }
/**
 * `at` is "HH:MM" local. Pick the day with one of: `date` (YYYY-MM-DD, used
 * while it is still ahead, so an invite email naming that date agrees with
 * its event), `weekday` (0=Sun..6=Sat, the next one after today) or `day`
 * (offset from today; negative is past). `date` falls back to `weekday`.
 */
export interface FixtureWhen { at: string; day?: number; weekday?: number; date?: string }

// ---- sync.ts / judge.ts (glue, lives in core too) ---------------------------

export interface SyncLayer {
  /** Imports new threads for the mailbox, upserts, enqueues judging. Returns counts. Sample: loads fixtures once. */
  syncMailbox(ctx: Ctx, opts?: { full?: boolean; max?: number }): Promise<{ imported: number; updated: number; toJudge: number }>;
  /** Judges every unjudged message in the mailbox, newest first, writing judgments, thread_state, summary, and a draft when the policy says so. Emits progress. */
  judgePending(ctx: Ctx, opts?: { limit?: number; concurrency?: number }): Promise<{ judged: number; failed: number }>;
  /** Re-runs decide() over stored judgments only (goal weights, pauses, VIP edits). */
  redecide(ctx: Ctx): Promise<{ updated: number }>;
  /** Marks messages judged against an older goal set as unjudged so judgePending re-asks (sample: only when a recording exists). */
  invalidateJudgments(ctx: Ctx, reason: string): Promise<{ count: number }>;
}

// ---- calendar.ts (glue, lives in core too) ----------------------------------

export interface CalendarLayer {
  /** Polls each shown calendar for a 7-day-back to 60-day-ahead window, upserts, marks missing as cancelled. Sample: loads fixtures/calendar.json once. */
  syncCalendar(ctx: Ctx, opts?: { full?: boolean }): Promise<{ calendars: number; events: number; cancelled: number }>;
  /** The window for /calendar: calendars plus events, with conflicts and related threads resolved. */
  windowFor(ctx: Ctx, from: string, to: string): Promise<{ calendars: import("./api-types.js").ApiCalendar[]; events: ApiEvent[] }>;
  eventResponse(ctx: Ctx, eventId: string): Promise<import("./api-types.js").EventResponse | null>;
  inviteFor(ctx: Ctx, threadId: string): Promise<import("./api-types.js").ApiInvite | null>;
  rsvp(ctx: Ctx, eventId: string, action: import("./api-types.js").RsvpAction): Promise<import("./api-types.js").ApiEvent>;
  /** Edits or cancels an event you organize (the provider's events-patch; delete stays out of the grant). Throws EditNotAllowed / AlreadyCancelled. */
  patchEvent(ctx: Ctx, eventId: string, input: import("./api-types.js").EventPatchInput): Promise<import("./api-types.js").ApiEvent>;
  freeBusy(ctx: Ctx, from: string, to: string): Promise<import("./api-types.js").FreeBusyResponse>;
}
