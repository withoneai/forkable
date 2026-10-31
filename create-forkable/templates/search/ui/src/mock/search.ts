// The mock's search: the operator grammar applied in memory, a plain term
// score instead of hybrid RRF, highlights as character ranges. Close enough to
// exercise every screen; the real ranking lives in @search/core.
import type {
  EntityChip, EntityDetail, ItemDetail, ItemKind, OperatorKey, OpValue, ParsedQuery, ResultRow, SearchResponse, SuggestResponse,
} from "@/contract/api-types";
import { parseQuery, resolveDate } from "@/contract/query";
import { fmtMoney, fmtRange, logoUrl, platformName } from "@/lib/utils";
import { ENTITIES, entity, ITEMS, ME, type MockEntity, type MockItem } from "./world";
import { recent, settings, sources } from "./state";

const TYPE_ALIAS: Record<string, ItemKind> = {
  mail: "email_thread", email: "email_thread", thread: "email_thread", email_thread: "email_thread", event: "event", meeting: "meeting_note", meeting_note: "meeting_note",
  person: "person", people: "person", company: "company", doc: "doc", page: "doc", issue: "task", task: "task", message: "message", chat: "message",
  note: "note", deal: "deal", record: "record", calendar: "event",
};
const SOURCE_ALIAS: Record<string, string> = { outlook: "outlook-mail", calendar: "google-calendar", gcal: "google-calendar" };

function personMatches(value: string, entityId: string): boolean {
  const e = ENTITIES.find((x) => x.id === entityId);
  if (!e) return false;
  const v = value.toLowerCase();
  if (v === "me") return !!e.isSelf && e.type === "person";
  if (e.emails.some((m) => m.toLowerCase() === v)) return true;
  if (e.domain && (v === e.domain || v.endsWith(`@${e.domain}`))) return true;
  return e.name.toLowerCase().startsWith(v) || e.name.toLowerCase().split(" ").some((p) => p.startsWith(v)) || e.name.toLowerCase() === v;
}

const ROLE_SETS: Partial<Record<OperatorKey, string[]>> = {
  from: ["from", "author", "organizer"],
  to: ["to", "cc", "attendee", "assignee"],
};

function textValues(vals: OpValue[]): string[] {
  return vals.map((v) => (v.t === "text" ? v.v : v.t === "date" ? v.v : v.t === "cmp" ? String(v.v) : `${v.from}..${v.to}`));
}

function dateMatch(key: OperatorKey, vals: OpValue[], iso: string): boolean {
  const t = new Date(iso).getTime();
  return vals.some((v) => {
    if (v.t === "date") {
      const from = new Date(v.resolved.from).getTime(), to = new Date(v.resolved.to).getTime();
      if (key === "before") return t < from;
      if (key === "after") return t >= from;
      return t >= from && t < to;
    }
    if (v.t === "range") {
      const a = resolveDate(v.from), b = resolveDate(v.to);
      return !!a && !!b && t >= new Date(a.from).getTime() && t < new Date(b.to).getTime();
    }
    if (v.t === "cmp") {
      const r = resolveDate(String(v.v));
      if (!r) return true;
      const x = new Date(r.from).getTime();
      return v.op === ">" || v.op === ">=" ? t >= x : t <= x;
    }
    return true;
  });
}

