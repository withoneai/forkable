// The HTTP contract between server and ui. Browser-safe: no Node imports.
import type { MailCategory } from "./categories.js";
import type { Attendee, CalendarProviderKey, ChatBlocks, EventStatus, EventSummary, Judgment, Lane, MailProviderKey, RsvpResponse, Source, Thresholds, VipMatchKind, VipRules, VipTier, WorkingHours, WriterEngine, ConferencingProvider } from "./types.js";

export interface ApiUser { id: string; name: string | null; email: string | null; avatarUrl: string | null }

export interface ApiMailbox {
  id: string;
  source: Source;
  mode: "fixture" | "connect" | "key";
  label: string;
  address: string | null;
  status: "active" | "reconnect_required" | "paused";
  lastSyncAt: string | null;
  onboarded: boolean;
  counts: Record<Lane, number>;
  mailProvider: MailProviderKey;
  /** null until the user connects a calendar; "Connect Google Calendar" shows in Access/Settings until then. */
  calendarProvider: CalendarProviderKey | null;
}

export interface MeResponse {
  user: ApiUser | null;
  mailboxes: ApiMailbox[];
  connect: { configured: boolean; connected: boolean };
  /** Platforms the signed-in user's Connect grant reaches (gmail, typesafe, anthropic, …). */
  grant: { platforms: string[] };
  local: boolean;            // true when the app runs on the user's machine (npx / dev)
}

export interface InboxRow {
  threadId: string;
  lane: Lane;
  subject: string;
  snippet: string;
  from: { name: string; email: string };
  lastMessageAt: string;
  messageCount: number;
  priority: number;
  confidence: number;
  check: boolean;
  /** Why Check shows, in words. */
  checkReason: string | null;
  goal: { id: string; title: string } | null;
  vip: { id: string; name: string; tier: VipTier } | null;
  kind: string | null;
  needsReply: boolean;
  urgency: number;
  summary: string | null;
  hasDraft: boolean;
  screen: "pass" | "strip" | "quarantine";
  snoozedUntil: string | null;
  replyLater: boolean;
  unread: boolean;
  /** This thread is a calendar invite tied to a synced event; the Reader shows the invite card. */
  invite: { eventId: string; state: "pending" | "answered" | "moved" | "cancelled" } | null;
  /** You wrote last, nobody answered, and the follow-up timer ran out. */
  followUpDue: boolean;
  /** Set only in All inboxes: the account this thread lives in. */
  mailbox?: { id: string; label: string; address: string | null };
}

/** Proof the pipeline is keeping up: sync freshness, Jev's state, the last reconcile. */
export interface MailHealth {
  lastSyncAt: string | null;
  /** No finished sync in over two hours on a live mailbox. */
  stale: boolean;
  /** Jev has been failing since then; mail is held unjudged for the first hour. */
  jevDownSince: string | null;
  /** True once the hour has passed and the writer judges, without drafts. */
  jevFallback: boolean;
  /** Messages waiting on Jev right now. */
  held: number;
  reconcile: { at: string; listed: number; missing: number; requeued: number; stuck: number } | null;
  /** The inbox tabs being read, e.g. ["primary"]. */
  categories: string[];
  /** Threads already imported from tabs that are now off, hidden from the inbox. */
  hiddenByTabs: number;
}

/** GET /inbox/all: every live mailbox's lane in one list. */
export interface AllInboxResponse {
  rows: InboxRow[];
  counts: Record<Lane, number>;
  syncing: boolean;
  judging: number;
  mailboxes: { id: string; label: string; address: string | null }[];
}

export interface InboxResponse {
  rows: InboxRow[];
  counts: Record<Lane, number>;
  syncing: boolean;
  judging: number;         // messages waiting for a judgment
  health: MailHealth;
}

export interface ApiMessage {
  id: string;
  from: { name: string; email: string };
  to: string[];
  cc: string[];
  date: string;
  subject: string;
  body: string;            // sanitized text
  isFromMe: boolean;
  screen: "pass" | "strip" | "quarantine";
}

export interface ComposeInput { to: string[]; subject: string; body: string }
export interface ComposeResponse { gmailDraftId: string }

export interface ApiDraft {
  id: string;
  to: string[];
  subject: string;
  body: string;
  engine: string;
  model: string;
  status: "proposed" | "edited" | "saved" | "sent" | "discarded";
  validator: { ok: boolean; reasons: string[] } | null;
  updatedAt: string;
}

