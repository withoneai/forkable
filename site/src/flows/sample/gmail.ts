import base from "./gmail.json";

// The Acme Inc sample inbox (Dana Reyes, CEO of Acme Inc), shaped exactly
// like Gmail's "List and View Email Threads" answers on a real grant:
// threads[].messages[] with sender, receiver, time, subject, body, labelIds
// and internalDate. The 24 threads in gmail.json started as the ones Rill and
// the blocks gallery show, with a few day names changed so every flow on this
// page tells one story (WORLD.md). EXTRA is made up for this page: mail Dana
// sent that never got a reply (Follow-up radar) and a few more newsletter
// issues (Inbox cleanup). Times are relative, so the sample always reads as
// today.

type SampleMessage = { id: string; from: { name: string; email: string }; to: string[]; minutesAgo: number; body: string; labelIds?: string[] };
type SampleThread = { id: string; subject: string; labelIds: string[]; messages: SampleMessage[] };

const ME = { name: "Dana Reyes", email: "dana@acme.com" };
const DAY = 24 * 60;

const sent = (id: string, subject: string, to: string, minutesAgo: number, body: string): SampleThread => ({
  id,
  subject,
  labelIds: ["SENT"],
  messages: [{ id: `${id}m1`, from: ME, to: [to], minutesAgo, body, labelIds: ["SENT"] }],
});

const issue = (id: string, subject: string, name: string, email: string, minutesAgo: number, body: string): SampleThread => ({
  id,
  subject,
  labelIds: ["INBOX", "CATEGORY_PROMOTIONS"],
  messages: [{ id: `${id}m1`, from: { name, email }, to: [ME.email], minutesAgo, body, labelIds: ["INBOX", "CATEGORY_PROMOTIONS"] }],
});

const EXTRA: SampleThread[] = [
  sent("s01", "Pricing for the Vandelay rollout", "leo@vandelay.com", 4 * DAY + 120, "Hi Leo,\n\nAs promised, here is the pricing for the wider rollout: 60 seats on the Business plan, annual, with SSO included. Happy to walk your finance team through it this week.\n\nDana"),
  sent("s02", "Would you be a reference for Globex?", "kenji@tyrelllabs.ai", 6 * DAY + 300, "Hi Kenji,\n\nGlobex is close to moving from pilot to a paid rollout, and their ops director would like to talk to a customer. Would you be up for a 20 minute call with Elena Ruiz next week?\n\nThanks,\nDana"),
  sent("s03", "Design partner program", "lena@initech.vc", 5 * 60, "Hi Lena,\n\nGreat to meet you through Sam. Here is the one pager on our design partner program. Would a 30 minute call next week work?\n\nDana"),
  sent("s04", "Acme and Umbrella, next steps", "kim@umbrella.health", 9 * DAY, "Hi Kim,\n\nThanks again for the time on Tuesday. I put the security review and the pilot plan in the shared folder. Let me know who should join the next call.\n\nDana"),
  sent("s05", "W-9 and the Q3 numbers", "ben@adlerandco.com", 22 * 60, "Ben,\n\nW-9 attached, and the Q3 revenue export is in the folder. Shout if anything is missing.\n\nDana"),
  sent("s06", "Quote for a second Soylent team", "nadia@soylentfoods.com", 12 * DAY, "Hi Nadia,\n\nHere is the quote for adding your fulfillment team on the Team plan, same price as the first team. It holds until the end of the month.\n\nDana"),
  issue("n01", "Discovery interviews that do not lead the witness", "The Product Weekly", "hello@productweekly.news", 7 * DAY + 950, "The Product Weekly, issue 211"),
  issue("n02", "Roadmaps people actually read", "The Product Weekly", "hello@productweekly.news", 14 * DAY + 950, "The Product Weekly, issue 210"),
  issue("n03", "Stack Notes #147: build caches, explained", "Stack Notes", "newsletter@stacknotes.dev", 7 * DAY + 4200, "Stack Notes, issue 147"),
  issue("n04", "Seed Signals: September round-up", "Seed Signals", "digest@seedsignals.co", 30 * DAY, "Seed Signals, September round-up"),
  issue("n05", "Field Notes: hiring your first salesperson", "Founder Field Notes", "notes@founderfield.co", 2 * DAY + 600, "Founder Field Notes, week 43"),
  issue("n06", "Field Notes: pricing pages that convert", "Founder Field Notes", "notes@founderfield.co", 9 * DAY + 600, "Founder Field Notes, week 42"),
  issue("n07", "Field Notes: the board meeting nobody dreads", "Founder Field Notes", "notes@founderfield.co", 16 * DAY + 600, "Founder Field Notes, week 41"),
];

