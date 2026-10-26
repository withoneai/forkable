import { CALENDAR_INVITE_LABEL, LIST_UNSUBSCRIBE_LABEL } from "../../fixtures.js";
import { bodyText, cleanSnippet } from "../../sanitize.js";
import type { Mail, ThreadRecord } from "../../types.js";
import { participantsOf } from "../gmail/mappers.js";

// Pure functions: Microsoft Graph's mail wire shapes -> Rill's ThreadRecord/
// Mail. Field names are the One catalog's documented response for "List
// Messages" (GET /v1.0/me/messages), checked 2026-10-23; fixture-verified by
// packages/core/scripts/smoke-outlook.ts, not yet against a real grant.

export interface GraphEmailAddress { emailAddress?: { name?: string; address?: string } }
export interface GraphMessage {
  "@odata.type"?: string;
  id?: string;
  conversationId?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType?: "text" | "html"; content?: string };
  from?: GraphEmailAddress;
  sender?: GraphEmailAddress;
  toRecipients?: GraphEmailAddress[];
  ccRecipients?: GraphEmailAddress[];
  receivedDateTime?: string;
  sentDateTime?: string;
  createdDateTime?: string;
  internetMessageId?: string;
  internetMessageHeaders?: { name?: string; value?: string }[];
  categories?: string[];
  isDraft?: boolean;
  parentFolderId?: string;
}
export interface GraphMessageList { value?: GraphMessage[]; "@odata.nextLink"?: string }

/** Rill's own marks that ride in Mail.labelIds; never written back as Outlook categories. */
export const OUTLOOK_SYNTHETIC_LABELS = new Set(["INBOX", "SENT", LIST_UNSUBSCRIBE_LABEL, CALENDAR_INVITE_LABEL]);

function addressOf(a: GraphEmailAddress | undefined): { name: string; email: string } {
  return { name: a?.emailAddress?.name ?? "", email: (a?.emailAddress?.address ?? "").trim().toLowerCase() };
}

export function mailFromGraph(m: GraphMessage, threadId: string, me: string): Mail {
  const from = addressOf(m.from ?? m.sender);
  const raw = m.body?.content ?? "";
  const { body, hidden } = bodyText(raw);
  const isFromMe = me !== "" && from.email === me;
  const labelIds = [...(m.categories ?? []), isFromMe ? "SENT" : "INBOX"];
  if (m.internetMessageHeaders?.some((h) => h.name?.toLowerCase() === "list-unsubscribe")) labelIds.push(LIST_UNSUBSCRIBE_LABEL);
  // Graph marks a meeting request or reply as a derived type; there is no ICS part to read.
  const invite = /eventMessage/i.test(m["@odata.type"] ?? "");
  if (invite) labelIds.push(CALENDAR_INVITE_LABEL);
  const text = body || (m.bodyPreview ?? "");
  return {
    id: m.id ?? "",
    threadId,
    from,
    to: (m.toRecipients ?? []).map((a) => addressOf(a).email).filter(Boolean),
    cc: (m.ccRecipients ?? []).map((a) => addressOf(a).email).filter(Boolean),
    date: new Date(m.receivedDateTime ?? m.sentDateTime ?? m.createdDateTime ?? Date.now()).toISOString(),
    subject: m.subject ?? "(no subject)",
    body: text.slice(0, 20000),
    rawBody: raw ? (raw.length > 60000 ? raw.slice(0, 60000) : raw) : undefined,
    hiddenText: invite ? "" : hidden,
    snippet: cleanSnippet(m.bodyPreview ?? text),
    labelIds,
    isFromMe,
    messageIdHeader: m.internetMessageId,
  };
}

export function threadFromGraph(messages: GraphMessage[], threadId: string, me: string): ThreadRecord | null {
  const mails = messages.filter((m) => m.id && !m.isDraft).map((m) => mailFromGraph(m, threadId, me)).sort((a, b) => a.date.localeCompare(b.date));
  if (!mails.length) return null;
  const last = mails[mails.length - 1]!;
  // Graph names every recipient, not just the sender; keep those names for the people rail and VIP suggestions.
  const names = new Map<string, string>();
  for (const m of messages) for (const a of [m.from, m.sender, ...(m.toRecipients ?? []), ...(m.ccRecipients ?? [])]) {
    const { name, email } = addressOf(a);
    if (email && name && !names.has(email)) names.set(email, name);
  }
  const participants = participantsOf(mails).map((p) => ({ ...p, name: p.name || names.get(p.email) || "" }));
  return { id: threadId, subject: mails[0]!.subject || "(no subject)", snippet: last.snippet, lastMessageAt: last.date, messageCount: mails.length, participants, messages: mails };
}

/** Graph has no thread resource: a conversation is every message sharing a conversationId. Newest conversation first. */
export function threadsFromGraph(messages: GraphMessage[], me: string): ThreadRecord[] {
  const byConv = new Map<string, GraphMessage[]>();
  for (const m of messages) {
    const key = m.conversationId ?? m.id;
    if (!key) continue;
    const list = byConv.get(key) ?? [];
    list.push(m);
    byConv.set(key, list);
  }
  return [...byConv.entries()]
    .map(([id, msgs]) => threadFromGraph(msgs, id, me))
    .filter((t): t is ThreadRecord => t !== null)
    .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
}

/** The `$skip` of Graph's `@odata.nextLink`, which is Rill's page token for Outlook. */
export function skipOf(nextLink: string | undefined): string | undefined {
  if (!nextLink) return undefined;
  try {
    return new URL(nextLink).searchParams.get("$skip") ?? undefined;
  } catch {
    return nextLink.match(/[?&]\$skip=(\d+)/)?.[1];
  }
}

/** Gmail-style `newer_than:7d` (what sync.ts asks for) as a Graph `$filter`; anything else is a `$search` phrase. */
export function graphQuery(query: string | undefined, now = new Date()): { filter?: string; search?: string } {
  const filters = ["isDraft eq false"];
  if (!query) return { filter: filters.join(" and ") };
  const rest = query.replace(/\bnewer_than:(\d+)([dhm])\b/g, (_, n: string, unit: string) => {
    const ms = Number(n) * (unit === "d" ? 864e5 : unit === "h" ? 36e5 : 60_000);
    filters.push(`receivedDateTime ge ${new Date(now.getTime() - ms).toISOString()}`);
    return "";
  }).trim();
  // Graph refuses $search together with $filter on messages, so a phrase search drops the filter.
  if (rest) return { search: `"${rest.replace(/"/g, "")}"` };
  return { filter: filters.join(" and ") };
}
