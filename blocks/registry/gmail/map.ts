import type { MailMessage, MailThread, MailThreadDetail, Person } from "./types.js";

// Gmail's answers mapped to the shapes in types.ts. Two inputs: One's
// get-threads helper (headers already parsed) and Gmail's own threads.get
// (raw MIME parts). Trimmed from Rill's mappers.

export function parsePerson(raw: string): Person {
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1]!.trim() || m[2]!.trim(), email: m[2]!.trim().toLowerCase() };
  const email = raw.trim().toLowerCase();
  return { name: email.split("@")[0] ?? email, email };
}

const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : (v ?? "").split(",")).map((s) => parsePerson(s).email).filter(Boolean);

function dateOf(v: string | number | undefined): string {
  if (v === undefined || v === "") return new Date().toISOString();
  if (typeof v === "number" || /^\d{10,}$/.test(String(v))) {
    const n = Number(v);
    return new Date(n < 1e12 ? n * 1000 : n).toISOString();
  }
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
}

const stripHtml = (s: string) => s.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/[ \t]+/g, " ").trim();

function summarize(id: string, messages: MailMessage[], labels: string[], snippet?: string): MailThread {
  const first = messages[0]!;
  const last = messages[messages.length - 1]!;
  const lastIn = [...messages].reverse().find((m) => !m.fromMe) ?? last;
  return {
    id,
    subject: (first as MailMessage & { subject?: string }).subject ?? "(no subject)",
    snippet: (snippet ?? last.body).replace(/\s+/g, " ").slice(0, 160),
    from: lastIn.from,
    date: last.date,
    unread: labels.includes("UNREAD"),
    starred: labels.includes("STARRED"),
    inInbox: labels.includes("INBOX"),
    count: messages.length,
  };
}

// --- One's get-threads helper ----------------------------------------------

interface HelperMessage { messageId?: string; id?: string; sender?: string; from?: string; receiver?: string | string[]; to?: string | string[]; time?: string | number; internalDate?: string | number; subject?: string; body?: string; snippet?: string; labelIds?: string[] }
export interface HelperThread { id: string; snippet?: string; messages?: HelperMessage[] }

export function fromHelper(t: HelperThread, me: string): MailThreadDetail | null {
  const msgs = (t.messages ?? []).filter((m) => m.messageId ?? m.id);
  if (!t.id || msgs.length === 0) return null;
  const labels = [...new Set(msgs.flatMap((m) => m.labelIds ?? []))];
  const messages: MailMessage[] = msgs
    .map((m) => {
      const from = parsePerson(m.sender ?? m.from ?? "");
      return {
        id: (m.messageId ?? m.id)!,
        from,
        to: list(m.receiver ?? m.to),
        date: dateOf(m.time ?? m.internalDate),
        body: stripHtml(m.body ?? m.snippet ?? ""),
        fromMe: from.email === me || (m.labelIds ?? []).includes("SENT"),
        subject: m.subject,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  return { ...summarize(t.id, messages, labels, t.snippet), messages };
}

// --- Gmail threads.get (format=full) ----------------------------------------

interface Part { mimeType?: string; body?: { data?: string }; parts?: Part[]; headers?: { name?: string; value?: string }[] }
export interface RawThread { id?: string; messages?: { id?: string; internalDate?: string; labelIds?: string[]; snippet?: string; payload?: Part }[] }

const decode = (data?: string) => (data ? Buffer.from(data, "base64url").toString("utf8").replace(/\r\n?/g, "\n") : "");

function textOf(p: Part | undefined): string {
  const stack = p ? [p] : [];
  let html = "";
  while (stack.length) {
    const part = stack.shift()!;
    if (part.parts) stack.push(...part.parts);
    if (part.mimeType === "text/plain" && part.body?.data) return decode(part.body.data);
    if (part.mimeType === "text/html" && part.body?.data && !html) html = stripHtml(decode(part.body.data));
  }
  return html;
}

export function fromRaw(t: RawThread, me: string): MailThreadDetail | null {
  if (!t.id || !t.messages?.length) return null;
  const labels = [...new Set(t.messages.flatMap((m) => m.labelIds ?? []))];
  const messages = t.messages.map((m) => {
    const h = (n: string) => m.payload?.headers?.find((x) => x.name?.toLowerCase() === n)?.value ?? "";
    const from = parsePerson(h("from"));
    return {
      id: m.id!,
      from,
      to: list(h("to")),
      date: dateOf(m.internalDate),
      body: textOf(m.payload) || m.snippet || "",
      fromMe: from.email === me || (m.labelIds ?? []).includes("SENT"),
      subject: h("subject") || undefined,
    };
  });
  return { ...summarize(t.id, messages, labels), messages };
}

export const toSummary = ({ messages: _m, ...t }: MailThreadDetail): MailThread => t;
