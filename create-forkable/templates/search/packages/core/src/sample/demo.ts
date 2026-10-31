// The keyless Acme demo (SPEC 18): every built-in profile on the sample world, through the
// same engine, embed, classify, match, search and chat code the server runs.

import { join } from "node:path";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Capability, SettingsData } from "../contract.js";
import type { EngineCtx } from "../ctx.js";
import type { Db } from "../db/client.js";
import { entities, entityKeys, entityMatches, items, profileVersions, sources, users, settings as settingsTable } from "../db/schema.js";
import { classifyPending, vipIdsForKeys } from "../classify/jev.js";
import { runChatTurn } from "../chat/run.js";
import { embedPending, LOCAL_LABEL, LOCAL_MODEL } from "../embed/index.js";
import { runEntityMatch } from "../entities/match.js";
import { runSource } from "../engine/run.js";
import { one, RECEIPT_ACTION } from "../one.js";
import { platformName } from "../platforms.js";
import { builtinProfiles, createSampleSources, loadBuiltinPacks, upsertBuiltins } from "../profile/builtins.js";
import { hybridSearch } from "../search/hybrid.js";
import { jevRerank } from "../search/rerank.js";
import { SAMPLE_SETTINGS } from "../settings.js";
import { fixtureTransport, loadSampleWorld, type SampleWorld } from "./world.js";
import type { Citation, QueryProposal, ResultRow } from "../api-types.js";

export const DEMO_USER = "usr_demo";

export interface DemoDeps {
  db: Db;
  capability: Capability;
  /** Repo root (holds profiles/ and fixtures/sample/). */
  root: string;
  database: { kind: "embedded" | "external"; version: string; port: number | null };
  now?: Date;
  log?: (line: string) => void;
  forkable?: boolean;
}

export interface DemoResult { ok: boolean; failures: string[]; items: number; chunks: number; vectors: number }

const KIND_LABEL: Record<string, string> = { email_thread: "Mail", meeting_note: "Meeting", message: "Message", deal: "Deal", person: "Person", company: "Company", event: "Event", doc: "Doc", task: "Issue", note: "Note", record: "Record" };
const ORDER = ["hubspot", "attio", "gmail", "outlook-mail", "google-calendar", "outlook-calendar", "notion", "linear", "slack", "teams", "granola"];

function pad(s: string, n: number): string { return s.length >= n ? s : s + " ".repeat(n - s.length); }
function lpad(s: string, n: number): string { return s.length >= n ? s : " ".repeat(n - s.length) + s; }
function clip(s: string, n: number): string { return s.length <= n ? s : s.slice(0, n - 3).trimEnd() + "..."; }

