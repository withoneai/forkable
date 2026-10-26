import { LIST_UNSUBSCRIBE_LABEL } from "../../fixtures.js";
import { bodyText, cleanSnippet, hiddenText, htmlToText, parseAddressList, parseFrom, stripQuoted } from "../../sanitize.js";
import { tzOffsetMinutes } from "../../tz.js";
import type { Mail, ThreadRecord } from "../../types.js";

// Pure functions: Gmail's wire shapes -> Rill's ThreadRecord/Mail. No network,
// no db, no One. Tested directly against recorded payloads.

export interface GetThreadsMessage {
  messageId?: string;
  id?: string;
  threadId?: string;
  sender?: string;
  from?: string;
  receiver?: string | string[];
  to?: string | string[];
  cc?: string | string[];
  time?: string | number;
  internalDate?: string | number;
  subject?: string;
  body?: string;
  labelIds?: string[];
  snippet?: string;
  messageIdHeader?: string;
  listUnsubscribe?: string | boolean;
}
export interface GetThreadsThread { id: string; snippet?: string; historyId?: string; messages?: GetThreadsMessage[] }
export interface GetThreadsResponse { threads?: GetThreadsThread[]; nextPageToken?: string }

export function dateOf(v: string | number | undefined): string {
  if (v === undefined || v === null || v === "") return new Date().toISOString();
  if (typeof v === "number" || /^\d{10,}$/.test(String(v))) {
    const n = Number(v);
    return new Date(n < 1e12 ? n * 1000 : n).toISOString();
  }
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
}

export function mailFromGetThreads(m: GetThreadsMessage, threadId: string, subject: string, me: string): Mail {
  const from = parseFrom(m.sender ?? m.from ?? "");
  const labelIds = [...(m.labelIds ?? [])];
  const raw = m.body ?? "";
  const { body, hidden } = bodyText(raw);
  const isFromMe = (me !== "" && from.email === me) || labelIds.includes("SENT");
  if (m.listUnsubscribe && !labelIds.includes(LIST_UNSUBSCRIBE_LABEL)) labelIds.push(LIST_UNSUBSCRIBE_LABEL);
  const text = body || stripQuoted(m.snippet ?? "");
  return {
    id: m.messageId ?? m.id ?? "",
    threadId,
    from,
    to: parseAddressList(m.receiver ?? m.to),
    cc: parseAddressList(m.cc),
    date: dateOf(m.time ?? m.internalDate),
    subject: m.subject ?? subject,
    body: text.slice(0, 20000),
    rawBody: raw.length > 60000 ? raw.slice(0, 60000) : raw,
    hiddenText: hidden,
    snippet: cleanSnippet(m.snippet ?? text),
    labelIds,
    isFromMe,
    messageIdHeader: m.messageIdHeader,
  };
}

export function threadFromGetThreads(t: GetThreadsThread, me: string): ThreadRecord | null {
  const first = t.messages?.[0];
  if (!t.id || !first) return null;
  const subject = first.subject ?? "(no subject)";
  const messages = (t.messages ?? [])
    .filter((m) => m.messageId ?? m.id)
    .map((m) => mailFromGetThreads(m, t.id, subject, me))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (messages.length === 0) return null;
  const last = messages[messages.length - 1]!;
  return {
    id: t.id,
    subject,
    snippet: cleanSnippet(t.snippet ?? last.snippet),
    lastMessageAt: last.date,
    messageCount: messages.length,
    participants: participantsOf(messages),
    messages,
  };
}

export function participantsOf(messages: Mail[]): { name: string; email: string }[] {
  const out: { name: string; email: string }[] = [];
  for (const m of messages) {
    const all = [m.from, ...m.to.map((e) => ({ name: "", email: e })), ...m.cc.map((e) => ({ name: "", email: e }))];
    for (const p of all) {
      if (!p.email) continue;
      const ex = out.find((x) => x.email === p.email);
      if (!ex) out.push({ name: p.name, email: p.email });
      else if (!ex.name && p.name) ex.name = p.name;
    }
  }
  return out;
}

// ---- raw Gmail thread (GET users/me/threads/{id}) ---------------------------

type Header = { name?: string; value?: string };
interface Part { mimeType?: string; filename?: string; body?: { data?: string }; parts?: Part[]; headers?: Header[] }
export interface RawMessage { id?: string; threadId?: string; internalDate?: string; labelIds?: string[]; snippet?: string; payload?: Part }

const header = (headers: Header[] | undefined, name: string) => headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
const decode = (data?: string) => (data ? Buffer.from(data, "base64url").toString("utf8").replace(/\r\n?/g, "\n") : "");

function extract(payload: Part | undefined): { plain: string; html: string; calendar: boolean; ics: string } {
  const out = { plain: "", html: "", calendar: false, ics: "" };
  if (!payload) return out;
  const stack: Part[] = [payload];
  while (stack.length) {
    const p = stack.shift()!;
    if (p.parts) stack.push(...p.parts);
    const mt = (p.mimeType ?? "").toLowerCase();
    const isIcs = mt === "text/calendar" || (p.filename ?? "").toLowerCase().endsWith(".ics");
    if (isIcs) {
      out.calendar = true;
      if (!out.ics && p.body?.data) out.ics = decode(p.body.data);
      continue;
    }
    if (!p.body?.data) continue;
    if (mt === "text/plain" && !out.plain) out.plain = decode(p.body.data);
    else if (mt === "text/html" && !out.html) out.html = decode(p.body.data);
  }
  return out;
}

