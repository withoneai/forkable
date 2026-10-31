// The Acme Inc sample world (SPEC 11) as the mock server serves it. A slice of
// what fixtures/sample holds: the same cast, the same storylines, the same
// cross-source overlap (Priya Shah across nine sources). Dates are relative to
// page load so the world is always current. Dev only: never shipped to a user.
import type { EntityRole, ItemFacets, ItemKind, Lane } from "@/contract/api-types";

const H = 3_600_000;
const D = 24 * H;
const NOW = Date.now();
/** Days from now (negative = past) at a local wall-clock time. */
export function at(days: number, hh = 10, mm = 0): string {
  const d = new Date(NOW + days * D);
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
}
const ago = (hours: number) => new Date(NOW - hours * H).toISOString();

export interface MockEntity {
  id: string; type: "person" | "company"; name: string; emails: string[]; domain: string | null; title: string | null;
  companyId: string | null; isSelf?: boolean;
}

export const ENTITIES: MockEntity[] = [
  { id: "ent_dana", type: "person", name: "Dana Oyelaran", emails: ["dana@acme.com", "dana@acme.eu"], domain: "acme.com", title: "Head of Sales", companyId: "ent_acme", isSelf: true },
  { id: "ent_mia", type: "person", name: "Mia Park", emails: ["mia@acme.com"], domain: "acme.com", title: "Engineering lead", companyId: "ent_acme" },
  { id: "ent_theo", type: "person", name: "Theo Lund", emails: ["theo@acme.com"], domain: "acme.com", title: "Product manager", companyId: "ent_acme" },
  { id: "ent_sam", type: "person", name: "Sam Okafor", emails: ["sam@acme.com"], domain: "acme.com", title: "Sales ops", companyId: "ent_acme" },
  { id: "ent_lena", type: "person", name: "Lena Vogt", emails: ["lena@acme.eu"], domain: "acme.eu", title: "EU account manager", companyId: "ent_acme" },
  { id: "ent_priya", type: "person", name: "Priya Shah", emails: ["priya@globex.com", "priya.shah@gmail.com"], domain: "globex.com", title: "VP Partnerships", companyId: "ent_globex" },
  { id: "ent_marco", type: "person", name: "Marco Bellini", emails: ["marco@globex.com"], domain: "globex.com", title: "Legal counsel", companyId: "ent_globex" },
  { id: "ent_ravi", type: "person", name: "Ravi Menon", emails: ["ravi@initech.io"], domain: "initech.io", title: "CTO", companyId: "ent_initech" },
  { id: "ent_hannah", type: "person", name: "Hannah Cole", emails: ["hannah.cole@umbrella.co"], domain: "umbrella.co", title: "Procurement lead", companyId: "ent_umbrella" },
  { id: "ent_owen", type: "person", name: "Owen Price", emails: ["owen@northwind.vc"], domain: "northwind.vc", title: "Partner", companyId: "ent_northwind" },
  { id: "ent_jules", type: "person", name: "Jules Martin", emails: ["jules@hooli.dev"], domain: "hooli.dev", title: "Founder", companyId: "ent_hooli" },
  { id: "ent_acme", type: "company", name: "Acme Inc", emails: [], domain: "acme.com", title: null, companyId: null, isSelf: true },
  { id: "ent_globex", type: "company", name: "Globex", emails: [], domain: "globex.com", title: "Enterprise software", companyId: null },
  { id: "ent_initech", type: "company", name: "Initech", emails: [], domain: "initech.io", title: "Data infrastructure", companyId: null },
  { id: "ent_umbrella", type: "company", name: "Umbrella", emails: [], domain: "umbrella.co", title: "Life sciences", companyId: null },
  { id: "ent_northwind", type: "company", name: "Northwind Ventures", emails: [], domain: "northwind.vc", title: "Venture capital", companyId: null },
  { id: "ent_hooli", type: "company", name: "Hooli", emails: [], domain: "hooli.dev", title: "Developer tools", companyId: null },
];
export const entity = (id: string) => ENTITIES.find((e) => e.id === id)!;

export interface MockSourceDef { id: string; platform: string; model: string; title: string; kind: ItemKind; connectionLabel: string; actions: string[] }
const S = (platform: string, model: string, title: string, kind: ItemKind, connectionLabel: string, actions: string[]): MockSourceDef =>
  ({ id: `src_${platform.replace(/-/g, "_")}_${model.replace(/-/g, "_")}`, platform, model, title, kind, connectionLabel, actions });