function matchesOp(it: MockItem, key: OperatorKey, vals: OpValue[]): boolean {
  const tv = textValues(vals).map((v) => v.toLowerCase());
  switch (key) {
    case "source": return tv.some((v) => it.platform === (SOURCE_ALIAS[v] ?? v) || platformName(it.platform).toLowerCase() === v);
    case "type": return tv.some((v) => it.kind === (TYPE_ALIAS[v] ?? v));
    case "is": return tv.every((v) => {
      if (v === "unread") return it.facets.kind === "email_thread" && !!it.facets.unread;
      if (v === "vip") return it.lane === "vip" || it.people.some((p) => settings.vipEntityIds.includes(p.entityId));
      if (v === "needs-you") return it.lane === "needs_you";
      if (v === "waiting") return it.lane === "waiting";
      if (v === "mine") return it.people.some((p) => p.entityId === "ent_dana" && ["owner", "assignee", "organizer"].includes(p.role));
      if (v === "open") return !/done|closed|lost|won|completed|canceled/i.test(it.status ?? "");
      if (v === "upcoming") return new Date(it.occurredAt).getTime() > Date.now();
      if (v === "past") return new Date(it.occurredAt).getTime() <= Date.now();
      return true;
    });
    case "from": case "to": return tv.some((v) => it.people.some((p) => ROLE_SETS[key]!.includes(p.role) && personMatches(v, p.entityId)));
    case "with": return tv.some((v) => it.people.some((p) => personMatches(v, p.entityId)) || (entity(it.people[0]?.entityId ?? "ent_dana") && false));
    case "about": return tv.some((v) => it.people.some((p) => (p.role === "about" || p.role === "mentioned") && personMatches(v, p.entityId)) || it.title.toLowerCase().includes(v));
    case "before": case "after": case "on": case "updated": case "during": return dateMatch(key, vals, key === "updated" ? (it.updatedAt ?? it.occurredAt) : it.occurredAt);
    case "has": return tv.some((v) => (v === "attachment" ? it.facets.kind === "email_thread" && !!it.facets.hasAttachment : v === "joinurl" ? it.facets.kind === "event" && !!it.facets.joinUrl : v === "link" ? !!it.url : false));
    case "status": case "stage": return tv.some((v) => (it.status ?? "").toLowerCase().startsWith(v));
    case "lane": return tv.some((v) => (it.lane ?? "").replace("_", "-") === v);
    case "account": return true; // the mock has one account per platform
    case "label": return tv.some((v) => (it.labels ?? []).some((l) => l.toLowerCase().startsWith(v)));
    case "container": return tv.some((v) => (it.container ?? "").toLowerCase().startsWith(v));
    case "amount": return vals.every((v) => {
      const amt = it.facets.kind === "deal" ? it.facets.amount ?? 0 : null;
      if (amt == null) return false;
      if (v.t === "cmp") { const n = Number(v.v); return v.op === ">" ? amt > n : v.op === ">=" ? amt >= n : v.op === "<" ? amt < n : amt <= n; }
      return String(amt) === (v.t === "text" ? v.v : "");
    });
    case "id": return tv.some((v) => it.id === v || (it.facets.kind === "task" && (it.facets.key ?? "").toLowerCase() === v));
  }
}

function terms(q: ParsedQuery): { words: string[]; neg: string[]; phrases: string[] } {
  const words: string[] = [], neg: string[] = [], phrases: string[] = [];
  for (const c of q.clauses) {
    if (c.kind === "word") (c.negate ? neg : words).push(c.value.toLowerCase().replace(/[?.,!]/g, ""));
    if (c.kind === "phrase") (c.negate ? neg : phrases).push(c.value.toLowerCase());
  }
  const STOP = new Set(["the", "a", "an", "with", "are", "we", "where", "what", "who", "when", "did", "does", "is", "of", "to", "and", "about", "how", "on", "in", "for", "my", "me", "i"]);
  return { words: words.filter((w) => w && !STOP.has(w)), neg, phrases };
}

function haystack(it: MockItem): string {
  const ppl = it.people.map((p) => entity(p.entityId)?.name ?? "").join(" ");
  return `${it.title} ${it.body} ${ppl} ${it.container ?? ""} ${it.status ?? ""} ${platformName(it.platform)} ${it.facets.kind === "task" ? it.facets.key ?? "" : ""}`.toLowerCase();
}

function score(it: MockItem, t: ReturnType<typeof terms>): number {
  if (!t.words.length && !t.phrases.length) return 1;
  const h = haystack(it);
  const title = it.title.toLowerCase();
  let s = 0;
  let hits = 0;
  for (const w of t.words) {
    const stem = w.length > 4 ? w.replace(/s$/, "") : w;
    if (h.includes(stem)) { hits++; s += 1 + (title.includes(stem) ? 2 : 0); }
  }
  for (const p of t.phrases) if (h.includes(p)) { hits++; s += 3; }
  const need = t.words.length + t.phrases.length;
  if (hits === 0 || hits < Math.ceil(need * 0.6)) return 0;
  if (t.neg.some((n) => h.includes(n))) return 0;
  const age = (Date.now() - new Date(it.occurredAt).getTime()) / 86_400_000;
  return s * (1 + 0.15 * (it.importance ?? 0.5)) * (0.85 + 0.15 * Math.exp(-Math.abs(age) / 90));
}

function ranges(text: string, words: string[]): [number, number][] {
  const out: [number, number][] = [];
  const low = text.toLowerCase();
  for (const w of words) {
    if (w.length < 2) continue;
    const stem = w.length > 4 ? w.replace(/s$/, "") : w;
    let i = low.indexOf(stem);
    while (i >= 0) { out.push([i, i + stem.length]); i = low.indexOf(stem, i + stem.length); }
  }
  return out.sort((a, b) => a[0] - b[0]);
}