export interface ThreadResponse {
  thread: {
    id: string;
    subject: string;
    lastMessageAt: string;
    participants: { name: string; email: string }[];
  };
  state: InboxRow;
  messages: ApiMessage[];
  why: Judgment[];          // the judgments for the latest message
  rule: string;
  judgedBy: string | null;
  ask: string | null;
  draft: ApiDraft | null;
  person: {                 // right rail
    name: string; email: string; vip: { id: string; name: string; tier: VipTier; rules: VipRules } | null;
    senderStatus: "unknown" | "let_in" | "screened_out"; threadsWithThem: { threadId: string; subject: string; lastMessageAt: string }[];
  };
  invite: ApiInvite | null;
}

// ---- Calendar ----------------------------------------------------------------

export interface ApiCalendar {
  id: string;
  name: string;
  color: string | null;
  shown: boolean;
  countsForAvailability: boolean;
  isDefault: boolean;
  syncState: "live" | "resyncing" | "reconnect_required";
}

export interface ApiAttendee extends Attendee {}

export interface ApiEvent {
  id: string;
  calendarId: string;
  title: string;
  description: string | null;
  location: string | null;
  start: string;           // ISO, UTC
  end: string;              // ISO, UTC
  timeZone: string | null;  // the event's own zone
  allDay: boolean;
  status: EventStatus;
  organizer: { name: string | null; email: string } | null;
  attendees: ApiAttendee[];
  joinUrl: string | null;
  myResponse: RsvpResponse;
  recurringEventId: string | null;
  conflict: { eventId: string; title: string } | null;
  /** You organize it (or nobody does) and it is not cancelled: fields in the card edit in place, blocks drag on the grid. */
  editable: boolean;
  relatedThreads: { threadId: string; subject: string }[];
}

export interface CalendarResponse { calendars: ApiCalendar[]; events: ApiEvent[]; syncing: boolean }
export interface CalendarPatchInput { shown?: boolean; countsForAvailability?: boolean; isDefault?: boolean; color?: string | null }

export interface EventResponse {
  event: ApiEvent;
  relatedThreads: { threadId: string; subject: string; lastMessageAt: string }[];
  prep: MeetingPrep | null;
}

export interface MeetingPrep {
  attendees: { name: string | null; email: string; vip: { name: string; tier: VipTier } | null; lastThread: { threadId: string; subject: string; lastMessageAt: string } | null; asks: string[] }[];
  goal: { id: string; title: string } | null;
  text: string;
  citations: { threadId: string; subject: string; quote: string }[];
  generatedAt: string;
}

/** The invite card in the Reader, for a thread whose kind is a calendar invite. */
export interface ApiInvite {
  eventId: string | null;        // null when the event has not synced yet (new invite)
  state: "pending" | "answered" | "cancelled";
  event: {
    title: string;
    start: string;
    end: string;
    timeZone: string | null;
    organizerTimeZone: string | null;
    joinUrl: string | null;
    attendees: ApiAttendee[];
    status: EventStatus;
    myResponse: RsvpResponse;
  };
  /** Present when the server detected the event moved since it was first synced. */
  movedFrom: { start: string; end: string } | null;
  conflict: { eventId: string; title: string; start: string; end: string } | null;
  freeAtThatTime: boolean;
  /** RSVP needs an iTIP reply email until Book it-style create/patch access exists for this event. */
  rsvpByEmail: boolean;
}

export type RsvpAction = { response: "accepted" | "declined" | "tentative"; note?: string };

export interface FreeBusyRequest { from: string; to: string }
export interface FreeBusyResponse { busy: { start: string; end: string }[] }

// ---- Phase B: offer times, book it, create, propose a new time ----------------

export interface OfferTimesInput { threadId: string; durationMinutes: number; slots: { start: string; end: string }[] }
export interface OfferTimesResponse { text: string; recipientTimeZone: string | null; stillFree: boolean }