export const SOURCES: MockSourceDef[] = [
  S("hubspot", "contacts", "Contacts", "person", "dana@acme.com · Acme Inc portal", ["hubspot.crm.contacts.search"]),
  S("hubspot", "companies", "Companies", "company", "dana@acme.com · Acme Inc portal", ["hubspot.crm.companies.search"]),
  S("hubspot", "deals", "Deals", "deal", "dana@acme.com · Acme Inc portal", ["hubspot.crm.deals.search"]),
  S("hubspot", "notes", "Notes", "note", "dana@acme.com · Acme Inc portal", ["hubspot.crm.notes.search"]),
  S("attio", "people", "People", "person", "Acme workspace", ["attio.records.query.people"]),
  S("attio", "companies", "Companies", "company", "Acme workspace", ["attio.records.query.companies"]),
  S("attio", "deals", "Deals", "deal", "Acme workspace", ["attio.records.query.deals"]),
  S("attio", "notes", "Notes", "note", "Acme workspace", ["attio.notes.list"]),
  S("gmail", "threads", "Threads", "email_thread", "dana@acme.com", ["gmail.get-threads"]),
  S("outlook-mail", "messages", "Messages", "email_thread", "dana@acme.eu", ["outlook.messages.list", "outlook.messages.delta"]),
  S("google-calendar", "events", "Events", "event", "dana@acme.com · 2 calendars", ["calendar.calendarList.list", "calendar.events.list"]),
  S("outlook-calendar", "events", "Events", "event", "dana@acme.eu", ["outlook.calendarView.delta"]),
  S("notion", "pages", "Pages", "doc", "Acme workspace", ["notion.search", "notion.blocks.children.list"]),
  S("linear", "issues", "Issues", "task", "Acme team", ["linear.graphql.issues"]),
  S("linear", "projects", "Projects", "doc", "Acme team", ["linear.graphql.projects"]),
  S("linear", "documents", "Documents", "doc", "Acme team", ["linear.graphql.documents"]),
  S("slack", "messages", "Messages", "message", "acme.slack.com", ["slack.conversations.list", "slack.conversations.history", "slack.conversations.replies"]),
  S("teams", "chat-messages", "Chat messages", "message", "dana@acme.eu", ["teams.chats.list", "teams.chats.messages.list"]),
  S("granola", "notes", "Notes", "meeting_note", "dana@acme.com", ["granola.notes.list", "granola.notes.get"]),
];
export const sourceFor = (platform: string, model: string) => SOURCES.find((s) => s.platform === platform && s.model === model)!;

export interface MockPart { kind: "message" | "section"; title: string | null; author: string | null; at: string | null; text: string }
export interface MockItem {
  id: string; kind: ItemKind; platform: string; model: string; title: string; body: string; occurredAt: string; updatedAt?: string;
  url: string | null; container?: string | null; status?: string | null; labels?: string[]; facets: ItemFacets;
  people: { entityId: string; role: EntityRole }[]; lane: Lane | null; importance: number | null; parts?: MockPart[];
  properties?: { label: string; value: string }[]; groupKey?: string; by?: "jev" | "rules" | "fixture";
}

let n = 0;
const id = () => `itm_${(++n).toString(36).padStart(4, "0")}`;
const P = (entityId: string, role: EntityRole) => ({ entityId, role });
const msg = (author: string, atIso: string, text: string): MockPart => ({ kind: "message", title: null, author, at: atIso, text });
const sec = (title: string | null, text: string): MockPart => ({ kind: "section", title, author: null, at: null, text });

function mail(o: { title: string; platform?: string; from: string; to: string[]; parts: MockPart[]; lane?: Lane; importance?: number; unread?: boolean; attach?: boolean; folder?: string; extra?: { entityId: string; role: EntityRole }[] }): MockItem {
  const platform = o.platform ?? "gmail";
  const last = o.parts[o.parts.length - 1]!;
  const i = id();
  return {
    id: i, kind: "email_thread", platform, model: platform === "gmail" ? "threads" : "messages", title: o.title,
    body: o.parts.map((p) => `${p.author}: ${p.text}`).join("\n\n"), occurredAt: last.at!, url: platform === "gmail" ? `https://mail.google.com/mail/u/0/#all/${i}` : `https://outlook.office.com/mail/deeplink/read/${i}`,
    container: o.folder ?? "Inbox", labels: [], facets: { kind: "email_thread", messageCount: o.parts.length, unread: o.unread, hasAttachment: o.attach, lastFrom: last.author ?? undefined, folder: o.folder ?? "Inbox" },
    people: [P(o.from, "from"), ...o.to.map((t) => P(t, "to")), ...(o.extra ?? [])], lane: o.lane ?? "fyi", importance: o.importance ?? 0.5, parts: o.parts, by: "fixture",
  };
}

