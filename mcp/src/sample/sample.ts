import sample from "./gmail.json" with { type: "json" };
import type { MailThreadDetail } from "./types.js";

// The Acme Inc sample inbox (Dana Reyes, CEO of Acme). What every Gmail
// component shows before Sign in with One is set up. Times are relative, so
// the sample always looks like this morning.

interface SampleMessage { id: string; from: { name: string; email: string }; to: string[]; minutesAgo: number; body: string; labelIds: string[] }
interface SampleThread { id: string; subject: string; labelIds: string[]; messages: SampleMessage[] }

export const SAMPLE_ADDRESS = sample.address;

// Writes in the sample (archive, mark read, star) live for this process only.
const overrides = new Map<string, { add: Set<string>; remove: Set<string> }>();

export function sampleModify(id: string, add: string[], remove: string[]) {
  const o = overrides.get(id) ?? { add: new Set(), remove: new Set() };
  for (const l of add) (o.add.add(l), o.remove.delete(l));
  for (const l of remove) (o.remove.add(l), o.add.delete(l));
  overrides.set(id, o);
}

export function sampleThreads(): MailThreadDetail[] {
  const now = Date.now();
  return (sample.threads as SampleThread[])
    .map((t) => {
      const o = overrides.get(t.id);
      const labels = new Set(t.labelIds);
      o?.add.forEach((l) => labels.add(l));
      o?.remove.forEach((l) => labels.delete(l));
      const messages = t.messages
        .map((m) => ({
          id: m.id,
          from: m.from,
          to: m.to,
          date: new Date(now - m.minutesAgo * 60_000).toISOString(),
          body: m.body,
          fromMe: m.from.email === sample.address,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));
      const last = messages[messages.length - 1]!;
      const lastIn = [...messages].reverse().find((m) => !m.fromMe) ?? last;
      return {
        id: t.id,
        subject: t.subject,
        snippet: last.body.replace(/\s+/g, " ").slice(0, 160),
        from: lastIn.from,
        date: last.date,
        unread: labels.has("UNREAD"),
        starred: labels.has("STARRED"),
        inInbox: labels.has("INBOX"),
        count: messages.length,
        messages,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}