/** The ICS event attached to this message, when it carries one. */
export function icsOf(raw: RawMessage): IcsEvent | null {
  const ex = extract(raw.payload);
  return ex.ics ? parseIcs(ex.ics) : null;
}

export function mailFromRaw(raw: RawMessage, me: string): Mail {
  const h = raw.payload?.headers;
  const ex = extract(raw.payload);
  const plain = ex.plain || (ex.html ? htmlToText(ex.html) : "") || raw.snippet || "";
  const from = parseFrom(header(h, "From"));
  const labelIds = [...(raw.labelIds ?? [])];
  if (header(h, "List-Unsubscribe") && !labelIds.includes(LIST_UNSUBSCRIBE_LABEL)) labelIds.push(LIST_UNSUBSCRIBE_LABEL);
  const body = stripQuoted(plain);
  return {
    id: raw.id ?? "",
    threadId: raw.threadId ?? raw.id ?? "",
    from,
    to: parseAddressList(header(h, "To")),
    cc: parseAddressList(header(h, "Cc")),
    date: raw.internalDate ? new Date(Number(raw.internalDate)).toISOString() : dateOf(header(h, "Date")),
    subject: header(h, "Subject"),
    body: body.slice(0, 20000),
    rawBody: ex.html || ex.plain || undefined,
    hiddenText: ex.calendar ? "" : hiddenText(ex.html, ex.plain),
    snippet: cleanSnippet(raw.snippet ?? body),
    labelIds,
    isFromMe: (me !== "" && from.email === me) || labelIds.includes("SENT"),
    messageIdHeader: header(h, "Message-ID") || header(h, "Message-Id") || undefined,
  };
}

export function threadFromRaw(data: { id?: string; messages?: RawMessage[] }, me: string): ThreadRecord | null {
  if (!data?.id) return null;
  const messages = (data.messages ?? []).filter((m) => m.id).map((m) => mailFromRaw(m, me)).sort((a, b) => a.date.localeCompare(b.date));
  if (!messages.length) return null;
  const last = messages[messages.length - 1]!;
  return {
    id: data.id,
    subject: messages[0]!.subject || "(no subject)",
    snippet: last.snippet,
    lastMessageAt: last.date,
    messageCount: messages.length,
    participants: participantsOf(messages),
    messages,
  };
}

// ---- ICS (the text/calendar part of an invite email) -------------------------

export interface IcsEvent { method: string | null; uid: string | null; sequence: number; start: string | null; end: string | null; tzid: string | null; organizer: string | null; summary: string | null }

/**
 * VALUE=DATE (all-day, YYYYMMDD) or a datetime (YYYYMMDDTHHMMSS[Z]). A bare Z
 * suffix is already UTC. Otherwise, with a TZID, the naive local time is
 * converted using that zone's real offset at this instant (DST-correct);
 * without one (a floating time, rare in practice) it is treated as UTC,
 * which is still better than silently using the server's own zone.
 */
function icsDate(v: string, tzid?: string): string | null {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (!h) return new Date(`${y}-${mo}-${d}T00:00:00Z`).toISOString();
  const naiveUtc = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
  if (z || !tzid) return naiveUtc.toISOString();
  return new Date(naiveUtc.getTime() - tzOffsetMinutes(tzid, naiveUtc) * 60_000).toISOString();
}

/** One VEVENT out of a VCALENDAR text/calendar body. Folded lines (RFC 5545) are unfolded first. */
export function parseIcs(ics: string): IcsEvent | null {
  if (!/BEGIN:VCALENDAR/.test(ics)) return null;
  const unfolded = ics.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
  const lines = unfolded.split("\n");
  const get = (name: string): { value: string; params: Record<string, string> } | null => {
    for (const line of lines) {
      const idx = line.indexOf(":");
      if (idx < 0) continue;
      const left = line.slice(0, idx);
      const [prop, ...paramParts] = left.split(";");
      if (prop?.toUpperCase() !== name) continue;
      const params: Record<string, string> = {};
      for (const p of paramParts) {
        const [k, v] = p.split("=");
        if (k && v) params[k.toUpperCase()] = v;
      }
      return { value: line.slice(idx + 1).trim(), params };
    }
    return null;
  };
  const method = get("METHOD")?.value ?? null;
  const uid = get("UID")?.value ?? null;
  const seq = get("SEQUENCE")?.value;
  const dtstart = get("DTSTART");
  const dtend = get("DTEND");
  const organizer = get("ORGANIZER")?.value.replace(/^mailto:/i, "") ?? null;
  const summary = get("SUMMARY")?.value.replace(/\\,/g, ",").replace(/\\n/gi, " ") ?? null;
  return {
    method,
    uid,
    sequence: seq ? Number(seq) || 0 : 0,
    start: dtstart ? icsDate(dtstart.value, dtstart.params.TZID) : null,
    end: dtend ? icsDate(dtend.value, dtend.params.TZID) : null,
    tzid: dtstart?.params.TZID ?? dtend?.params.TZID ?? null,
    organizer,
    summary,
  };
}

export function htmlOf(part: { mimeType?: string; filename?: string; body?: { data?: string }; parts?: unknown[] } | undefined): string | null {
  if (!part) return null;
  if (part.mimeType === "text/html" && part.body?.data && !part.filename) return Buffer.from(part.body.data, "base64url").toString("utf8");
  for (const p of (part.parts ?? []) as typeof part[]) {
    const h = htmlOf(p);
    if (h) return h;
  }
  return null;
}