function event(o: { title: string; platform?: string; start: string; mins: number; organizer: string; attendees: string[]; location?: string; join?: string; desc: string; self?: string; calendar?: string; color?: string; lane?: Lane }): MockItem {
  const platform = o.platform ?? "google-calendar";
  const end = new Date(new Date(o.start).getTime() + o.mins * 60_000).toISOString();
  const all = [o.organizer, ...o.attendees];
  return {
    id: id(), kind: "event", platform, model: "events", title: o.title, body: o.desc, occurredAt: o.start, url: platform === "google-calendar" ? "https://calendar.google.com/calendar/r/eventedit" : "https://outlook.office.com/calendar/item",
    container: o.calendar ?? "Work", facets: {
      kind: "event", start: o.start, end, location: o.location, joinUrl: o.join, organizerEmail: entity(o.organizer).emails[0] ?? undefined,
      attendees: all.map((e) => ({ email: entity(e).emails[0], name: entity(e).name, response: e === o.organizer ? "accepted" : e === "ent_dana" ? (o.self ?? "accepted") : "accepted" })),
      selfResponse: o.self ?? "accepted", calendar: o.calendar ?? "Work", calendarColor: o.color ?? "#809d08",
    },
    people: [P(o.organizer, "organizer"), ...o.attendees.map((a) => P(a, "attendee"))], lane: o.lane ?? "fyi", importance: 0.5, by: "fixture",
  };
}

function doc(o: { title: string; platform?: string; model?: string; parent?: string; editedBy: string; updated: string; sections: MockPart[]; about?: string[]; lane?: Lane }): MockItem {
  const platform = o.platform ?? "notion";
  return {
    id: id(), kind: "doc", platform, model: o.model ?? "pages", title: o.title, body: o.sections.map((s) => `${s.title ?? ""}\n${s.text}`).join("\n\n"), occurredAt: o.updated, updatedAt: o.updated,
    url: platform === "notion" ? "https://www.notion.so/acme/page" : "https://linear.app/acme/document", container: o.parent ?? null,
    facets: { kind: "doc", parentTitle: o.parent, editedBy: entity(o.editedBy).name, wordCount: o.sections.reduce((a, s) => a + s.text.split(/\s+/).length, 0) },
    people: [P(o.editedBy, "author"), ...(o.about ?? []).map((a) => P(a, "mentioned"))], lane: o.lane ?? "fyi", importance: 0.5, parts: o.sections, by: "fixture",
  };
}

function issue(o: { key: string; title: string; state: string; stateType: "backlog" | "unstarted" | "started" | "completed" | "canceled"; assignee: string; priority: 0 | 1 | 2 | 3 | 4; due?: string; project?: string; body: string; updated: string; about?: string[]; lane?: Lane; comments?: MockPart[] }): MockItem {
  return {
    id: id(), kind: "task", platform: "linear", model: "issues", title: o.title, body: o.body + (o.comments ? `\n\n${o.comments.map((c) => `${c.author}: ${c.text}`).join("\n")}` : ""),
    occurredAt: o.updated, updatedAt: o.updated, url: `https://linear.app/acme/issue/${o.key}`, status: o.state, container: o.project ?? "Acme",
    facets: { kind: "task", key: o.key, state: o.state, stateType: o.stateType, assignee: entity(o.assignee).name, priority: o.priority, due: o.due, project: o.project, team: "Acme" },
    people: [P(o.assignee, "assignee"), ...(o.about ?? []).map((a) => P(a, "about"))], lane: o.lane ?? "fyi", importance: 0.55,
    parts: [sec("Description", o.body), ...(o.comments ?? [])], by: "fixture",
  };
}

function message(o: { platform?: string; channel: string; channelType: "channel" | "private" | "dm" | "group" | "chat"; sender: string; text: string; atIso: string; replies?: MockPart[]; mentions?: string[]; lane?: Lane }): MockItem {
  const platform = o.platform ?? "slack";
  return {
    id: id(), kind: "message", platform, model: platform === "slack" ? "messages" : "chat-messages", title: o.text.length > 90 ? `${o.text.slice(0, 88)}...` : o.text, body: o.text + (o.replies ? `\n\n${o.replies.map((r) => `${r.author}: ${r.text}`).join("\n")}` : ""),
    occurredAt: o.atIso, url: platform === "slack" ? "https://acme.slack.com/archives/C0DEALS/p1730000000" : "https://teams.microsoft.com/l/message", container: o.channel,
    facets: { kind: "message", channel: o.channel, channelType: o.channelType, sender: entity(o.sender).name, replyCount: o.replies?.length ?? 0 },
    people: [P(o.sender, "from"), ...(o.mentions ?? []).map((m) => P(m, "mentioned"))], lane: o.lane ?? "fyi", importance: 0.4,
    parts: [msg(entity(o.sender).name, o.atIso, o.text), ...(o.replies ?? [])], by: "fixture",
  };
}

function meeting(o: { title: string; start: string; mins: number; attendees: string[]; takeaways: string[]; summary: string; lane?: Lane }): MockItem {
  return {
    id: id(), kind: "meeting_note", platform: "granola", model: "notes", title: o.title, body: `${o.summary}\n\n${o.takeaways.map((t) => `- ${t}`).join("\n")}`,
    occurredAt: o.start, url: "https://notes.granola.ai/d/acme", facets: { kind: "meeting_note", start: o.start, end: new Date(new Date(o.start).getTime() + o.mins * 60_000).toISOString(), durationMin: o.mins, attendees: o.attendees.map((a) => ({ name: entity(a).name, email: entity(a).emails[0] })), takeaways: o.takeaways, hasTranscript: false },
    people: o.attendees.map((a) => P(a, "attendee")), lane: o.lane ?? "fyi", importance: 0.6, parts: [sec("Summary", o.summary), sec("Takeaways", o.takeaways.map((t) => `- ${t}`).join("\n"))], by: "fixture",
  };
}

