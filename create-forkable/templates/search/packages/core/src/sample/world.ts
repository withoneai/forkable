// The Acme Inc sample world: fixtures/sample/** loaded once, relative dates resolved in
// America/Los_Angeles, and a FixtureTransport that answers one.call from it (CONTRACT 5, 12).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { FixtureAnswer, FixtureRequest, FixtureTransport, ProposalOutput } from "../contract.js";

export const SAMPLE_TZ = "America/Los_Angeles";

export interface PagesFile { file: string; actionId: string; pages: { match?: { cursor?: string | null; partition?: string; delta?: string | null; request?: Record<string, unknown>; connection?: string }; response: unknown }[] }
export interface DetailsFile { file: string; actionId: string; byId: Record<string, unknown> }

export interface SampleWorld {
  root: string;
  now: Date;
  pages: Map<string, PagesFile[]>;           // by actionId
  details: Map<string, DetailsFile[]>;       // by actionId
  account: Map<string, unknown>;             // actionId (or actionId#connection) -> response
  /** Extra sample connections the fixtures name (a second Gmail account): account.json with connection, platform, label. */
  connections: { key: string; platform: string; label: string }[];
  judgments: Record<string, SampleJudgment>;
  vipKeys: string[];
  matches: { a: string; b: string; same: number; reason?: string }[];
  rerank: Record<string, Record<string, number>>;        // query -> ref -> relevance 0..3
  chat: SampleAnswer[];
  proposals: Map<string, ProposalOutput>;    // "<platform>.<model>" or "<platform>"
  catalog: { platforms: unknown[]; actions: Map<string, unknown[]>; knowledge: Map<string, unknown> };
  expectDemo: Record<string, unknown> | null;
  files: string[];
}

export interface SampleJudgment { kind?: string; kindConfidence?: number; needs_you?: number; ball?: string; ball_p?: number; importance?: number }
export interface SampleAnswer { q: string; text: string; cite: string[]; quotes: (string | null)[]; searches: string[]; proposal?: { query: string; reason: string }; followups?: string[] }

/** Lowercase, punctuation stripped, spaces collapsed (the chat and rerank fixture key). */
export function normalizeQuestion(q: string): string {
  return q.toLowerCase().replace(/[^\p{L}\p{N}\s:@.-]/gu, " ").replace(/\s+/g, " ").trim().replace(/[.]+$/, "");
}

function num(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (v && typeof v === "object") { const o = v as Record<string, unknown>; const x = o.score ?? o.probability ?? o.value; return typeof x === "number" ? x : undefined; }
  return undefined;
}
function choice(v: unknown): { c?: string; p?: number } {
  if (typeof v === "string") return { c: v };
  if (v && typeof v === "object") { const o = v as Record<string, unknown>; return { c: typeof o.choice === "string" ? o.choice : undefined, p: typeof o.confidence === "number" ? o.confidence : undefined }; }
  return {};
}

// ---------- relative dates ----------

function tzOffsetMs(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

function zonedYmd(at: Date, tz: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: g("year"), m: g("month"), d: g("day") };
}

/** Wall-clock time in `tz` -> UTC Date. */
export function zonedToUtc(y: number, m: number, d: number, hh: number, mm: number, ss: number, tz: string): Date {
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm, ss));
  const off1 = tzOffsetMs(guess, tz);
  const t = new Date(guess.getTime() - off1);
  const off2 = tzOffsetMs(t, tz);
  return off2 === off1 ? t : new Date(guess.getTime() - off2);
}

/**
 * "-2d 14:00" (days from today at a wall time), "+3d", "-6h", "-90m", "-2w 09:30:05", "0d 08:00".
 * Days without a time keep the current wall time.
 */
export function resolveRel(spec: string, now: Date, tz = SAMPLE_TZ): Date {
  const s = spec.trim();
  const m = /^([+-]?\d+)([mhdw])(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (!m) throw new Error(`bad $rel "${spec}"`);
  const n = Number(m[1]);
  const unit = m[2]!;
  if (unit === "m" || unit === "h") return new Date(now.getTime() + n * (unit === "m" ? 60_000 : 3_600_000));
  const days = unit === "w" ? n * 7 : n;
  const { y, m: mo, d } = zonedYmd(now, tz);
  const base = new Date(Date.UTC(y, mo - 1, d + days));
  if (m[3] === undefined) return new Date(now.getTime() + days * 86_400_000);
  return zonedToUtc(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), Number(m[3]), Number(m[4]), Number(m[5] ?? 0), tz);
}