export interface CreateEventInput {
  title: string;
  start: string;
  end: string;
  timeZone: string;
  attendees: string[];
  /** Display names for picked contacts, keyed by email; sent to the provider so invites read "Priya Natarajan". */
  attendeeNames?: Record<string, string>;
  description?: string;
  /** Which meeting link to add; null or missing means none. Must be one of GET /conferencing's `available`. */
  conferencing?: ConferencingProvider | null;
  calendarId?: string;
  /** The thread Book it was raised from; a confirmation draft gets written for it. */
  fromThreadId?: string;
}
/** Someone to invite: ranked from mail you exchanged and events you shared. */
export interface ApiContact { email: string; name: string | null; source: "mail" | "event" | "both"; lastSeen: string }
export interface ContactsResponse { contacts: ApiContact[] }

export interface EventPatchInput {
  title?: string;
  description?: string | null;
  location?: string | null;
  start?: string;
  end?: string;
  timeZone?: string;
  allDay?: boolean;
  /** The full guest list (without you); the server keeps replies of guests already on it. */
  attendees?: string[];
  attendeeNames?: Record<string, string>;
  /** Change the meeting link; null removes it. Must be in GET /conferencing's `available`. */
  conferencing?: ConferencingProvider | null;
  /** Cancels the event for everyone. Delete is never in the grant. */
  status?: "cancelled";
  /** Whether guests get an update email. Default none. */
  notify?: "all" | "none";
}

/** What New event can offer for a meeting link: only providers the grant has. */
export interface ConferencingResponse { available: ConferencingProvider[]; default: ConferencingProvider | null }

export interface CreateEventResponse { event: ApiEvent; confirmationDraftId: string | null }

export interface ProposeTimeInput { threadId: string; slots: { start: string; end: string }[] }
export interface ProposeTimeResponse { draftId: string }

export interface PlainLanguageEventInput { text: string; timeZone: string }
export interface PlainLanguageEventPreview { title: string; start: string; end: string; timeZone: string; attendees: string[]; confidence: number }

// ---- Phase C: booking link, recurring series -----------------------------------

export interface ApiBookingLink {
  id: string;
  slug: string;
  title: string;
  durationMinutes: number;
  calendarId: string;
  active: boolean;
  url: string;
}
export interface BookingLinkInput { title: string; durationMinutes: number; calendarId?: string; active?: boolean }
export type SeriesEditScope = "this" | "following" | "all";

/** HTML bodies for the reader, keyed by message id (the ApiMessage id). Text-only messages are absent. */
export interface ThreadHtmlResponse { html: Record<string, string> }

export type ThreadAction =
  | { action: "done" }
  | { action: "undo" }
  | { action: "snooze"; until: string }
  | { action: "reply_later" }
  | { action: "let_in" }
  | { action: "screen_out" }
  | { action: "add_vip"; tier?: VipTier }
  | { action: "move"; lane: Lane };

export interface ApiGoal { id: string; title: string; detail: string; weight: number; paused: boolean; position: number; matched7d: number }
export interface GoalInput { title: string; detail?: string; weight?: number; paused?: boolean; position?: number }

export interface ApiVip { id: string; name: string; matchKind: VipMatchKind; match: string; tier: VipTier; rules: VipRules; matched7d: number }
export interface VipInput { name: string; matchKind: VipMatchKind; match: string; tier?: VipTier; rules?: VipRules }
export interface VipSuggestion { name: string; email: string; reason: string; sentCount: number }

export interface BriefResponse {
  forDate: string;
  generatedAt: string;
  kpis: { label: string; value: number; hint: string }[];
  lines: { when: string; title: string; detail: string; tone?: "neutral" | "positive" | "warning" | "negative"; threadId?: string }[];
  text: string;
  engine: string;
  model: string;
  /** Today's meetings in order, invites waiting on a response, and conflicts. */
  today: { meetings: EventSummary[]; invitesWaiting: number; conflicts: { a: string; b: string; start: string }[] };
}

export interface AskResponse {
  answer: string;
  citations: { threadId: string; subject: string; from: string; date: string; quote: string }[];
  engine: string;
  model: string;
}

export interface LedgerRow {
  id: number;
  at: string;
  platform: string;
  action: string;
  method: string;
  path: string;
  mode: "fixture" | "connect" | "key" | "local";
  level: "read" | "write";
  status: number;
  ok: boolean;
  blockedByGrant: boolean;
  refusal: string | null;
  engine: string | null;
  model: string | null;
  ms: number;
  summary: string;
  note: string | null;
}