function deal(o: { platform: string; name: string; company: string; amount: number; currency?: string; stage: string; close: string; owner: string; contacts: string[]; updated: string; note: string; lane?: Lane }): MockItem {
  return {
    id: id(), kind: "deal", platform: o.platform, model: "deals", title: o.name, body: o.note, occurredAt: o.updated, updatedAt: o.updated,
    url: o.platform === "hubspot" ? "https://app.hubspot.com/contacts/4410022/record/0-3/1001" : "https://app.attio.com/acme/deals", status: o.stage,
    facets: { kind: "deal", amount: o.amount, currency: o.currency ?? "USD", stage: o.stage, closeDate: o.close, owner: entity(o.owner).name, companyName: entity(o.company).name, pipeline: "Sales" },
    people: [P(o.owner, "owner"), P(o.company, "about"), ...o.contacts.map((c) => P(c, "about"))], lane: o.lane ?? "fyi", importance: 0.7,
    properties: [{ label: "Stage", value: o.stage }, { label: "Pipeline", value: "Sales" }], by: "fixture",
  };
}

function person(o: { platform: string; ent: string; lifecycle?: string; owner?: string; updated: string; note?: string }): MockItem {
  const e = entity(o.ent);
  const co = e.companyId ? entity(e.companyId) : null;
  return {
    id: id(), kind: "person", platform: o.platform, model: o.platform === "hubspot" ? "contacts" : "people", title: e.name, body: `${e.name}, ${e.title ?? ""} at ${co?.name ?? ""}. ${o.note ?? ""}`.trim(),
    occurredAt: o.updated, updatedAt: o.updated, url: o.platform === "hubspot" ? "https://app.hubspot.com/contacts/4410022/record/0-1/2001" : "https://app.attio.com/acme/person",
    facets: { kind: "person", email: e.emails[0], jobTitle: e.title ?? undefined, companyName: co?.name, companyDomain: co?.domain ?? undefined, lifecycle: o.lifecycle, owner: o.owner ? entity(o.owner).name : undefined },
    people: [P(o.ent, "about")], lane: null, importance: 0.5, by: "fixture",
  };
}

function company(o: { platform: string; ent: string; industry: string; size: string; owner?: string; updated: string; note?: string }): MockItem {
  const e = entity(o.ent);
  return {
    id: id(), kind: "company", platform: o.platform, model: "companies", title: e.name, body: `${e.name} (${e.domain}). ${o.industry}, ${o.size} people. ${o.note ?? ""}`.trim(),
    occurredAt: o.updated, updatedAt: o.updated, url: o.platform === "hubspot" ? "https://app.hubspot.com/contacts/4410022/record/0-2/3001" : "https://app.attio.com/acme/company",
    facets: { kind: "company", domain: e.domain ?? undefined, industry: o.industry, size: o.size, owner: o.owner ? entity(o.owner).name : undefined },
    people: [P(o.ent, "about")], lane: null, importance: 0.5, by: "fixture",
  };
}

function note(o: { platform: string; title: string; text: string; author: string; updated: string; parentKind: ItemKind; parentTitle: string; about: string[] }): MockItem {
  return {
    id: id(), kind: "note", platform: o.platform, model: "notes", title: o.title, body: o.text, occurredAt: o.updated,
    url: o.platform === "hubspot" ? "https://app.hubspot.com/contacts/4410022/record/0-3/1001" : "https://app.attio.com/acme/notes",
    facets: { kind: "note", parentKind: o.parentKind, parentTitle: o.parentTitle }, people: [P(o.author, "author"), ...o.about.map((a) => P(a, "about"))], lane: "fyi", importance: 0.5,
    parts: [sec(null, o.text)], by: "fixture",
  };
}

