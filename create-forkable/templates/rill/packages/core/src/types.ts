// Domain types shared by core, server, cli and ui. Keep this file free of
// Node-only imports: the ui imports it too.

export type Source = "sample" | "live";
/** How a platform call reaches One. `fixture` replays fixtures/ (sample runs). */
export type CallMode = "fixture" | "connect" | "key" | "local";
export type Platform = "gmail" | "google-calendar" | "outlook-mail" | "outlook-calendar" | "zoom" | "typesafe" | "anthropic" | "openai" | "gemini";

/**
 * Where a meeting link comes from. Meet is part of a Google Calendar grant and
 * Teams of an Outlook Calendar one (Graph makes the link on the event), so each
 * exists only with its calendar. Zoom is its own One connection and works with
 * either calendar. The UI shows only what the grant has.
 */
export type ConferencingProvider = "google-meet" | "teams" | "zoom";
export const CONFERENCING: Record<ConferencingProvider, { label: string; host: RegExp }> = {
  "google-meet": { label: "Google Meet", host: /(^|\.)meet\.google\.com$/i },
  teams: { label: "Microsoft Teams", host: /(^|\.)teams\.(microsoft|live)\.com$/i },
  zoom: { label: "Zoom", host: /(^|\.)zoom\.(us|com)$/i },
};

/** The provider key a mailbox or calendar is bound to; the One platform it talks through. */
export type MailProviderKey = "gmail" | "outlook-mail";
export type CalendarProviderKey = "google-calendar" | "outlook-calendar";
export const MAIL_PROVIDERS: Record<MailProviderKey, { platform: Platform; label: string; verified: boolean }> = {
  gmail: { platform: "gmail", label: "Gmail", verified: true },
  "outlook-mail": { platform: "outlook-mail", label: "Outlook Mail", verified: false },
};
export const CALENDAR_PROVIDERS: Record<CalendarProviderKey, { platform: Platform; label: string; verified: boolean }> = {
  "google-calendar": { platform: "google-calendar", label: "Google Calendar", verified: true },
  "outlook-calendar": { platform: "outlook-calendar", label: "Outlook Calendar", verified: false },
};

export const LANES = ["vip", "goals", "reply", "other", "screener"] as const;
export type Lane = (typeof LANES)[number];

export const KINDS = ["person", "newsletter", "receipt", "notification", "calendar", "cold_pitch"] as const;
export type Kind = (typeof KINDS)[number];

export const BALLS = ["me", "them", "third_party", "nobody"] as const;
export type Ball = (typeof BALLS)[number];

export type Screen = "pass" | "strip" | "quarantine";

export type VipTier = "inner" | "key" | "team";
export type VipMatchKind = "address" | "domain" | "description";
export interface VipRules {
  alwaysTop?: boolean;
  notify?: boolean;
  neverDraft?: boolean;
  replyWithinHours?: number | null;
  followUpDays?: number | null;
}

export type WriterEngine = "local" | "one" | "connect";
export type WriterProvider = "anthropic" | "openai" | "gemini" | "claude-code" | "codex" | "gemini-cli";

/** One stored judgment, as shown in "Why it's here". */
export interface Judgment {
  question: string;        // machine key: screen_agent, kind, goal, needs_reply, ball, urgency, vip_<id>, commitment
  label: string;           // human label: "Which goal does this move?"
  kind: "noul" | "choice" | "score";
  answer: string;          // human answer: "Close the seed round", "Yes", "This week"
  probability: number;     // 0..1 for the chosen answer
  confidence: number;      // 0..1, Jev's calibration (noul: |p-0.5|*2)
  probabilities?: Record<string, number>;
  model: string;           // jev-1.13.0 | writer fallback model
}

/** Everything Jev answered for one message, parsed and typed. */
export interface JevAnswers {
  screen: { agentAddressed: number; override: number; actionRequest: number; hidden: number | null; inviteSpam: number | null };
  kind: { choice: Kind; confidence: number; probabilities: Record<string, number> };
  goal: { choice: string; confidence: number; probabilities: Record<string, number> }; // goal id or "none"
  needsReply: number;
  ball: { choice: Ball; confidence: number; probabilities: Record<string, number> };
  urgency: { score: number; confidence: number }; // 0..3
  vipByDescription: Record<string, number>;      // vip id -> probability
  commitment: number;
  model: string;
  inputTokens: number;
}

/** Hard facts code knows without judgment. */
export interface Facts {
  vipId: string | null;        // exact address or domain match
  vipTier: VipTier | null;
  team: boolean;
  firstTimeSender: boolean;
  fromMe: boolean;
  meSentLast: boolean;
  hasListUnsubscribe: boolean;
  isReply: boolean;
  calendarInvite: boolean;
  messageCount: number;
}

