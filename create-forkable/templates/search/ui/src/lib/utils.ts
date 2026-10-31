import { useEffect, useState } from "react";
import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
import type { ItemKind, Lane } from "@/contract/api-types";

// The ladder adds text-8 ... text-28. Without telling tailwind-merge they are
// font sizes, cn("text-11", "text-muted-foreground") drops the size.
const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: ["8", "9", "10", "11", "13", "15", "28"] }] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const KIND_LABEL: Record<ItemKind, string> = {
  person: "Person", company: "Company", email_thread: "Mail", event: "Event", doc: "Doc", task: "Issue",
  message: "Message", meeting_note: "Meeting", deal: "Deal", note: "Note", record: "Record",
};

/** Scope tabs, in the order the tabs and the 1-9 keys use. */
export const SCOPES: { key: ItemKind | "all"; label: string; op?: string }[] = [
  { key: "all", label: "All" },
  { key: "email_thread", label: "Mail", op: "mail" },
  { key: "event", label: "Calendar", op: "event" },
  { key: "person", label: "People", op: "person" },
  { key: "company", label: "Companies", op: "company" },
  { key: "doc", label: "Docs", op: "doc" },
  { key: "task", label: "Issues", op: "issue" },
  { key: "message", label: "Chat", op: "message" },
  { key: "meeting_note", label: "Meetings", op: "meeting" },
  { key: "deal", label: "Deals", op: "deal" },
  { key: "note", label: "Notes", op: "note" },
];

export const LANE_LABEL: Record<Lane, string> = { vip: "VIPs", needs_you: "Needs you", waiting: "Waiting", fyi: "FYI", low: "Low" };
export const LANE_OP: Record<Lane, string> = { vip: "vip", needs_you: "needs-you", waiting: "waiting", fyi: "fyi", low: "low" };

export const PLATFORM_NAME: Record<string, string> = {
  hubspot: "HubSpot", attio: "Attio", gmail: "Gmail", "outlook-mail": "Outlook Mail", "google-calendar": "Google Calendar",
  "outlook-calendar": "Outlook Calendar", notion: "Notion", linear: "Linear", slack: "Slack", teams: "Teams", granola: "Granola",
  zendesk: "Zendesk", anthropic: "Anthropic", "claude-code": "Claude Code", codex: "Codex", openai: "OpenAI", typesafe: "TypeSafe", intercom: "Intercom", jira: "Jira",
  github: "GitHub", asana: "Asana", "google-drive": "Google Drive", salesforce: "Salesforce", pipedrive: "Pipedrive",
  airtable: "Airtable", clickup: "ClickUp", confluence: "Confluence", gemini: "Gemini", cohere: "Cohere", "mistral-ai": "Mistral",
};
// Tolerates a missing platform: one bad row must never take the whole page down.
export const platformName = (p: string | null | undefined) => !p ? "Unknown" : PLATFORM_NAME[p] ?? p.replace(/(^|-)([a-z])/g, (_, s: string, c: string) => (s ? " " : "") + c.toUpperCase());
export const logoUrl = (platform: string | null | undefined) => `https://assets.withone.ai/connectors/${platform || "unknown"}.svg`;

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Short relative time: "now", "18m", "3h", "Mon", "Oct 3". Future dates read "in 2d", "Thu". */
export function fmtRelative(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = now - t;
  if (diff < 0) {
    const ahead = -diff;
    if (ahead < HOUR) return `in ${Math.max(1, Math.round(ahead / MIN))}m`;
    if (ahead < DAY) return `in ${Math.round(ahead / HOUR)}h`;
    if (ahead < 7 * DAY) return new Date(t).toLocaleDateString(undefined, { weekday: "short" });
    return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  if (diff < MIN) return "now";
  if (diff < HOUR) return `${Math.floor(diff / MIN)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "4 min ago", "2h ago", "3 days ago". */
export function fmtAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const diff = now - new Date(iso).getTime();
  if (diff < 0) return fmtIn(iso, now);
  if (diff < MIN) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MIN)} min ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  const d = Math.floor(diff / DAY);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
export function fmtIn(iso: string | null, now = Date.now()): string {
  if (!iso) return "not scheduled";
  const diff = new Date(iso).getTime() - now;
  if (diff <= 0) return "now";
  if (diff < HOUR) return `in ${Math.max(1, Math.round(diff / MIN))} min`;
  if (diff < DAY) return `in ${Math.round(diff / HOUR)}h`;
  return `in ${Math.round(diff / DAY)} days`;
}

export function fmtClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}
export function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
export function fmtDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
export function fmtRange(start: string, end: string): string {
  return `${fmtDay(start)}, ${fmtTime(start)} to ${fmtTime(end)}`;
}
export function fmtMoney(n: number | undefined, currency = "USD"): string {
  if (n == null) return "";
  return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}
export const fmtNum = (n: number) => n.toLocaleString();

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? "⌘" : "Ctrl";

export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

export function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

/** Wraps [start, end) ranges of `text` in <mark>. Ranges come from the server. */
export function splitHighlights(text: string, ranges: [number, number][]): { text: string; hit: boolean }[] {
  if (!ranges.length) return [{ text, hit: false }];
  const out: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (const [s, e] of [...ranges].sort((a, b) => a[0] - b[0])) {
    if (s > at) out.push({ text: text.slice(at, s), hit: false });
    if (e > Math.max(s, at)) out.push({ text: text.slice(Math.max(s, at), e), hit: true });
    at = Math.max(at, e);
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false });
  return out;
}

/** The linked person an address most likely belongs to ("priya@globex.com" to Priya Shah), by the address's first name part. */
export function nameForAddress(people: { name: string }[], address: string | null | undefined): string | null {
  if (!address) return null;
  if (!address.includes("@")) return address;
  const local = address.split("@")[0]!.split(/[._+-]/)[0]!.toLowerCase();
  if (local.length < 2) return null;
  return people.find((p) => !p.name.includes("@") && p.name.toLowerCase().split(/\s+/)[0] === local)?.name ?? null;
}

/** HubSpot's default pipeline stage ids as their labels; other values pass through. */
const STAGE_LABEL: Record<string, string> = {
  appointmentscheduled: "Appointment scheduled", qualifiedtobuy: "Qualified to buy", presentationscheduled: "Presentation scheduled",
  decisionmakerboughtin: "Decision maker bought in", contractsent: "Contract sent", closedwon: "Closed won", closedlost: "Closed lost",
};
export const stageLabel = (s: string | null | undefined): string | null => (s ? STAGE_LABEL[s] ?? s : null);
/** Owner fields often hold a provider id (HubSpot 71001, an Attio UUID); show only a name. */
export const ownerName = (s: string | null | undefined): string | null => (s && !/^\d+$/.test(s) && !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s) ? s : null);

/** "Dana Oyelaran <dana@acme.com>" as "Dana Oyelaran"; a bare address stays. */
export const displayName = (s: string | null | undefined): string | null => {
  if (!s) return null;
  const m = /^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/.exec(s);
  return m ? m[1]! : s;
};
/** Provider enum values ("COMPUTER_SOFTWARE") as words ("Computer software"). */
export const enumLabel = (s: string | null | undefined): string | null =>
  s && /^[A-Z0-9_]+$/.test(s) ? (s.charAt(0) + s.slice(1).toLowerCase()).replace(/_/g, " ") : s ?? null;