export const ITEMS: MockItem[] = [
  // Globex renewal
  deal({ platform: "hubspot", name: "Globex renewal 2027", company: "ent_globex", amount: 84000, stage: "Contract sent", close: at(16), owner: "ent_dana", contacts: ["ent_priya", "ent_marco"], updated: ago(20), note: "Annual renewal for Globex, 240 seats. Contract sent Oct 24. Priya Shah is the champion; Marco Bellini owns legal review. Risk: Priya asked for a multi-year discount before signing.", lane: "needs_you" }),
  mail({ title: "Re: Globex renewal terms", from: "ent_priya", to: ["ent_dana"], lane: "needs_you", importance: 0.9, unread: true, attach: true, parts: [
    msg("Dana Oyelaran", at(-6, 9, 12), "Hi Priya, attaching the renewal order form for 2027. Same 240 seats, list price $84,000 a year. Happy to walk through it this week."),
    msg("Priya Shah", at(-5, 16, 40), "Thanks Dana. Finance is fine with the seat count. They want to understand the uplift versus this year before we route it to legal."),
    msg("Dana Oyelaran", at(-4, 11, 5), "Uplift is 6 percent, all from the SSO and audit log add-ons your team asked for. I can share the usage breakdown."),
    msg("Priya Shah", at(-1, 18, 22), "That helps. Marco will send the redline separately. One more thing: if we sign for two years, can you hold the 2027 price?"),
    msg("Priya Shah", ago(6), "Following up on the multi-year question. If we can get an answer by Thursday I can get this signed before the 14th."),
  ] }),
  mail({ title: "Globex legal redline, final", platform: "outlook-mail", from: "ent_marco", to: ["ent_dana"], extra: [P("ent_priya", "cc")], lane: "needs_you", importance: 0.85, attach: true, parts: [
    msg("Marco Bellini", at(-2, 15, 10), "Dana, attached is our final redline of the 2027 order form. Two changes: the liability cap moves to 12 months of fees, and the data processing addendum references the EU SCCs. Everything else is accepted. Priya is copied."),
  ] }),
  event({ title: "Globex x Acme contract review", start: at(-3, 14, 0), mins: 45, organizer: "ent_dana", attendees: ["ent_priya", "ent_marco", "ent_sam"], join: "https://meet.google.com/abc-defg-hij", desc: "Walk through the 2027 order form and Marco's open questions on liability and the DPA." }),
  meeting({ title: "Globex contract review", start: at(-3, 14, 0), mins: 42, attendees: ["ent_dana", "ent_priya", "ent_marco", "ent_sam"], summary: "Reviewed the 2027 renewal order form with Globex. Legal is close to done. Priya asked for a multi-year discount before signing and said budget is approved for one year at list.", takeaways: ["Priya asked for a multi-year discount before signing", "Marco will send the final redline by Monday", "Sam to prepare a two-year pricing option", "Target signature before Nov 14"], lane: "needs_you" }),
  message({ channel: "#deals", channelType: "channel", sender: "ent_dana", text: "Globex is basically closed, waiting on signature. Only open item is Priya's multi-year ask.", atIso: ago(26), replies: [msg("Sam Okafor", ago(25), "I'll have the two-year option in the deal desk sheet by tomorrow."), msg("Theo Lund", ago(24), "SSO rollout for them is on track, ACME-311 ships next week.")], mentions: ["ent_priya"] }),
  issue({ key: "ACME-311", title: "SSO for Globex rollout", state: "In Progress", stateType: "started", assignee: "ent_mia", priority: 2, due: at(5), project: "Enterprise", body: "Globex needs SAML SSO with Okta before they roll Acme out to all 240 seats. Customer: Globex (Priya Shah).", updated: ago(30), about: ["ent_priya", "ent_globex"], comments: [msg("Mia Park", ago(30), "SAML handshake works in staging. Waiting on Globex's metadata file.")] }),
  doc({ title: "Globex account plan", parent: "Accounts", editedBy: "ent_dana", updated: at(-9, 13), about: ["ent_priya", "ent_marco"], sections: [
    sec("Summary", "Globex is our largest account in enterprise software. 240 seats, renewing at $84,000 for 2027."),
    sec("People", "Priya Shah (VP Partnerships) is the champion. Marco Bellini runs legal. Finance signs anything over $50,000."),
    sec("Risks", "Multi-year discount request. SSO rollout timing (ACME-311)."),
  ] }),
  person({ platform: "hubspot", ent: "ent_priya", lifecycle: "Customer", owner: "ent_dana", updated: at(-1, 9), note: "Champion on the Globex renewal." }),
  person({ platform: "attio", ent: "ent_priya", lifecycle: "Customer", owner: "ent_dana", updated: at(-2, 11), note: "Moved from HubSpot. Prefers email over calls." }),
  company({ platform: "hubspot", ent: "ent_globex", industry: "Enterprise software", size: "1,200", owner: "ent_dana", updated: at(-1, 9) }),
  company({ platform: "attio", ent: "ent_globex", industry: "Enterprise software", size: "1,200", owner: "ent_dana", updated: at(-2, 11) }),
  note({ platform: "hubspot", title: "Call notes: Globex renewal pricing", text: "Priya confirmed budget for one year at list. Wants a two-year price hold. Marco needs the DPA with SCCs.", author: "ent_dana", updated: at(-3, 15, 10), parentKind: "deal", parentTitle: "Globex renewal 2027", about: ["ent_priya", "ent_globex"] }),
  person({ platform: "hubspot", ent: "ent_marco", lifecycle: "Customer", owner: "ent_dana", updated: at(-2, 15) }),

  // Initech pilot
  deal({ platform: "attio", name: "Initech pilot", company: "ent_initech", amount: 36000, stage: "Discovery", close: at(40), owner: "ent_dana", contacts: ["ent_ravi"], updated: at(-2, 10), note: "Paid pilot, 60 days. Ravi Menon wants to import three years of ledger data. Blocker: CSV import fails over 50 MB (ACME-298)." }),
  mail({ title: "Pilot data import", from: "ent_ravi", to: ["ent_dana"], extra: [P("ent_mia", "cc")], lane: "needs_you", importance: 0.75, parts: [
    msg("Ravi Menon", at(-4, 8, 30), "Dana, our first import of the 2023 ledger failed at about 60 MB. Is there a size limit we missed?"),
    msg("Dana Oyelaran", at(-4, 10, 2), "Thanks Ravi, looping in Mia. It's a known limit we're lifting now."),
    msg("Mia Park", at(-3, 9, 48), "Ravi, the fix splits large files server side. Should land this week. In the meantime 40 MB chunks work."),
    msg("Ravi Menon", at(-1, 17, 15), "Chunks worked for 2023. Can we confirm the fix before we try 2021 and 2022?"),
  ] }),
  event({ title: "Initech pilot kickoff", start: at(-6, 11, 0), mins: 60, organizer: "ent_dana", attendees: ["ent_ravi", "ent_mia", "ent_theo"], join: "https://meet.google.com/kik-off-ini", desc: "Kickoff for the 60-day Initech pilot: goals, data import plan, success criteria." }),
  meeting({ title: "Initech pilot kickoff", start: at(-6, 11, 0), mins: 55, attendees: ["ent_dana", "ent_ravi", "ent_mia", "ent_theo"], summary: "Agreed the pilot goals with Ravi: three years of ledger history imported, reconciliation under 2 minutes, weekly check-ins.", takeaways: ["Success means three years of data reconciled", "Mia owns the import path", "Weekly check-in on Tuesdays", "Ravi needs SOC 2 report under NDA"] }),
  issue({ key: "ACME-298", title: "CSV import fails over 50 MB", state: "In Review", stateType: "started", assignee: "ent_mia", priority: 1, project: "Pilots", body: "Uploads over 50 MB time out at the gateway. Initech's ledger export is 60 to 180 MB per year.", updated: ago(9), about: ["ent_ravi", "ent_initech"], comments: [msg("Mia Park", ago(9), "PR up: streaming parser plus server-side chunking. Tested with a 180 MB file."), msg("Theo Lund", ago(8), "Let's ship behind a flag for Initech first.")] }),
  message({ channel: "#eng", channelType: "channel", sender: "ent_mia", text: "Streaming CSV import is in review. Initech's 180 MB test file goes through in 41 seconds.", atIso: ago(8), replies: [msg("Theo Lund", ago(7), "Nice. Flag it for Initech first."), msg("Dana Oyelaran", ago(7), "Telling Ravi today.")], mentions: ["ent_ravi"] }),
  doc({ title: "Pilot playbook", parent: "Sales", editedBy: "ent_theo", updated: at(-12, 10), sections: [sec("Before kickoff", "Agree success criteria in writing. Name an owner on each side."), sec("During", "Weekly check-ins. Share a usage report every Friday."), sec("Closing", "Convert to annual at the 45-day mark when criteria are met.")] }),
  person({ platform: "attio", ent: "ent_ravi", lifecycle: "Pilot", owner: "ent_dana", updated: at(-1, 17) }),
  company({ platform: "attio", ent: "ent_initech", industry: "Data infrastructure", size: "340", owner: "ent_dana", updated: at(-2, 10) }),
  note({ platform: "attio", title: "Initech champion map", text: "Ravi is the champion and budget owner. Their head of finance reviews anything above $30,000.", author: "ent_dana", updated: at(-5, 16), parentKind: "deal", parentTitle: "Initech pilot", about: ["ent_ravi", "ent_initech"] }),

  // Umbrella EU expansion
  deal({ platform: "hubspot", name: "Umbrella EU expansion", company: "ent_umbrella", amount: 120000, currency: "EUR", stage: "Negotiation", close: at(30), owner: "ent_lena", contacts: ["ent_hannah"], updated: at(-1, 14), note: "Expansion to Umbrella's EU entities. Procurement questionnaire in progress. Needs EU data residency in writing." }),
  mail({ title: "Procurement questionnaire", platform: "outlook-mail", from: "ent_hannah", to: ["ent_dana"], extra: [P("ent_lena", "cc")], lane: "waiting", importance: 0.7, attach: true, parts: [
    msg("Hannah Cole", at(-7, 9, 0), "Hello Dana, please find our vendor questionnaire attached. We need it back before the procurement call."),
    msg("Dana Oyelaran", at(-5, 12, 30), "Hi Hannah, completed questionnaire attached. Lena can answer anything on EU hosting."),
  ] }),
  event({ title: "Umbrella procurement call", platform: "outlook-calendar", start: at(1, 15, 0), mins: 30, organizer: "ent_hannah", attendees: ["ent_dana", "ent_lena"], join: "https://teams.microsoft.com/l/meetup-join/umbrella", desc: "Procurement review of Acme for the EU expansion. Agenda: questionnaire follow-ups, data residency, pricing.", self: "needsAction", color: "#5b7268", lane: "needs_you" }),
  message({ platform: "teams", channel: "Dana, Lena", channelType: "chat", sender: "ent_lena", text: "Umbrella will push on price again. I'd hold at EUR 120,000 and offer EU residency at no extra cost.", atIso: at(-1, 16, 20), replies: [msg("Dana Oyelaran", at(-1, 16, 31), "Agreed. Let's not discount before the procurement call.")], mentions: ["ent_hannah"] }),
  meeting({ title: "Umbrella discovery call", start: at(-12, 15, 0), mins: 35, attendees: ["ent_dana", "ent_lena", "ent_hannah"], summary: "Umbrella wants Acme in four EU entities. Procurement leads. Data residency is a must.", takeaways: ["EU data residency is required", "Hannah runs a formal questionnaire", "Decision in about six weeks"] }),
  company({ platform: "hubspot", ent: "ent_umbrella", industry: "Life sciences", size: "5,400", owner: "ent_lena", updated: at(-1, 14) }),
  person({ platform: "hubspot", ent: "ent_hannah", lifecycle: "Opportunity", owner: "ent_lena", updated: at(-5, 12) }),
  issue({ key: "ACME-305", title: "Audit log export for Umbrella", state: "Todo", stateType: "unstarted", assignee: "ent_mia", priority: 3, project: "Enterprise", body: "Umbrella procurement asks for a monthly audit log export to their SIEM.", updated: at(-4, 10), about: ["ent_hannah", "ent_umbrella"] }),
  message({ channel: "#deals", channelType: "channel", sender: "ent_lena", text: "Umbrella wants EU data residency in writing before the procurement call.", atIso: at(-2, 10, 5), mentions: ["ent_hannah"] }),

  // Northwind investor update
  mail({ title: "Q3 update and board date", from: "ent_owen", to: ["ent_dana"], lane: "vip", importance: 0.8, unread: true, parts: [
    msg("Owen Price", at(-3, 7, 45), "Dana, can you send the Q3 numbers ahead of the board meeting? Also proposing Nov 20 for the board date."),
    msg("Dana Oyelaran", at(-2, 9, 10), "Will do. Draft update is in Notion, final by Friday. Nov 20 works."),
  ] }),
  doc({ title: "Q3 investor update", parent: "Board", editedBy: "ent_dana", updated: at(-1, 19), about: ["ent_owen"], sections: [sec("Headline", "Net revenue retention 118 percent. Two enterprise renewals in flight (Globex, Umbrella)."), sec("Pipeline", "Globex renewal $84,000 in Contract sent. Umbrella EU EUR 120,000 in Negotiation. Initech pilot in Discovery."), sec("Asks", "Intros to procurement leads in life sciences.")] }),
  event({ title: "Northwind board prep", start: at(4, 9, 30), mins: 60, organizer: "ent_dana", attendees: ["ent_theo", "ent_owen"], desc: "Prep the board deck. Q3 numbers, pipeline, hiring.", lane: "fyi" }),
  message({ channel: "Dana, Theo", channelType: "dm", sender: "ent_theo", text: "Added the Ledger 2.0 slide to the investor update. Can you check the pipeline numbers?", atIso: at(-1, 20, 5) }),

  // Ledger 2.0 (internal)
  doc({ title: "Ledger 2.0", platform: "linear", model: "projects", parent: "Projects", editedBy: "ent_theo", updated: at(-1, 12), sections: [sec("Goal", "Usage-based billing and a redesigned invoice PDF. Launch target Nov 18."), sec("Status", "On track. 2 of 5 milestones done.")] }),
  issue({ key: "LED-142", title: "Ship usage-based billing", state: "In Progress", stateType: "started", assignee: "ent_theo", priority: 1, due: at(19), project: "Ledger 2.0", body: "Meter API calls per workspace, invoice monthly. Migration plan in the billing doc.", updated: at(-1, 15) }),
  issue({ key: "LED-158", title: "Invoice PDF redesign", state: "Todo", stateType: "unstarted", assignee: "ent_mia", priority: 3, project: "Ledger 2.0", body: "New invoice layout with line-item usage and EU VAT fields.", updated: at(-3, 11) }),
  doc({ title: "Ledger 2.0 launch plan", parent: "Product", editedBy: "ent_theo", updated: at(-2, 17), about: ["ent_mia", "ent_dana"], sections: [sec("Launch", "Go/no-go on the 31st. Customers on the old plan get 60 days notice."), sec("Sales", "Dana's team gets pricing FAQs a week before launch.")] }),
  message({ platform: "teams", channel: "Eng sync", channelType: "group", sender: "ent_mia", text: "Ledger 2.0: metering is done, invoice PDF starts Monday. Go/no-go still on track.", atIso: at(-1, 9, 40) }),
  event({ title: "Ledger 2.0 go/no-go", platform: "outlook-calendar", start: at(2, 16, 0), mins: 30, organizer: "ent_theo", attendees: ["ent_dana", "ent_mia", "ent_lena"], join: "https://teams.microsoft.com/l/meetup-join/ledger", desc: "Decide on the Ledger 2.0 launch date.", color: "#5b7268" }),
  doc({ title: "Billing migration notes", platform: "linear", model: "documents", parent: "Ledger 2.0", editedBy: "ent_theo", updated: at(-4, 14), sections: [sec("Plan", "Move every workspace to metered billing in three waves. Enterprise contracts keep their annual price until renewal.")] }),

  // Calendar regulars
  event({ title: "Weekly pipeline review", start: at(-1, 10, 0), mins: 45, organizer: "ent_sam", attendees: ["ent_dana", "ent_lena"], join: "https://meet.google.com/pip-elin-rev", desc: "Walk the pipeline: Globex, Umbrella, Initech, new leads." }),
  meeting({ title: "Weekly pipeline review", start: at(-1, 10, 0), mins: 44, attendees: ["ent_sam", "ent_dana", "ent_lena"], summary: "Globex at Contract sent, Umbrella in Negotiation, Initech pilot import unblocked soon.", takeaways: ["Sam drafts the Globex two-year option", "Lena prepares EU residency letter", "Follow up with Hooli lead next week"] }),
  event({ title: "1:1 Dana and Sam", start: at(1, 11, 30), mins: 30, organizer: "ent_dana", attendees: ["ent_sam"], desc: "Weekly 1:1." }),

  // Noise
  mail({ title: "Quick idea for Acme's pipeline", from: "ent_jules", to: ["ent_dana"], lane: "low", importance: 0.1, parts: [msg("Jules Martin", at(-2, 6, 15), "Hi Dana, we help sales teams like Acme's book 30 percent more meetings. Open to a 15 minute chat next week?")] }),
  person({ platform: "attio", ent: "ent_jules", lifecycle: "Lead", updated: at(-2, 7) }),
  company({ platform: "attio", ent: "ent_hooli", industry: "Developer tools", size: "40", updated: at(-2, 7) }),
  company({ platform: "attio", ent: "ent_northwind", industry: "Venture capital", size: "25", updated: at(-20, 9) }),
  person({ platform: "hubspot", ent: "ent_owen", lifecycle: "Other", updated: at(-20, 9) }),
  message({ channel: "#eng", channelType: "channel", sender: "ent_mia", text: "Deploy finished: api v2026.10.3 to production.", atIso: ago(3), lane: "low" }),
  message({ channel: "#sales", channelType: "channel", sender: "ent_sam", text: "Pipeline review moves to Thursday this week. Bring your forecast changes.", atIso: at(-3, 8, 50) }),
  deal({ platform: "hubspot", name: "Hooli starter plan", company: "ent_hooli", amount: 12000, stage: "Qualified", close: at(45), owner: "ent_sam", contacts: ["ent_jules"], updated: at(-2, 12), note: "Inbound from Jules. Small team, monthly plan likely." }),
  note({ platform: "hubspot", title: "Call notes: Umbrella pricing", text: "Hannah pushed for 15 percent off. We held. EU residency included at no cost.", author: "ent_lena", updated: at(-8, 16), parentKind: "deal", parentTitle: "Umbrella EU expansion", about: ["ent_hannah", "ent_umbrella"] }),
];