/** What the policy decides for a thread. */
export interface Decision {
  lane: Lane;
  rule: string;
  priority: number;        // 0..100
  confidence: number;      // the confidence of the judgment the lane rests on
  check: boolean;          // show the Check badge
  goalId: string | null;
  vipId: string | null;
  needsReply: boolean;
  draft: boolean;          // should a draft be written
  followUpDays: number | null;
}

export interface Thresholds {
  quarantine: number;  // 0.7
  strip: number;       // 0.35
  needsReply: number;  // 0.6
  goal: number;        // 0.5
  check: number;       // 0.6: below this the Check badge shows
  coldPitch: number;   // 0.7
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  quarantine: 0.7,
  strip: 0.35,
  needsReply: 0.6,
  goal: 0.5,
  check: 0.6,
  coldPitch: 0.7,
};

/** A normalized email message, the unit Jev judges. */
export interface Mail {
  id: string;
  threadId: string;
  from: { name: string; email: string };
  to: string[];
  cc: string[];
  date: string;           // ISO
  subject: string;
  body: string;           // sanitized latest body: quotes stripped, HTML to text
  rawBody?: string;
  hiddenText: string;     // text in HTML a human would not see
  snippet: string;
  labelIds: string[];
  isFromMe: boolean;
  messageIdHeader?: string;
}

export interface ThreadRecord {
  id: string;
  subject: string;
  snippet: string;
  lastMessageAt: string;
  messageCount: number;
  participants: { name: string; email: string }[];
  messages: Mail[];
}

/** What the assistant chat can propose; the user's click is what executes it. */
export const PROPOSAL_KINDS = [
  "done", "snooze", "reply_later", "screen_out", "let_in", "add_vip", "draft", "open", "search",
] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export interface ChatProposal {
  kind: ProposalKind;
  threadId?: string;
  /** A bulk proposal: one card, one click, the same action on every thread listed. */
  threadIds?: string[];
  label: string;
  params?: Record<string, unknown>;
}

export interface ChatCitation {
  threadId: string;
  subject: string;
  quote: string;
}

/** Stored alongside a chat message: the assistant's structured reply. */
export interface ChatBlocks {
  proposals?: ChatProposal[];
  citations?: ChatCitation[];
}

export const GMAIL_SCOPES = [
  { action: "gmail.get-profile", level: "read", why: "Know which address is yours, so your own mail reads as yours" },
  { action: "gmail.get-threads", level: "read", why: "See new mail to triage it" },
  { action: "gmail.get-thread", level: "read", why: "Read a conversation for summaries and Jev" },
  { action: "gmail.list-labels", level: "read", why: "Find the Rill labels in your mailbox" },
  { action: "gmail.create-label", level: "write", why: "Create the Rill lane labels once" },
  { action: "gmail.modify-thread-labels", level: "write", why: "Apply lanes as labels, mark done" },
  { action: "gmail.create-draft", level: "write", why: "Save drafts to your Gmail Drafts" },
  { action: "gmail.send-email", level: "write", why: "Sends only when you press Send. The AI has no way to send" },
  { action: "gmail.delete-message", level: "write", why: "Not needed, so not asked for", granted: false },
] as const;

/** Custom ask: read everything, patch an event (RSVP) and insert one (Book it). No delete, clear or delete-calendar. */
export const CALENDAR_SCOPES = [
  { action: "calendar.calendarList", level: "read", why: "See which calendars you have" },
  { action: "calendar.events-list", level: "read", why: "See your week to show it beside your mail" },
  { action: "calendar.events-get", level: "read", why: "Read one event for its invite card and prep" },
  { action: "calendar.events-instances", level: "read", why: "Show a single occurrence of a recurring meeting" },
  { action: "calendar.freebusy", level: "read", why: "Check conflicts and offer times you are actually free" },
  { action: "calendar.events-patch", level: "write", why: "Record your RSVP, and change or cancel meetings you organize" },
  { action: "calendar.events-insert", level: "write", why: "Create a meeting when a thread confirms a time (Book it)" },
  { action: "calendar.events-watch", level: "read", why: "Hear about changes to your calendar without polling (hosted)" },
  { action: "calendar.events-delete", level: "write", why: "Not needed, so not asked for", granted: false },
] as const;