function snippetFor(it: MockItem, words: string[]): { snippet: string | null; hl: [number, number][] } {
  const body = it.body.replace(/\s+/g, " ").trim();
  if (!body) return { snippet: null, hl: [] };
  const low = body.toLowerCase();
  const first = words.map((w) => low.indexOf(w.length > 4 ? w.replace(/s$/, "") : w)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
  const start = first == null ? 0 : Math.max(0, first - 60);
  let s = body.slice(start, start + 200);
  if (start > 0) s = `...${s}`;
  return { snippet: s, hl: ranges(s, words) };
}

function contextFor(it: MockItem): string | null {
  const f = it.facets;
  switch (f.kind) {
    case "email_thread": return f.messageCount > 1 ? `(${f.messageCount})` : null;
    case "event": return fmtRange(f.start, f.end);
    case "person": return [f.jobTitle, f.companyName].filter(Boolean).join(" at ") || null;
    case "company": return f.domain ?? null;
    case "doc": return f.parentTitle ? `in ${f.parentTitle}` : null;
    case "task": return f.state ?? null;
    case "message": return f.channel ?? null;
    case "meeting_note": return f.durationMin ? `${f.durationMin} min` : null;
    case "deal": return [f.companyName, f.stage].filter(Boolean).join(" · ");
    case "note": return f.parentTitle ? `on ${f.parentTitle}` : null;
    default: return null;
  }
}

export function toRow(it: MockItem, words: string[] = []): ResultRow {
  const sn = snippetFor(it, words);
  const src = [...sources.values()].find((s) => s.def.platform === it.platform && s.def.model === it.model);
  return {
    id: it.id, kind: it.kind, platform: it.platform, sourceId: src?.def.id ?? `src_${it.platform}`, sourceName: platformName(it.platform), logoUrl: logoUrl(it.platform),
    title: it.title, titleHighlights: ranges(it.title, words), context: contextFor(it), snippet: sn.snippet, snippetHighlights: sn.hl,
    occurredAt: it.occurredAt, updatedAt: it.updatedAt ?? null, url: it.url,
    people: it.people.filter((p) => ENTITIES.some((e) => e.id === p.entityId && e.type === "person")).map((p) => ({ entityId: p.entityId, name: entity(p.entityId).name, role: p.role, avatarUrl: null })),
    facets: it.facets, lane: it.lane, importance: it.importance, groupCount: 1, score: 0, ranks: { kw: null, vec: null, title: null, rerank: null },
  };
}

let qid = 0;
export const lastQueries = new Map<string, string[]>();

export function search(q: string, scope: ItemKind | "all", sort: string, limit = 30): SearchResponse {
  const t0 = performance.now();
  const parsed = parseQuery(q);
  const ops = parsed.clauses.filter((c) => c.kind === "op") as Extract<ParsedQuery["clauses"][number], { kind: "op" }>[];
  const t = terms(parsed);
  // Same key ORs, different keys AND, "-" negates.
  const byKey = new Map<string, typeof ops>();
  for (const o of ops) byKey.set(`${o.key}${o.negate ? "!" : ""}`, [...(byKey.get(`${o.key}${o.negate ? "!" : ""}`) ?? []), o]);
  const passOps = (it: MockItem) => [...byKey.values()].every((group) => {
    const neg = group[0]!.negate;
    const any = group.some((o) => matchesOp(it, o.key, o.values));
    return neg ? !any : any;
  });
  const scored = ITEMS.map((it) => ({ it, s: score(it, t) })).filter((x) => x.s > 0);
  const filtered = scored.filter((x) => passOps(x.it));
  const hiddenByFilters = ops.length && (t.words.length || t.phrases.length) ? scored.length - filtered.length : 0;
  const scopeCounts = { all: filtered.length } as Record<ItemKind | "all", number>;
  const sourceCounts: Record<string, number> = {};
  for (const { it } of filtered) { scopeCounts[it.kind] = (scopeCounts[it.kind] ?? 0) + 1; sourceCounts[it.platform] = (sourceCounts[it.platform] ?? 0) + 1; }
  let list = filtered.filter((x) => scope === "all" || x.it.kind === scope);
  const textless = !t.words.length && !t.phrases.length;
  if (sort === "newest" || textless) list = list.sort((a, b) => b.it.occurredAt.localeCompare(a.it.occurredAt));
  else if (sort === "oldest") list = list.sort((a, b) => a.it.occurredAt.localeCompare(b.it.occurredAt));
  else list = list.sort((a, b) => b.s - a.s);
  const words = [...t.words, ...t.phrases];
  const results = list.slice(0, limit).map(({ it, s }, i) => ({ ...toRow(it, words), score: Number(s.toFixed(4)), ranks: { kw: i + 1, vec: null, title: null, rerank: null } }));
  // People and companies that match strongly: the top strip.
  const ents = textless ? [] : ENTITIES.filter((e) => !e.isSelf && t.words.some((w) => e.name.toLowerCase().split(" ").some((p) => p.startsWith(w)) || (e.domain ?? "").startsWith(w))).slice(0, 3).map(entityChip);
  const id = `q_${++qid}`;
  lastQueries.set(id, results.map((r) => r.id));
  if (q.trim() && !recent.some((r) => r.query === q.trim())) recent.unshift({ query: q.trim(), at: new Date().toISOString(), resultCount: filtered.length });
  return {
    queryId: id, parsed, total: filtered.length, hiddenByFilters, counts: { scope: scopeCounts, source: sourceCounts }, entities: ents, results,
    mode: "hybrid", embedder: { model: "local:hash-v1", semantic: false, reason: "sample", platform: null, message: null }, fallback: null, dateProposals: [], didYouMean: null, ms: Math.max(4, Math.round(performance.now() - t0) + 6),
  };
}

export function entityChip(e: MockEntity): EntityChip {
  const items = ITEMS.filter((i) => i.people.some((p) => p.entityId === e.id));
  const co = e.companyId ? entity(e.companyId) : null;
  return {
    id: e.id, type: e.type, name: e.name, subtitle: e.type === "person" ? [e.title, co?.name].filter(Boolean).join(", ") : e.domain, avatarUrl: null,
    logoUrl: null, itemCount: items.length, sources: [...new Set(items.map((i) => i.platform))], isSelf: !!e.isSelf, email: e.emails[0] ?? null,
  };
}

export function itemDetail(it: MockItem): ItemDetail {
  const words: string[] = [];
  const row = toRow(it, words);
  const f = it.facets;
  const props: { label: string; value: string }[] = [...(it.properties ?? [])];
  if (f.kind === "deal") props.push({ label: "Amount", value: fmtMoney(f.amount, f.currency) }, { label: "Close date", value: new Date(f.closeDate!).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) }, { label: "Owner", value: f.owner ?? "" }, { label: "Company", value: f.companyName ?? "" });
  if (f.kind === "task") props.push({ label: "Status", value: f.state ?? "" }, { label: "Assignee", value: f.assignee ?? "" }, { label: "Priority", value: ["No priority", "Urgent", "High", "Medium", "Low"][f.priority ?? 0]! }, { label: "Project", value: f.project ?? "" }, ...(f.due ? [{ label: "Due", value: new Date(f.due).toLocaleDateString(undefined, { month: "short", day: "numeric" }) }] : []));
  if (f.kind === "person") props.push({ label: "Email", value: f.email ?? "" }, { label: "Title", value: f.jobTitle ?? "" }, { label: "Company", value: f.companyName ?? "" }, { label: "Lifecycle", value: f.lifecycle ?? "" }, { label: "Owner", value: f.owner ?? "" });
  if (f.kind === "company") props.push({ label: "Domain", value: f.domain ?? "" }, { label: "Industry", value: f.industry ?? "" }, { label: "Size", value: f.size ?? "" }, { label: "Owner", value: f.owner ?? "" });
  if (f.kind === "doc") props.push({ label: "In", value: f.parentTitle ?? "" }, { label: "Edited by", value: f.editedBy ?? "" }, { label: "Words", value: String(f.wordCount ?? "") });
  if (f.kind === "note") props.push({ label: "On", value: f.parentTitle ?? "" });
  const related = ITEMS.filter((o) => o.id !== it.id && o.people.some((p) => it.people.some((q) => q.entityId === p.entityId && !entity(p.entityId).isSelf))).slice(0, 5).map((o) => toRow(o));
  return {
    row, body: it.body, bodyHighlights: [], parts: it.parts ?? [], properties: props.filter((p) => p.value),
    classification: { lane: it.lane, importance: it.importance, kindGuess: it.kind === "email_thread" ? (it.lane === "low" ? "newsletter" : "customer") : null, needsYou: it.lane === "needs_you" ? 0.86 : 0.12, by: it.by ?? "fixture" },
    related, rawAvailable: true,
  };
}