export interface AccessResponse {
  grant: {
    mode: "fixture" | "connect" | "key";
    holder: string;            // "dana@acme.com" or the connection label
    status: "active" | "reconnect_required" | "revoked" | "none";
    scopes: { action: string; level: "read" | "write"; granted: boolean; why: string }[];
    oneActivityUrl: string | null;
  };
  activity: LedgerRow[];
  today: { calls: number; declined: number };
}

export interface ModelOption { id: string; label: string; hint?: string }

export interface EngineOption {
  id: string;                 // claude-code | codex | gemini-cli | one-anthropic | one-openai | one-gemini | connect-own
  group: WriterEngine;
  name: string;
  detail: string;
  status: "ready" | "signed_out" | "missing" | "available" | "unavailable";
  cost: string;
  install?: string;
  /** The engine's default model id. */
  model?: string;
  /** Models this engine can be asked for, labeled the provider's way. Only on usable engines. */
  models?: ModelOption[];
}

export interface EnginesResponse { options: EngineOption[]; current: { engine: WriterEngine; provider: string; model: string } | null; local: boolean }

export interface ApiSettings {
  writerEngine: WriterEngine | null;
  writerProvider: string | null;
  writerModel: string | null;
  thresholds: Partial<Thresholds>;
  briefTime: string;
  timezone: string | null;
  allowWrites: boolean;
  applyLabels: boolean;
  showImages: boolean;
  autoDraft: boolean;
  onboarded: boolean;
  me: string | null;
  database: { kind: "embedded" | "external"; url: string; sizeBytes: number | null; dataDir: string | null };
  secondaryTimezone: string | null;
  workingHours: WorkingHours;
  defaultCalendarId: string | null;
  todayRail: boolean;
  /** Preselected in New event when available; null means no link by default. */
  defaultConferencing: ConferencingProvider | null;
  /** Inbox tabs Rill reads. Gmail: primary, promotions, updates, social, forums. Outlook: primary (Focused), other. */
  mailCategories: MailCategory[];
}

export interface PaletteResponse {
  contacts: { name: string; email: string; vip: VipTier | null }[];
  threads: { threadId: string; subject: string; from: string; lane: Lane; lastMessageAt: string }[];
}

/** Server-sent events on /api/v1/mailboxes/:id/events */
export type MailboxEvent =
  | { type: "sync"; phase: "start" | "done" | "error"; imported?: number; error?: string }
  | { type: "judged"; threadId: string; lane: Lane; priority: number; from?: string; subject?: string }
  | { type: "draft"; threadId: string; draftId: string }
  | { type: "ledger"; row: LedgerRow }
  | { type: "reconnect_required" }
  | { type: "progress"; judged: number; total: number }
  /** Mail health changed: Jev went down or came back, a reconcile finished, follow-ups came due. */
  | { type: "health" }
  | { type: "calendar"; phase: "start" | "done" | "error"; changed?: number; error?: string };

export interface SyncResponse { started: boolean; reason?: string }

export interface OnboardingSuggestions {
  goals: { title: string; detail: string }[];
  vips: VipSuggestion[];
}

// ---- Inbox assistant chat ----------------------------------------------------

export interface ApiChat { id: string; title: string; createdAt: string; updatedAt: string }

export interface ApiChatMessage {
  id: string;
  chatId: string;
  role: "user" | "assistant" | "system";
  content: string;
  blocks: ChatBlocks;
  engine: string | null;
  model: string | null;
  createdAt: string;
}

/** What the UI sends alongside a message: what it had open, so the assistant can see it too. */
export interface ChatContextInput {
  route: { kind: "thread"; threadId: string } | { kind: "lane"; lane: Lane };
  thread?: {
    subject: string;
    participants: { name: string; email: string }[];
    messages: { from: string; date: string; body: string }[];
    why: Judgment[];
    draft: string | null;
  };
  laneRows?: { threadId: string; subject: string; from: string; summary: string | null }[];
  goals?: { id: string; title: string }[];
  vips?: { id: string; name: string }[];
}

export interface ChatMessageInput {
  content: string;
  context?: ChatContextInput;
  engine?: { engine: WriterEngine; provider: string; model: string };
}

export type ChatStreamEvent =
  | { type: "delta"; text: string }
  | { type: "blocks"; proposals: NonNullable<ChatBlocks["proposals"]>; citations: NonNullable<ChatBlocks["citations"]> }
  | { type: "done"; messageId: string; engine: string; model: string }
  | { type: "error"; message: string };