// Newsletters and receipts: senders that are not people in the cast.
for (const [title, from, text, d] of [
  ["The Revenue Brief: pricing pages that convert", "The Revenue Brief", "This week: why annual discounts work better than monthly ones, and five pricing pages to study.", -1],
  ["SaaS Weekly #212", "SaaS Weekly", "Net revenue retention benchmarks for 2026, and what top quartile teams do differently.", -3],
  ["Product Digest: October", "Product Digest", "Ten launches worth reading about this month.", -6],
  ["Your receipt from Skyline Air", "Skyline Air", "Receipt for SFO to AUS, November 6. Total $412.20.", -4],
  ["Invoice for October", "Acme Cloud Billing", "Your October invoice is ready. Amount due $1,284.00.", -2],
] as const) {
  const i = id();
  ITEMS.push({ id: i, kind: "email_thread", platform: "gmail", model: "threads", title, body: text, occurredAt: at(d, 7, 0), url: `https://mail.google.com/mail/u/0/#all/${i}`, container: "Inbox",
    facets: { kind: "email_thread", messageCount: 1, lastFrom: from, folder: "Inbox" }, people: [P("ent_dana", "to")], lane: "low", importance: 0.05,
    parts: [{ kind: "message", title: null, author: from, at: at(d, 7, 0), text }], by: "rules" });
}

export const item = (id: string) => ITEMS.find((i) => i.id === id);
export const ME = entity("ent_dana");