export function entityDetail(e: MockEntity): EntityDetail {
  const items = ITEMS.filter((i) => i.people.some((p) => p.entityId === e.id) || (e.type === "company" && i.people.some((p) => entity(p.entityId).companyId === e.id)));
  const bySrc = new Map<string, { count: number; lastAt: string }>();
  for (const i of items) { const c = bySrc.get(i.platform); bySrc.set(i.platform, { count: (c?.count ?? 0) + 1, lastAt: !c || i.occurredAt > c.lastAt ? i.occurredAt : c.lastAt }); }
  return {
    entity: { id: e.id, type: e.type, name: e.name, emails: e.emails, domain: e.domain, title: e.title, company: e.companyId ? entityChip(entity(e.companyId)) : null, avatarUrl: null, isSelf: !!e.isSelf, sources: [...bySrc.entries()].map(([platform, v]) => ({ platform, ...v })) },
    timeline: items.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 50).map((i) => toRow(i)),
    pendingMatches: e.id === "ent_priya" ? [] : e.id === "ent_hannah" ? [{ matchId: "mt_1", other: { id: "ent_hcole", type: "person", name: "H. Cole", subtitle: "hcole@umbrella-eu.co", avatarUrl: null, logoUrl: null, itemCount: 1, sources: ["teams"], isSelf: false, email: "hcole@umbrella-eu.co" }, probability: 0.71, reason: "Same surname and company, a different email domain" }] : [],
  };
}

