// The shapes the Rill routes return and the Rill blocks render. Shared by
// server and browser, so a block and its route never drift.

/** Rill's five lanes, in the order the inbox shows them. */
export const LANES = ["vip", "goals", "reply", "other", "screener"] as const;
export type Lane = (typeof LANES)[number];
export const LANE_LABELS: Record<Lane, string> = { vip: "VIPs", goals: "Goals", reply: "Needs reply", other: "Other", screener: "New senders" };

export type Kind = "person" | "newsletter" | "receipt" | "notification" | "calendar" | "cold_pitch";

export interface Goal { id: string; title: string; detail?: string }
/** A VIP by exact address, by domain, or by a description Jev reads ("anyone on our board"). */
export interface Vip { id: string; name: string; matchKind: "address" | "domain" | "description"; match: string }

export interface LaneThread {
  id: string;
  subject: string;
  snippet: string;
  from: { name: string; email: string };
  date: string;
  unread: boolean;
  lane: Lane;
  /** The policy line that put it there, in words. */
  rule: string;
  kind: Kind;
  goal: { id: string; title: string } | null;
  vip: string | null;
  needsReply: number;
  /** 0 a week or more, 1 this week, 2 today, 3 within the hour. */
  urgency: number;
  /** Rill's own one-line summary when one exists. */
  summary: string | null;
  /** The last message is yours and nobody answered for 3 days or more. */
  followUp: boolean;
}

export interface LanesResponse {
  judgedBy: "jev" | "recorded";
  counts: Record<Lane, number>;
  threads: LaneThread[];
}

export interface BriefLine { when: string; title: string; detail: string; tone: "neutral" | "positive" | "warning" | "negative"; threadId: string }
export interface BriefResponse {
  forDate: string;
  kpis: { vipsWaiting: number; goalMoves: number; repliesOwed: number; followUps: number; newSenders: number };
  lines: BriefLine[];
  /** 3 to 5 sentences. Written by code until someone presses Write with Claude. */
  text: string;
  writtenBy: "code" | "claude";
}

export interface AskCitation { threadId: string; subject: string; from: string; date: string; quote: string }
export interface AskResponse { answer: string; citations: AskCitation[]; searched: number }

export interface VipSuggestion { name: string; email: string; sentCount: number; reason: string; alreadyVip: boolean }