function ago(iso: string, now: Date): string {
  const d = new Date(iso);
  const diff = now.getTime() - d.getTime();
  const fut = diff < 0;
  const h = Math.abs(diff) / 3_600_000;
  if (!fut && h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
  if (!fut && h < 24) return `${Math.round(h)}h`;
  if (!fut && h < 24 * 7) return `${Math.round(h / 24)}d`;
  if (fut && h < 24 * 7) return d.toLocaleDateString("en-US", { weekday: "short", timeZone: "America/Los_Angeles" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" });
}

function rowLine(r: ResultRow, i: number, now: Date): string {
  const f = r.facets as Record<string, unknown>;
  const src = r.platform === "slack" && r.facets && typeof f.channel === "string" ? `Slack ${String(f.channel).startsWith("#") ? f.channel : `#${f.channel}`}` : r.sourceName;
  const who = r.people.find((p) => p.role === "from" || p.role === "author" || p.role === "organizer")?.name;
  let middle = r.title;
  if (r.kind === "deal") middle = [r.title, f.stage ?? null, typeof f.amount === "number" || typeof f.amount === "string" ? `$${Number(f.amount).toLocaleString("en-US")}` : null].filter(Boolean).join(" · ");
  else if (r.kind === "email_thread") middle = `${who ? `${who} · ` : ""}${r.title}${Number(f.messageCount) > 1 ? ` (${f.messageCount})` : ""}`;
  else if (r.kind === "message") middle = `${who ? `${who.split(" ")[0]}: ` : ""}${r.snippet ?? r.title}`;
  const when = r.kind === "deal" && typeof f.closeDate === "string" ? new Date(f.closeDate).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : ago(r.occurredAt, now);
  return `  ${lpad(String(i + 1), 2)} ${pad(KIND_LABEL[r.kind] ?? r.kind, 8)} ${pad(clip(src, 17), 17)} ${pad(clip(middle, 50), 50)} ${when}`;
}

export async function runDemo(deps: DemoDeps, out: (line: string) => void): Promise<DemoResult> {
  const { db } = deps;
  const failures: string[] = [];
  const fail = (section: string, why: string) => { failures.push(`${section}: ${why}`); out(`  ! ${section}: ${why}`); };
  const now = deps.now ?? new Date();
  const world: SampleWorld = loadSampleWorld(join(deps.root, "fixtures", "sample"), now);
  const transport = fixtureTransport(world);
  let settings: SettingsData = { ...SAMPLE_SETTINGS };
  const ctx: EngineCtx = {
    db, oneConnect: null, capability: deps.capability, transport,
    settingsFor: async () => settings, emit: () => {}, log: deps.log ?? (() => {}), now: () => new Date(),
  };
  const expect = (world.expectDemo ?? {}) as { items?: number; bySource?: Record<string, number>; sources?: Record<string, Record<string, number>>; queries?: Record<string, number | { results?: number; top?: string[] }>; queryDetails?: Record<string, { top?: string[] }>; matches?: Record<string, number>; lanes?: Record<string, number>; access?: string; ask?: { citations?: number } };
  const qWant = (q: string): number | undefined => { const v = expect.queries?.[q]; return typeof v === "number" ? v : v?.results; };
  const qTop = (q: string): string[] | undefined => { const v = expect.queries?.[q]; return (typeof v === "object" ? v?.top : undefined) ?? expect.queryDetails?.[q]?.top; };

  out("Search · keyless demo · Acme Inc sample");
  const pg = deps.database.kind === "embedded" ? `embedded Postgres ${deps.database.version} on ${deps.database.port}` : `external Postgres ${deps.database.version}`;
  out(`Database   ${pg} · ${deps.capability.mode === "hybrid" ? `hybrid (pgvector ${deps.capability.pgvector})` : `keyword-only (${deps.capability.reason ?? "no pgvector"})`}`);
  out(`Embedder   ${LOCAL_LABEL} · ${LOCAL_MODEL}${deps.capability.mode === "hybrid" ? "" : " · not used, semantic search is off"}`);
  out("");

  // profiles and the sample user
  const packs = loadBuiltinPacks(join(deps.root, "profiles"));
  await upsertBuiltins(db, packs);
  await db.insert(users).values({ id: DEMO_USER, name: "Dana Oyelaran", email: "dana@acme.com", isSample: true }).onConflictDoNothing();
  await db.insert(settingsTable).values({ userId: DEMO_USER, data: settings }).onConflictDoUpdate({ target: settingsTable.userId, set: { data: settings } });
  // the Acme world is these 11 sources; packs added later (profiles/<platform>/) keep their own
  // fixtures and expect.json and are checked by test:profiles, so they never change the demo numbers
  const srcIds = await createSampleSources(db, DEMO_USER, { platforms: ORDER, connections: world.connections });

  // run directories and CRM records first, so later refs resolve to them
  const rows = await db.select({ s: sources, v: profileVersions }).from(sources).innerJoin(profileVersions, eq(profileVersions.id, sources.profileVersionId)).where(eq(sources.userId, DEMO_USER));
  const rank = (r: (typeof rows)[number]) => (r.v.json.entities?.directory ? 0 : r.v.json.entities?.is ? 1 : 2) * 100 + Math.max(0, ORDER.indexOf(r.s.platform));
  rows.sort((a, b) => rank(a) - rank(b) || a.v.json.id.localeCompare(b.v.json.id));
  const platforms = [...new Set(ORDER.filter((p) => rows.some((r) => r.s.platform === p)).concat(rows.map((r) => r.s.platform)))];
  out(`Indexing ${platforms.length} sources`);
  for (const pass of [1, 2]) {
    for (const r of rows) {
      const sum = await runSource(ctx, r.s.id, { trigger: pass === 1 ? "first" : "schedule" });
      if (sum.outcome !== "ok") fail(`Indexing ${r.v.json.id}`, `${sum.outcome}${sum.error ? `: ${sum.error.message}` : ""}`);
    }
  }
  // VIPs (fixture entity keys) before lanes
  settings = { ...settings, vipEntityIds: await vipIdsForKeys(ctx, DEMO_USER, world.vipKeys) };
  const emb = await embedPending(ctx, DEMO_USER, 100_000);
  await runEntityMatch(ctx, DEMO_USER);
  await classifyPending(ctx, DEMO_USER, 10_000);

  if (expect.lanes) {
    // every lane: filter returns the fixture's count (SPEC 19, Phase 4)
    for (const [lane, want] of Object.entries(expect.lanes)) {
      const r = await hybridSearch(ctx, DEMO_USER, { q: `lane:${lane.replace(/_/g, "-")}`, limit: 1 });
      if (r.total !== want) fail("Lanes", `lane:${lane.replace(/_/g, "-")} expected ${want}, got ${r.total}`);
    }
  }
  if (expect.matches) {
    const mr = (await db.execute(sql`select status, count(*)::int as n from entity_matches where user_id = ${DEMO_USER} group by status`)).rows as { status: string; n: number }[];
    for (const [st2, n] of Object.entries(expect.matches)) { const got = mr.find((x) => x.status === st2)?.n ?? 0; if (got !== n) fail("Matches", `${st2}: expected ${n}, got ${got}`); }
  }
  const perSource = (await db.execute(sql`
    select s.platform, s.connection_label as label, pv.json->>'model' as model, pv.json->>'id' as pid, coalesce((pv.json->'entities'->>'directory')::boolean, false) as directory,
      (select count(*) from raw_items r where r.source_id = s.id)::int as fetched,
      (select count(*) from items i where i.source_id = s.id and i.deleted_at is null and i.directory = false)::int as items,
      (select count(*) from raw_items r where r.source_id = s.id and r.deleted_at is not null)::int as removed,
      (select count(distinct i.group_key) from items i where i.source_id = s.id and i.deleted_at is null and i.group_key is not null)::int as groups,
      (select count(*) from items i where i.source_id = s.id and i.deleted_at is null and coalesce((i.facets->>'replyCount')::int, 0) > 0)::int as threads
    from sources s join profile_versions pv on pv.id = s.profile_version_id where s.user_id = ${DEMO_USER}`)).rows as { platform: string; label: string; model: string; pid: string; directory: boolean; fetched: number; items: number; removed: number; groups: number; threads: number }[];
  let total = 0;
  for (const p of platforms) {
    const list = perSource.filter((x) => x.platform === p && !x.directory).sort((a, b) => ORDER.indexOf(a.platform) - ORDER.indexOf(b.platform) || a.pid.localeCompare(b.pid));
    const prof = packs.find((k) => k.platform === p);
    const order = prof ? prof.profiles.map((x) => x.id) : [];
    list.sort((a, b) => order.indexOf(a.pid) - order.indexOf(b.pid));
    const parts = list.map((x) => {
      let s = `${x.model.replace(/-/g, " ")} ${x.fetched}`;
      // two accounts on one platform: say whose
      if (list.filter((y) => y.pid === x.pid).length > 1) s = `${x.label} ${x.fetched}`;
      const notes: string[] = [];
      if (x.removed) notes.push(`${x.removed} removed`);
      if (x.groups && x.groups < x.items && x.platform !== "slack") notes.push(`${x.groups} conversations`);
      if (x.threads) notes.push(`${x.threads} threads`);
      if (notes.length) s += ` (${notes.join(", ")})`;
      return s;
    });
    const n = list.reduce((a, x) => a + x.items, 0);
    total += n;
    out(`  ${pad(platformName(p), 18)} ${pad(clip(parts.join(" · "), 52), 52)} ${lpad(String(n), 4)} items`);
    const exp = expect.bySource?.[p] ?? expect.sources?.[p]?.items;
    if (exp !== undefined && exp !== n) fail(platformName(p), `expected ${exp} items, got ${n}`);
  }
  const [{ chunks: nChunks, vectors: nVectors, errors: nErrors }] = (await db.execute(sql`
    select (select count(*) from chunks c join items i on i.id = c.item_id where i.user_id = ${DEMO_USER} and i.deleted_at is null)::int as chunks,
      ${deps.capability.mode === "hybrid" ? sql`(select count(*) from chunk_embeddings where user_id = ${DEMO_USER})::int` : sql`0`} as vectors,
      (select count(*) from item_errors e join sources s on s.id = e.source_id where s.user_id = ${DEMO_USER})::int as errors`)).rows as { chunks: number; vectors: number; errors: number }[];
  out(`  ${total} items · ${nChunks} chunks · ${deps.capability.mode === "hybrid" ? `${nVectors} vectors` : "no vectors (keyword-only)"} · ${nErrors + failures.length} errors`);
  if (expect.items !== undefined && expect.items !== total) fail("Indexing", `expected ${expect.items} items, got ${total}`);
  if (deps.capability.mode === "hybrid" && nVectors !== nChunks) fail("Embeddings", `${nVectors} vectors for ${nChunks} chunks (${emb.failed} failed)`);
  out("");

  // entities
  out("Entities");
  const entityLine = async (key: string) => {
    const r = (await db.execute(sql`select coalesce(e.merged_into_id, e.id) as id from entity_keys k join entities e on e.id = k.entity_id where k.user_id = ${DEMO_USER} and k.key = ${key} limit 1`)).rows as { id: string }[];
    return r[0]?.id ?? null;
  };
  const sourcesOf = async (id: string) => ((await db.execute(sql`select distinct i.platform from entity_links l join items i on i.id = l.item_id where l.entity_id = ${id} and i.deleted_at is null`)).rows as { platform: string }[]).map((r) => r.platform);
  const priya = await entityLine("email:priya@globex.com");
  if (priya) {
    const [e] = await db.select().from(entities).where(eq(entities.id, priya));
    const [co] = e?.companyId ? await db.select().from(entities).where(eq(entities.id, e.companyId)) : [];
    const srcs = await sourcesOf(priya);
    const viaEmail = ((await db.execute(sql`select distinct s.platform from entity_links l join sources s on s.id = l.source_id where l.entity_id = ${priya} and l.role = 'is'`)).rows as { platform: string }[]).map((r) => platformName(r.platform));
    const m = (await db.select().from(entityMatches).where(and(eq(entityMatches.userId, DEMO_USER), eq(entityMatches.aId, priya), eq(entityMatches.status, "merged"))))[0];
    let jev = "";
    if (m) {
      const [other] = await db.select().from(entities).where(eq(entities.id, m.bId));
      const os = other ? await db.execute(sql`select distinct s.platform from entity_keys k join sources s on s.id = k.source_id where k.entity_id = ${priya} and k.key like 'name:%' and k.key = ${"name:" + (other.name ?? "").toLowerCase()}`) : null;
      const oPlat = (os?.rows as { platform: string }[] | undefined)?.[0]?.platform;
      jev = `; "${other?.name ?? "?"}"${oPlat ? ` (${platformName(oPlat)})` : ""} by Jev ${(m.probability ?? 0).toFixed(2)}`;
    }
    out(`  ${pad(`${e?.name} (${co?.name ?? "Globex"})`, 21)} ${pad(`${srcs.length} sources`, 11)} merged: ${viaEmail.join(", ")} by email${jev}`);
    const want = (expect as { entities?: Record<string, { sources?: string[] }> }).entities?.["email:priya@globex.com"]?.sources;
    if (want) { const miss = want.filter((s) => !srcs.includes(s)); if (miss.length) fail("Entities", `Priya Shah is missing from ${miss.map(platformName).join(", ")}`); }
  } else fail("Entities", "no Priya Shah");
  const globex = await entityLine("domain:globex.com");
  if (globex) {
    const [g] = await db.select().from(entities).where(eq(entities.id, globex));
    out(`  ${pad(g?.name ?? "Globex", 21)} ${pad("globex.com", 11)} ${g?.itemCount ?? 0} items`);
  } else fail("Entities", "no Globex company");
  const [self] = await db.select().from(entities).where(and(eq(entities.userId, DEMO_USER), eq(entities.isSelf, true), isNull(entities.mergedIntoId)));
  if (self) {
    const emails = (await db.select({ k: entityKeys.key }).from(entityKeys).where(eq(entityKeys.entityId, self.id))).map((k) => k.k).filter((k) => k.startsWith("email:")).map((k) => k.slice(6)).sort();
    out(`  ${pad(`${self.name} (you)`, 21)} ${emails.join(", ")}`);
    if (!emails.includes("dana@acme.com") || !emails.includes("dana@acme.eu")) fail("Entities", "Dana is not one self across acme.com and acme.eu");
  } else fail("Entities", "no self entity");
  out("");

  // search
  const q1 = "globex renewal";
  const r1 = await hybridSearch(ctx, DEMO_USER, { q: q1, limit: 30 });
  // Jev rerank (sample: fixtures/sample/rerank.json), the same second request the UI makes
  const rr = await jevRerank(ctx, DEMO_USER, { queryId: r1.queryId });
  if (!rr.reranked) fail(`Search "${q1}"`, `rerank did not run (${rr.reason ?? "unknown"})`);
  const pos = new Map(rr.order.map((id, i) => [id, i]));
  const rrfTop = r1.results[0]?.id;
  r1.results.sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
  if (rr.reranked && r1.results[0]?.id === rrfTop) fail(`Search "${q1}"`, "rerank did not change the order");
  const want1 = qTop(q1)?.[0];
  if (want1 && !r1.results[0]?.title.includes(want1)) fail(`Search "${q1}"`, `expected "${want1}" first, got "${r1.results[0]?.title}"`);
  if (process.env.SEARCH_DEMO_DEBUG) {
    const refs = new Map(((await db.execute(sql`select id, platform || ':' || external_id as ref from items where user_id = ${DEMO_USER}`)).rows as { id: string; ref: string }[]).map((x) => [x.id, x.ref]));
    const rrf = new Map(rr.order.length ? (await hybridSearch(ctx, DEMO_USER, { q: q1, limit: 30 })).results.map((x, i) => [x.id, i + 1]) : []);
    for (const [i, r] of r1.results.entries()) out(`    ${i + 1} (rrf ${rrf.get(r.id) ?? "-"}) ${refs.get(r.id)} ${r.title}`);
  }
  out(`Search "${q1}"`);
  r1.results.slice(0, 5).forEach((r, i) => out(rowLine(r, i, now)));
  if (!r1.results.length) fail(`Search "${q1}"`, "no results");
  const top = qTop(q1);
  if (top && !r1.results.slice(0, 3).some((r) => top.slice(0, 3).some((t) => r.title.includes(t)))) fail(`Search "${q1}"`, "none of the expected results is in the top 3");
  out("");
  for (const q of ["from:priya after:30d type:mail", "lane:needs-you"]) {
    const r = await hybridSearch(ctx, DEMO_USER, { q, limit: 50 });
    out(`Search ${pad(`"${q}"`, 36)} ${r.total} results`);
    const want = qWant(q);
    if (want !== undefined && want !== r.total) fail(`Search "${q}"`, `expected ${want}, got ${r.total}`);
  }
  out("");

  // ask
  const question = "Where are we with Globex?";
  out(`Ask "${question}"`);
  let text = "", citations: Citation[] = [], proposal: QueryProposal | null = null, err: string | null = null;
  for await (const ev of runChatTurn(ctx, DEMO_USER, { message: question, context: { query: "globex" } })) {
    if (ev.type === "answer") { text = ev.text; citations = ev.citations; }
    if (ev.type === "proposal") proposal = ev.proposal;
    if (ev.type === "error") err = ev.error.message;
  }
  if (err) fail("Ask", err);
  for (const line of wrap(text, 78)) out(`  ${line}`);
  const cits = citations.map((c) => `[${c.n}] ${platformName(c.platform)} · ${c.title}`);
  for (let i = 0; i < cits.length; i += 2) out(`  ${pad(cits[i]!, 38)}${cits[i + 1] ? `  ${cits[i + 1]}` : ""}`.trimEnd());
  if (proposal) out(`  Refine: ${proposal.diff.map((d) => `${d.op} ${d.clause}`).join(" ")}   (${proposal.count} results)`);
  if ((expect.ask?.citations ?? 0) && citations.length !== expect.ask!.citations) fail("Ask", `expected ${expect.ask!.citations} citations, got ${citations.length}`);
  out("");

  // access receipt: the write Search was never granted
  const row = await one.attempt({ db, userId: DEMO_USER, actor: "user", mode: "fixture", oneConnect: null, transport }, {
    platform: RECEIPT_ACTION.platform, action: "delete", level: "write", actionId: RECEIPT_ACTION.actionId, method: RECEIPT_ACTION.method,
    path: RECEIPT_ACTION.path, pathParams: { userId: "me", id: "sample" }, summary: "Show that Search cannot delete mail",
  });
  out(`Access   Search reads only. ${row.sentence}`);
  if (!row.blockedByGrant) fail("Access", "the delete was not declined");
  if (!deps.forkable) out("Next: pnpm dev, then open http://localhost:5680");
  if (failures.length) { out(""); out(`${failures.length} check${failures.length === 1 ? "" : "s"} failed:`); for (const f of failures) out(`  ${f}`); }
  void srcIds; void builtinProfiles; void items;
  return { ok: failures.length === 0, failures, items: total, chunks: nChunks, vectors: nVectors };
}

function wrap(s: string, width: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const w of s.split(/\s+/)) {
    if (cur && cur.length + w.length + 1 > width) { out.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) out.push(cur);
  return out;
}