export function suggest(prefix: string): SuggestResponse {
  const m = /(-?)([a-z]+):("?[^\s"]*)$/i.exec(prefix);
  const operators: SuggestResponse["operators"] = [];
  let entities: EntityChip[] = [];
  if (m) {
    const key = m[2]!.toLowerCase(), part = m[3]!.replace(/^"/, "").toLowerCase();
    if (["from", "to", "with", "about"].includes(key)) {
      const hits = ENTITIES.filter((e) => (e.type === "person" || key === "with") && (e.name.toLowerCase().split(" ").some((p) => p.startsWith(part)) || e.emails.some((x) => x.startsWith(part)))).slice(0, 5);
      for (const e of hits) operators.push({ insert: `${key}:${e.isSelf ? "me" : e.type === "company" ? e.domain : e.name.split(" ")[0]!.toLowerCase()}`, label: `${key}: ${e.name}${e.isSelf ? " (you)" : ""}` });
    } else if (key === "in" || key === "source") {
      for (const p of [...new Set([...sources.values()].map((s) => s.def.platform))].filter((p) => p.startsWith(part) || platformName(p).toLowerCase().startsWith(part)).slice(0, 5))
        operators.push({ insert: `${key}:${p}`, label: `${key}: ${platformName(p)}`, logoUrl: logoUrl(p) });
    } else if (key === "type") {
      for (const t of ["mail", "event", "meeting", "person", "company", "doc", "issue", "message", "deal", "note"].filter((x) => x.startsWith(part))) operators.push({ insert: `type:${t}`, label: `type: ${t}` });
    } else if (key === "is") {
      for (const t of ["unread", "vip", "needs-you", "waiting", "mine", "open", "upcoming", "past"].filter((x) => x.startsWith(part))) operators.push({ insert: `is:${t}`, label: `is: ${t}` });
    } else if (key === "lane") {
      for (const t of ["vip", "needs-you", "waiting", "fyi", "low"].filter((x) => x.startsWith(part))) operators.push({ insert: `lane:${t}`, label: `lane: ${t}` });
    } else if (["after", "before", "on", "updated", "during"].includes(key)) {
      for (const t of ["today", "yesterday", "7d", "30d", "this-week", "last-week", "this-month"].filter((x) => x.startsWith(part))) operators.push({ insert: `${key}:${t}`, label: `${key}: ${t}` });
    }
  } else {
    const w = prefix.trim().split(/\s+/).pop()?.toLowerCase() ?? "";
    if (w.length >= 2) entities = ENTITIES.filter((e) => !e.isSelf && e.name.toLowerCase().split(" ").some((p) => p.startsWith(w))).slice(0, 3).map(entityChip);
  }
  return { operators: operators.slice(0, 5), entities, recent: recent.slice(0, 5).map((r) => r.query) };
}

export { ME };