// Newsletters in the base sample read as promotions too.
const PROMO = new Set(["t22", "t23", "t24"]);

const archived = new Set<string>();

export function sampleArchive(messageIds: string[]) {
  for (const id of messageIds) archived.add(id);
}

const rfc = (d: Date) => d.toUTCString().replace("GMT", "+0000");

export type GmailMessage = {
  sender: string;
  receiver: string;
  time: string;
  subject: string;
  body: string;
  messageId: string;
  threadId: string;
  labelIds: string[];
  historyId: string;
  internalDate: string;
  snippet: string;
  attachments: [];
};

export type GmailThread = { id: string; snippet: string; historyId: string; messages: GmailMessage[] };

function all(): GmailThread[] {
  const now = Date.now();
  const threads = [...(base.threads as SampleThread[]), ...EXTRA];
  return threads.map((t) => {
    const messages = t.messages
      .map((m): GmailMessage => {
        const at = new Date(now - m.minutesAgo * 60_000);
        const labels = new Set(m.labelIds ?? t.labelIds);
        if (PROMO.has(t.id)) labels.add("CATEGORY_PROMOTIONS");
        if (archived.has(m.id)) labels.delete("INBOX");
        const snippet = m.body.replace(/\s+/g, " ").slice(0, 140);
        return {
          sender: `${m.from.name} <${m.from.email}>`,
          receiver: m.to.join(", "),
          time: rfc(at),
          subject: t.subject,
          body: m.body,
          messageId: m.id,
          threadId: t.id,
          labelIds: [...labels],
          historyId: String(1000 + Math.round(m.minutesAgo)),
          internalDate: String(at.getTime()),
          snippet,
          attachments: [],
        };
      })
      .sort((a, b) => Number(a.internalDate) - Number(b.internalDate));
    const last = messages[messages.length - 1]!;
    return { id: t.id, snippet: last.snippet, historyId: last.historyId, messages };
  });
}

// A small reading of Gmail's search syntax, enough for the queries the
// flows send: in:sent, in:inbox, is:unread, newer_than:Nd, older_than:Nd,
// category:promotions (and -category:...), from:x, to:x, and {a b} for OR.
function matches(t: GmailThread, query: string, labels: string[]): boolean {
  const all = new Set(t.messages.flatMap((m) => m.labelIds));
  for (const l of labels) if (!all.has(l)) return false;
  const last = Number(t.messages[t.messages.length - 1]!.internalDate);
  const ageDays = (Date.now() - last) / 86_400_000;
  const people = (field: "sender" | "receiver") => t.messages.map((m) => m[field].toLowerCase()).join(" ");
  const term = (raw: string): boolean => {
    const neg = raw.startsWith("-");
    const tok = neg ? raw.slice(1) : raw;
    const [k, v = ""] = tok.split(":");
    let ok = true;
    if (k === "in" && v === "sent") ok = all.has("SENT");
    else if (k === "in" && v === "inbox") ok = all.has("INBOX");
    else if (k === "is" && v === "unread") ok = all.has("UNREAD");
    else if (k === "category") ok = all.has(`CATEGORY_${v.toUpperCase()}`);
    else if (k === "newer_than") ok = ageDays < parseInt(v, 10);
    else if (k === "older_than") ok = ageDays > parseInt(v, 10);
    else if (k === "from") ok = people("sender").includes(v.toLowerCase());
    else if (k === "to") ok = people("receiver").includes(v.toLowerCase());
    return neg ? !ok : ok;
  };
  const groups = query.match(/\{[^}]*\}|\S+/g) ?? [];
  return groups.every((g) => (g.startsWith("{") ? g.slice(1, -1).trim().split(/\s+/).some(term) : term(g)));
}

export function getThreads(body: { label?: string | string[]; query?: string; numberOfThreads?: number }) {
  const labels = body.label === undefined ? [] : Array.isArray(body.label) ? body.label : [body.label];
  const n = Math.min(100, Math.max(1, body.numberOfThreads ?? 10));
  const found = all()
    .filter((t) => matches(t, body.query ?? "", labels))
    .sort((a, b) => Number(b.messages.at(-1)!.internalDate) - Number(a.messages.at(-1)!.internalDate));
  const threads = found.slice(0, n);
  return {
    threads,
    totalFound: threads.length,
    requestedCount: n,
    label: body.label ?? null,
    query: body.query ?? null,
    resultSizeEstimate: found.length,
    message: `Successfully retrieved ${threads.length} threads`,
  };
}