/** "Wed, 29 Oct 2026 14:00:00 -0700" in the zone (Gmail's Date header). */
export function rfc2822(d: Date, tz = SAMPLE_TZ): string {
  const off = Math.round(tzOffsetMs(d, tz) / 60_000);
  const local = new Date(d.getTime() + off * 60_000);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const p = (n: number) => String(n).padStart(2, "0");
  const sign = off < 0 ? "-" : "+";
  const a = Math.abs(off);
  return `${days[local.getUTCDay()]}, ${local.getUTCDate()} ${months[local.getUTCMonth()]} ${local.getUTCFullYear()} ${p(local.getUTCHours())}:${p(local.getUTCMinutes())}:${p(local.getUTCSeconds())} ${sign}${p(Math.floor(a / 60))}${p(a % 60)}`;
}

function ymdIn(d: Date, tz: string): string {
  const { y, m, d: dd } = zonedYmd(d, tz);
  return `${y}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function formatRel(d: Date, fmt: string, zone: string): string {
  switch (fmt) {
    case "ms": case "ms-string": return String(d.getTime());
    case "unix": return String(Math.floor(d.getTime() / 1000));
    case "slackts": return `${Math.floor(d.getTime() / 1000)}.000000`;
    case "date": return ymdIn(d, zone);
    case "rfc2822": return rfc2822(d, zone);
    default: return d.toISOString();
  }
}

/** Inline markers inside strings and map keys: "$rel(-6h|slackts)", "$relSlackTs(-1d 09:00)", "$rel(-2d 14:00)". */
export function resolveInline(s: string, now: Date, tz = SAMPLE_TZ): string {
  if (!s.includes("$rel")) return s;
  return s
    .replace(/\$relSlackTs\(([^)|]+)\)/g, (_m, spec: string) => formatRel(resolveRel(spec, now, tz), "slackts", tz))
    .replace(/\$rel\(([^)|]+)(?:\|([a-z-]+))?\)/g, (_m, spec: string, fmt?: string) => formatRel(resolveRel(spec, now, tz), fmt ?? "iso", tz));
}

/** Replaces { "$rel" }, { "$relMs" }, { "$relUnix" }, { "$relSlackTs" }, { "$relDate" } objects and inline "$rel(...)" markers anywhere in a JSON value. */
export function resolveDates(v: unknown, now: Date, tz = SAMPLE_TZ): unknown {
  if (typeof v === "string") return resolveInline(v, now, tz);
  if (Array.isArray(v)) return v.map((x) => resolveDates(x, now, tz));
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length >= 1 && keys[0]!.startsWith("$rel") && typeof o[keys[0]!] === "string" && keys.every((k) => k.startsWith("$rel") || k === "$tz")) {
      const zone = typeof o.$tz === "string" ? o.$tz : tz;
      const k = keys[0]!;
      const d = resolveRel(o[k] as string, now, zone);
      switch (k) {
        case "$rel": return d.toISOString();
        case "$relMs": return d.getTime();
        case "$relMsString": return String(d.getTime());
        case "$relUnix": return Math.floor(d.getTime() / 1000);
        case "$relSlackTs": return `${Math.floor(d.getTime() / 1000)}.000000`;
        case "$relDate": return ymdIn(d, zone);
        case "$relRfc2822": return rfc2822(d, zone);
        case "$relLocal": {
          // "2026-10-29T14:00:00" wall time in the zone, no offset (Graph dateTime with timeZone)
          const p = new Intl.DateTimeFormat("sv-SE", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(d);
          return `${p.replace(" ", "T")}.0000000`;
        }
        default: throw new Error(`unknown date marker ${k}`);
      }
    }
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(o)) out[resolveInline(k, now, tz)] = resolveDates(x, now, tz);
    return out;
  }
  return v;
}

// ---------- loading ----------

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir).sort()) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (n.endsWith(".json")) out.push(p);
  }
  return out;
}

function push<T>(m: Map<string, T[]>, k: string, v: T): void {
  const a = m.get(k);
  if (a) a.push(v); else m.set(k, [v]);
}

export function loadSampleWorld(root: string, now = new Date()): SampleWorld {
  const w: SampleWorld = {
    root, now, pages: new Map(), details: new Map(), account: new Map(), connections: [], judgments: {}, vipKeys: [], matches: [], rerank: {}, chat: [],
    proposals: new Map(), catalog: { platforms: [], actions: new Map(), knowledge: new Map() }, expectDemo: null, files: [],
  };
  if (!existsSync(root)) return w;
  for (const file of walk(root)) {
    const rel = relative(root, file).replace(/\\/g, "/");
    let json: unknown;
    try { json = JSON.parse(readFileSync(file, "utf8")); } catch (e) { throw new Error(`${rel}: ${(e as Error).message}`); }
    json = resolveDates(json, now);
    w.files.push(rel);
    const o = json as Record<string, unknown>;
    const base = rel.split("/").pop()!;
    if (rel.startsWith("catalog/")) {
      if (base === "platforms.json") w.catalog.platforms = (Array.isArray(o) ? o : (o.platforms as unknown[]) ?? []);
      else if (rel.startsWith("catalog/actions/")) w.catalog.actions.set(base.replace(/\.json$/, ""), Array.isArray(o) ? o : (o.actions as unknown[]) ?? (o.rows as unknown[]) ?? []);
      else if (rel.startsWith("catalog/knowledge/")) w.catalog.knowledge.set(String(o.actionId ?? o._id ?? base.replace(/\.json$/, "")), o);
      continue;
    }
    if (rel.startsWith("proposals/")) { w.proposals.set(base.replace(/\.json$/, ""), o as unknown as ProposalOutput); continue; }
    if (base.endsWith(".pages.json")) { push(w.pages, String(o.actionId), { file: rel, actionId: String(o.actionId), pages: (o.pages as PagesFile["pages"]) ?? [] }); continue; }
    if (base.endsWith(".details.json")) { push(w.details, String(o.actionId), { file: rel, actionId: String(o.actionId), byId: (o.byId as Record<string, unknown>) ?? {} }); continue; }
    if (base === "account.json") {
      if (typeof o.actionId === "string" && "response" in o && typeof o.connection === "string") {
        w.account.set(`${o.actionId}#${o.connection}`, o.response);
        if (typeof o.platform === "string") w.connections.push({ key: o.connection, platform: o.platform, label: String(o.label ?? o.connection) });
      } else if (typeof o.actionId === "string" && "response" in o) w.account.set(o.actionId, o.response);
      else for (const [k, v] of Object.entries(o)) if (!k.startsWith("$")) w.account.set(k, v);
      continue;
    }
    if (rel === "judgments.json") {
      w.vipKeys = Array.isArray(o.vips) ? (o.vips as string[]) : [];
      for (const [k, v] of Object.entries((o.items as Record<string, Record<string, unknown>>) ?? {})) {
        const kind = choice(v.kind), ball = choice(v.ball);
        w.judgments[k] = { kind: kind.c, kindConfidence: kind.p, needs_you: num(v.needs_you), ball: ball.c, ball_p: ball.p ?? num(v.ball_p), importance: num(v.importance) };
      }
      continue;
    }
    if (rel === "matches.json") {
      w.matches = ((o.pairs as Record<string, unknown>[]) ?? []).map((p) => ({ a: String(p.a), b: String(p.b), same: Number(p.same ?? p.probability ?? 0), reason: typeof p.reason === "string" ? p.reason : undefined }));
      continue;
    }
    if (rel === "rerank.json") {
      for (const [q, v] of Object.entries((o.queries as Record<string, unknown>) ?? {})) {
        const rel2: Record<string, number> = {};
        if (Array.isArray(v)) v.forEach((ref, i) => { rel2[String(ref)] = Math.max(0, 3 - i); });
        else if (v && typeof v === "object") Object.assign(rel2, ((v as { rel?: Record<string, number> }).rel ?? v) as Record<string, number>);
        w.rerank[normalizeQuestion(q)] = rel2;
      }
      continue;
    }
    if (rel === "chat.json") {
      const a = o.answers;
      const list: [string, Record<string, unknown>][] = Array.isArray(a) ? (a as Record<string, unknown>[]).map((x) => [String(x.q), x]) : Object.entries((a as Record<string, Record<string, unknown>>) ?? {});
      w.chat = list.map(([q, x]) => {
        const cits = Array.isArray(x.citations) ? (x.citations as { n?: number; ref?: string; quote?: string }[]).sort((p, r) => (p.n ?? 0) - (r.n ?? 0)) : null;
        return {
          q: normalizeQuestion(q), text: String(x.text ?? ""),
          cite: cits ? cits.map((c) => String(c.ref)) : ((x.cite as string[]) ?? []),
          quotes: cits ? cits.map((c) => c.quote ?? null) : [],
          searches: (x.searches as string[]) ?? [],
          proposal: x.proposal as SampleAnswer["proposal"], followups: x.followups as string[] | undefined,
        };
      });
      continue;
    }
    if (rel === "expect-demo.json") { w.expectDemo = o; continue; }
  }
  return w;
}