/** The Outlook Mail ask, action for action the same job as GMAIL_SCOPES. Categories stand in for labels. */
export const OUTLOOK_MAIL_SCOPES = [
  { action: "outlook.get-profile", level: "read", why: "Know which address is yours, so your own mail reads as yours" },
  { action: "outlook.list-messages", level: "read", why: "See new mail and read conversations to triage them" },
  { action: "outlook.list-folder-messages", level: "read", why: "Read Sent Items once, so people you write to skip the screener" },
  { action: "outlook.update-message", level: "write", why: "Apply lanes as Outlook categories" },
  { action: "outlook.create-message", level: "write", why: "Save a new message to your Outlook Drafts" },
  { action: "outlook.create-reply", level: "write", why: "Save a reply to your Outlook Drafts" },
  { action: "outlook.reply", level: "write", why: "Sends only when you press Send. The AI has no way to send" },
  { action: "outlook.send-draft", level: "write", why: "Sends a new message only when you press Send" },
  { action: "outlook.delete-message", level: "write", why: "Not needed, so not asked for", granted: false },
] as const;

/** The Outlook Calendar ask. RSVP and cancel are their own Graph actions, not a patch. No delete. */
export const OUTLOOK_CALENDAR_SCOPES = [
  { action: "outlook-calendar.calendars", level: "read", why: "See which calendars you have" },
  { action: "outlook-calendar.calendarView", level: "read", why: "See your week to show it beside your mail" },
  { action: "outlook-calendar.events-get", level: "read", why: "Read one event for its invite card and prep" },
  { action: "outlook-calendar.getSchedule", level: "read", why: "Check conflicts and offer times you are actually free" },
  { action: "outlook-calendar.accept", level: "write", why: "Record your RSVP when you answer an invite" },
  { action: "outlook-calendar.tentativelyAccept", level: "write", why: "Record a maybe when you answer an invite" },
  { action: "outlook-calendar.decline", level: "write", why: "Record a no when you answer an invite" },
  { action: "outlook-calendar.events-insert", level: "write", why: "Create a meeting, with a Teams link when you ask (Book it)" },
  { action: "outlook-calendar.events-patch", level: "write", why: "Change meetings you organize" },
  { action: "outlook-calendar.events-cancel", level: "write", why: "Cancel a meeting you organize; Outlook tells the guests" },
  { action: "outlook-calendar.events-delete", level: "write", why: "Not needed, so not asked for", granted: false },
] as const;

/** Shown on Access only when Zoom is in the grant. One meeting per Create, never a list of past meetings. */
export const ZOOM_SCOPES = [
  { action: "zoom.meetings-create", level: "write", why: "Make a Zoom link for a meeting you create" },
] as const;

// ---- Calendar domain -----------------------------------------------------------

export type EventStatus = "confirmed" | "tentative" | "cancelled";
export type RsvpResponse = "needsAction" | "accepted" | "declined" | "tentative";

export interface Attendee {
  name: string | null;
  email: string;
  self: boolean;
  organizer: boolean;
  response: RsvpResponse;
}

/** Rill's own calendar event shape. Every provider mapper produces this. */
export interface CalendarEvent {
  id: string;             // provider event id (googleId / outlook id)
  iCalUID: string | null;
  recurringEventId: string | null;
  calendarId: string;
  title: string;
  description: string | null;
  location: string | null;
  start: string;          // ISO, UTC
  end: string;             // ISO, UTC
  timeZone: string | null; // the event's own zone, as the provider gave it
  allDay: boolean;
  status: EventStatus;
  organizer: { name: string | null; email: string } | null;
  attendees: Attendee[];
  joinUrl: string | null;
  myResponse: RsvpResponse;
  updated: string;         // ISO, when the provider last changed this event
}

export interface CalendarRecord {
  id: string;              // provider calendar id
  name: string;
  color: string | null;
  isDefault: boolean;
  accessRole: "owner" | "writer" | "reader" | "freeBusyReader";
}

/** A thin slice of an event, for the brief's Today section. */
export interface EventSummary {
  eventId: string;
  title: string;
  start: string;
  end: string;
  timeZone: string | null;
  joinUrl: string | null;
  attendees: { name: string | null; email: string }[];
  myResponse: RsvpResponse;
  needsRsvp: boolean;
}

export interface FreeBusySlot { start: string; end: string }

/** "google-calendar" -> "Google Calendar", "gmail" -> "Gmail", "outlook-mail" -> "Outlook". Used for ledger rows and receipts. */
export function platformLabel(platform: string): string {
  // Microsoft calls the mail product just "Outlook"; the calendar keeps its full name.
  if (platform === "outlook-mail") return "Outlook";
  return platform.split("-").map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w)).join(" ");
}
/** The receipt's verb: any action naming a delete, whichever provider's convention it uses, reads as "delete". */
export function actionLabel(action: string): string {
  return /delete/.test(action) ? "delete" : action;
}

/** Working hours used by conflicts and Offer times. `days`: 0=Sun..6=Sat. Minutes are local, from midnight. */
export interface WorkingHours { days: number[]; startMinute: number; endMinute: number }
export const DEFAULT_WORKING_HOURS: WorkingHours = { days: [1, 2, 3, 4, 5], startMinute: 9 * 60, endMinute: 18 * 60 };