// ---------- transport ----------

function deepSubset(want: unknown, got: unknown): boolean {
  if (want === null || typeof want !== "object") return String(want) === String(got);
  if (!got || typeof got !== "object") return false;
  return Object.entries(want as Record<string, unknown>).every(([k, v]) => deepSubset(v, (got as Record<string, unknown>)[k]));
}

function scalars(v: unknown): string[] {
  if (!v || typeof v !== "object") return [];
  return Object.values(v as Record<string, unknown>).flatMap((x) => (typeof x === "string" || typeof x === "number" ? [String(x)] : Array.isArray(x) ? x.filter((y) => typeof y === "string").map(String) : []));
}

export function fixtureTransport(world: SampleWorld): FixtureTransport {
  return {
    async answer(req: FixtureRequest): Promise<FixtureAnswer> {
      if (req.fixtureKey) {
        const k = req.fixtureKey;
        const i = k.indexOf(":");
        const kind = k.slice(0, i), key = k.slice(i + 1);
        const hit = kind === "judgment" ? world.judgments[key]
          : kind === "match" ? (() => { const [a, b] = key.split("|"); return world.matches.find((m) => (m.a === a && m.b === b) || (m.a === b && m.b === a)); })()
          : kind === "rerank" ? world.rerank[normalizeQuestion(key)]
          : kind === "chat" ? world.chat.find((c) => c.q === normalizeQuestion(key))
          : kind === "proposal" ? world.proposals.get(key)
          : undefined;
        return hit ? { status: 200, data: structuredClone(hit) } : { status: 404, data: { error: "no fixture", fixtureKey: k } };
      }
      const files = world.pages.get(req.actionId);
      if (files) {
        // a connection with pages of its own (a second account) reads only those; every other one reads the shared pages
        const conn = req.connectionKey ?? null;
        const all = files.flatMap((f) => f.pages);
        const mine = all.filter((pg) => pg.match?.connection !== undefined && pg.match.connection === conn);
        const pool = mine.length ? mine : all.filter((pg) => pg.match?.connection === undefined);
        {
          for (const pg of pool) {
            const m = pg.match ?? {};
            const wantCursor = m.cursor ?? null;
            if ((req.cursor ?? null) !== wantCursor) continue;
            if (m.partition !== undefined && m.partition !== (req.partition ?? undefined)) continue;
            if (m.delta !== undefined && (m.delta ?? null) !== (req.delta ?? null)) continue;
            if (m.request && !deepSubset(m.request, { pathParams: req.pathParams, query: req.query, body: req.body })) continue;
            const st = (pg as { status?: number }).status;
            return { status: typeof st === "number" ? st : 200, data: structuredClone(pg.response) };
          }
        }
      }
      const det = world.details.get(req.actionId);
      if (det) {
        const keys = [...scalars(req.pathParams), ...scalars(req.query), ...scalars(req.body)];
        for (const f of det) for (const k of keys) if (k in f.byId) return { status: 200, data: structuredClone(f.byId[k]) };
        return { status: 404, data: { error: "not found", request: { actionId: req.actionId, keys } } };
      }
      if (req.connectionKey && world.account.has(`${req.actionId}#${req.connectionKey}`)) return { status: 200, data: structuredClone(world.account.get(`${req.actionId}#${req.connectionKey}`)) };
      if (world.account.has(req.actionId)) return { status: 200, data: structuredClone(world.account.get(req.actionId)) };
      if (files) return { status: 200, data: emptyLike(files[0]!.pages[0]?.response) };
      return { status: 404, data: { error: "no fixture", request: { actionId: req.actionId, cursor: req.cursor ?? null, partition: req.partition ?? null } } };
    },
  };
}

/** A later page nobody wrote (a cursor the fixture does not list): answer the same shape, empty. */
function emptyLike(resp: unknown): unknown {
  if (Array.isArray(resp)) return [];
  if (!resp || typeof resp !== "object") return resp;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(resp as Record<string, unknown>)) {
    if (Array.isArray(v)) out[k] = [];
    else if (v && typeof v === "object") out[k] = emptyLike(v);
    else if (typeof v === "boolean") out[k] = k.toLowerCase().includes("more") || k.toLowerCase().includes("next") ? false : v;
    else if (/next|cursor|token|after|link/i.test(k)) continue;
    else out[k] = v;
  }
  return out;
}

/** "<platform>:<externalId>" key used by judgments, rerank and chat fixtures. */
export function sampleKey(platform: string, externalId: string): string {
  return `${platform}:${externalId}`;
}
