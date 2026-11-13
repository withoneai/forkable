// API smoke (SPEC 19, Phase 2): every CONTRACT 6.2 route on the Acme sample, in
// process, on a tmp SEARCH_HOME, its own embedded Postgres port and server port
// (never ~/.search, never 52289). No Connect app, no network.
//
//   pnpm --filter @search/server smoke
//   SMOKE_PORT=52377 SMOKE_PG_PORT=55451 ... to move it

// Must stay the first import: fails the run if it touches the repo's Connect ask or .env.
import "@search/core/test-guard";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dbSchema } from "@search/core";
import { eq } from "drizzle-orm";
import { startServer } from "../src/node.js";
import { assertNotRepoFileUnderTest, ROOT } from "../src/config.js";

const PORT = Number(process.env.SMOKE_PORT ?? 52377);
const home = mkdtempSync(join(tmpdir(), "search-smoke-api-"));
let failures = 0, passed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) passed++; else failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail !== undefined ? `  (${typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 300)})` : ""}`);
};

const server = await startServer({ env: { HOME: home, PORT, PG_PORT: Number(process.env.SMOKE_PG_PORT ?? 55451), SECRETS: "file", ENV_DIR: home, UI_URL: undefined, ONE_CLIENT_ID: undefined }, serveUi: false, log: () => {} });
const base = `http://127.0.0.1:${PORT}`;
{
  let refused = false;
  try { assertNotRepoFileUnderTest(join(ROOT, ".env")); } catch { refused = true; }
  check("under test, the repo's .env is refused", refused);
}
let cookie = "";
async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: any; text: string; headers: Headers }> {
  const res = await fetch(`${base}${path.startsWith("/api") || path.startsWith("/.") ? path : `/api/v1${path}`}`, {
    method, redirect: "manual",
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), host: `localhost:${PORT}`, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.getSetCookie().find((c) => c.startsWith("search_sid="));
  if (set) cookie = set.split(";")[0]!;
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* sse or empty */ }
  return { status: res.status, json, text, headers: res.headers };
}

try {
  // health, identity, the sample sign-in
  let r = await call("GET", "/api/health");
  check("GET /api/health", r.status === 200 && r.json.ok && r.json.capability.mode === "hybrid", r.json);
  r = await call("GET", "/me");
  check("GET /me signed out", r.status === 200 && r.json.signedIn === false && r.json.connect.configured === false && r.json.connect.signInUrl === null, r.json);
  r = await call("GET", "/search?q=globex");
  check("GET /search signed out is 401 not_signed_in", r.status === 401 && r.json.error.code === "not_signed_in", r.json);
  r = await call("GET", "/api/one/authorize");
  check("GET /api/one/authorize without a Connect app is 404", r.status === 404, r.json);
  r = await call("GET", "/api/one/callback?code=x&state=y");
  check("GET /api/one/callback without a Connect app redirects with an error", r.status === 302 && /one_connect=error/.test(r.headers.get("location") ?? ""), r.headers.get("location"));
  const t0 = Date.now();
  r = await call("POST", "/sources/sample");
  check(`POST /sources/sample indexes the Acme world (${Date.now() - t0} ms)`, r.status === 200 && r.json.sources.length >= 18 && r.json.sources.every((s: any) => s.mode === "fixture" && s.health.status === "healthy"), r.json?.sources?.map((s: any) => s.health.status));
  r = await call("POST", "/sources/sample");
  check("POST /sources/sample is idempotent", r.status === 200 && r.json.sources.length >= 18);
  r = await call("GET", "/me");
  check("GET /me is Dana, sample", r.json.signedIn && r.json.user.isSample && r.json.user.name === "Dana Oyelaran" && r.json.settings.embedding.provider === "local", r.json.user);

  // search
  r = await call("GET", "/search?q=priya%40globex.com");
  check("GET /search an email puts the person first (exact lane)", r.status === 200 && r.json.results[0]?.kind === "person" && r.json.results[0]?.exact === "email", r.json.results?.[0]);
  r = await call("GET", "/search?q=renewal%20pricing%20hooli%20zebra");
  check("GET /search falls back to any word", r.status === 200 && r.json.fallback === "or" && r.json.total > 0, { fallback: r.json.fallback, total: r.json.total });
  r = await call("GET", "/search?q=Owen%20Prise");
  check("GET /search offers did you mean", r.status === 200 && r.json.didYouMean?.name === "Owen Price", r.json.didYouMean);
  r = await call("GET", "/search?q=pricing%20last%20month&understand=0");
  check("GET /search understand=0 proposes dates", r.status === 200 && r.json.understanding === false && r.json.dateProposals?.length === 1 && /^after:\d{4}-\d{2}-01 before:/.test(r.json.dateProposals[0].insert), r.json.dateProposals);

  // plain sentences (D48)
  const enc = encodeURIComponent;
  r = await call("GET", `/search?q=${enc("emails from Priya last month")}`);
  {
    const f = (r.json.understood ?? []).map((u: any) => u.filter);
    check("GET /search reads a sentence into filters", r.status === 200 && r.json.understanding === true && f[0] === "type:mail" && f[1] === "from:priya@globex.com" && /^after:\d{4}-\d{2}-01 before:/.test(f[2] ?? ""), r.json.understood);
    check("GET /search understood: phrase, filter, label, place", (r.json.understood ?? []).every((u: any) => typeof u.label === "string" && u.label && "emails from Priya last month".slice(u.start, u.end) === u.phrase), r.json.understood);
    check("GET /search searchedAs is the query run, parsed matches it", r.json.searchedAs?.startsWith("type:mail from:priya@globex.com after:") && r.json.parsed.text === "" && r.json.parsed.clauses.length === 4, { searchedAs: r.json.searchedAs, parsed: r.json.parsed?.text });
    check("GET /search the sentence finds only Priya's mail", r.json.results.every((x: any) => x.kind === "email_thread") && r.json.dateProposals.length === 0, r.json.results?.map((x: any) => x.kind));
  }
  r = await call("GET", `/search?q=${enc("emails from Priya")}`);
  const priyaMail = r.json.total;
  check("GET /search emails from Priya", r.status === 200 && priyaMail > 0 && r.json.results.every((x: any) => x.kind === "email_thread" && x.people.some((p: any) => /Priya/.test(p.name))), { total: priyaMail });
  r = await call("GET", `/search?q=${enc("emails from Priya")}&understand=0`);
  check("GET /search understand=0 keeps the words", r.status === 200 && r.json.understanding === false && r.json.understood.length === 0 && r.json.suggestions.length === 0 && r.json.searchedAs === "emails from Priya", { understood: r.json.understood, searchedAs: r.json.searchedAs });
  r = await call("GET", `/search?q=${enc('"emails" "from Priya"')}`);
  check("GET /search quoted words are never read", r.status === 200 && r.json.understood.length === 0, r.json.understood);
  r = await call("GET", `/search?q=${enc("from:lena emails from Priya")}`);
  check("GET /search a typed filter wins over a phrase", r.status === 200 && r.json.understood.map((u: any) => u.filter).join(" ") === "type:mail" && r.json.searchedAs.includes("from:lena"), r.json.understood);
  r = await call("GET", `/search?q=${enc("from Mia")}`);
  check("GET /search two Mia Parks: a choice, not a pick", r.status === 200 && r.json.understood.length === 0 && r.json.suggestions[0]?.why === "same_name" && r.json.suggestions[0].choices.length >= 2 && new Set(r.json.suggestions[0].choices.map((c: any) => c.filter)).size === r.json.suggestions[0].choices.length, r.json.suggestions);
  r = await call("GET", `/search?q=${enc("open deals")}`);
  check("GET /search open deals", r.status === 200 && r.json.understood.map((u: any) => u.filter).join(" ") === "is:open type:deal" && r.json.total > 0 && r.json.results.every((x: any) => x.kind === "deal"), { u: r.json.understood, total: r.json.total });
  r = await call("GET", `/search?q=${enc("slack messages about Globex")}`);
  // Slack holds only messages here, so "messages" is not a second chip (final review 2026-11-12)
  check("GET /search slack messages", r.status === 200 && r.json.understood.map((u: any) => u.filter).join(" ") === "in:slack" && r.json.results.every((x: any) => x.platform === "slack"), r.json.understood);
  for (const q of ["from scratch", "in progress", "with regards", "renewal deal"]) {
    r = await call("GET", `/search?q=${enc(q)}`);
    check(`GET /search "${q}" reads nothing`, r.status === 200 && r.json.understood.length === 0 && r.json.suggestions.length === 0 && r.json.searchedAs === q, r.json.understood);
  }
  r = await call("GET", `/search?q=${enc("where are we with Globex")}`);
  check("GET /search small words left over list the filter alone", r.status === 200 && r.json.understood[0]?.filter === "with:globex.com" && r.json.total > 3, { u: r.json.understood, total: r.json.total });
  r = await call("GET", `/search?q=yesterday&tz=Asia%2FQatar`);
  check("GET /search tz: dates in the browser's zone", r.status === 200 && r.json.understood[0]?.filter === "on:yesterday" && /^Yesterday, /.test(r.json.understood[0]?.label), r.json.understood);
  r = await call("GET", `/search/count?q=${enc("emails from Priya")}`);
  const c1 = r.json.count;
  r = await call("GET", `/search/count?q=${enc("emails from Priya")}&understand=0`);
  check("GET /search/count reads sentences too, understand=0 does not", c1 === priyaMail && r.json.count !== c1, { understood: c1, words: r.json.count });
  // when in doubt, no filter (D48)
  r = await call("GET", `/search?q=${enc("emails that are not from Priya")}`);
  check("GET /search \"not from Priya\" never applies from:Priya, offers the exclusion", r.status === 200 && !r.json.understood.some((u: any) => /^from:/.test(u.filter)) && r.json.suggestions.some((s: any) => s.why === "negated" && s.choices[0]?.filter === "-from:priya@globex.com"), { u: r.json.understood, s: r.json.suggestions });
  r = await call("GET", `/search?q=${enc("what happened last week")}`);
  check("GET /search a question with a date lists that week", r.status === 200 && r.json.understood.length === 1 && r.json.total > 0 && r.json.searchedAs === r.json.understood[0].filter, { total: r.json.total, searchedAs: r.json.searchedAs });
  r = await call("GET", `/search?q=${enc("anything from last week")}`);
  check("GET /search \"anything from last week\" finds that week", r.status === 200 && r.json.total > 0, r.json.total);
  r = await call("GET", `/search?q=${enc("contract review with Globex")}`);
  check("GET /search \"contract review with Globex\" keeps what the words found", r.status === 200 && r.json.total >= 5 && ["Globex contract review", "Globex x Acme contract review"].every((t) => r.json.results.some((x: any) => x.title === t)), r.json.results?.map((x: any) => x.title));
  r = await call("GET", `/search?q=${enc("procurement questionnaire from Hannah")}`);
  // from means from: a note that only names her is not from her; with reaches it (final review 2026-11-12)
  check("GET /search \"procurement questionnaire from Hannah\" lists only what she sent", r.status === 200 && !r.json.results.some((x: any) => /^Hannah sent/.test(x.title)) && r.json.results.some((x: any) => /Procurement questionnaire/i.test(x.title)), r.json.results?.map((x: any) => x.title));
  r = await call("GET", `/search?q=${enc("procurement questionnaire with Hannah")}`);
  check("GET /search \"procurement questionnaire with Hannah\" keeps the note that names her", r.status === 200 && r.json.results.some((x: any) => /^Hannah sent/.test(x.title)), r.json.results?.map((x: any) => x.title));
  r = await call("GET", `/search?q=${enc("emails with price changes")}`);
  check("GET /search a last name inside a phrase is never applied", r.status === 200 && !r.json.understood.some((u: any) => u.kind === "person") && r.json.suggestions.length === 0, { u: r.json.understood, s: r.json.suggestions });
  r = await call("GET", `/search?q=${enc("notes on linear algebra")}`);
  check("GET /search a tool name in an everyday phrase is offered", r.status === 200 && !r.json.understood.some((u: any) => u.kind === "source") && r.json.suggestions[0]?.why === "maybe_tool", { u: r.json.understood, s: r.json.suggestions });
  r = await call("GET", `/search?q=${enc("emails from Priya and Marco")}`);
  check("GET /search a list of senders is one filter", r.status === 200 && r.json.understood.some((u: any) => u.filter === "from:priya@globex.com,marco@globex.com") && r.json.total > 0, r.json.understood);
  {
    // a bearer caller (a script, an agent, the CLI) gets its text as written unless it asks
    const db = server.deps.db;
    const me = (await call("GET", "/me")).json;
    const { createHash } = await import("node:crypto");
    const tok = "sat_smoke_understand_0001";
    await db.insert(dbSchema.oauthTokens).values({ tokenHash: createHash("sha256").update(tok).digest("hex"), kind: "access", clientId: "client_smoke", userId: me.user.id, familyId: "fam_smoke", scopes: ["search:read", "search:ask"], resource: null, expiresAt: new Date(Date.now() + 3_600_000) });
    const bearer = (path: string) => call("GET", path, undefined, { authorization: `Bearer ${tok}`, cookie: "" });
    r = await bearer(`/search?q=${enc("emails from Priya")}`);
    check("GET /search with a bearer token searches the words as sent", r.status === 200 && r.json.understanding === false && r.json.understood.length === 0 && r.json.searchedAs === "emails from Priya", { understanding: r.json.understanding, searchedAs: r.json.searchedAs });
    r = await bearer(`/search?q=${enc("emails from Priya")}&understand=1`);
    check("GET /search with a bearer token and understand=1 reads the sentence", r.status === 200 && r.json.understanding === true && r.json.total === priyaMail, { understanding: r.json.understanding, total: r.json.total });
    r = await bearer(`/search/count?q=${enc("emails from Priya")}`);
    const words = r.json.count;
    r = await bearer(`/search/count?q=${enc("emails from Priya")}&understand=1`);
    check("GET /search/count with a bearer token follows understand=1 too", r.json.count === priyaMail && words !== priyaMail, { words, read: r.json.count });
  }
  r = await call("GET", "/recent-searches?limit=50");
  check("GET /recent-searches keeps the sentence as typed", r.status === 200 && r.json.some((x: any) => x.query === "emails from Priya"), r.json?.slice(0, 3));
  r = await call("GET", "/search?q=globex%20renewal&limit=30");
  const queryId = r.json?.queryId;
  check("GET /search globex renewal", r.status === 200 && r.json.total > 3 && r.json.mode === "hybrid" && r.json.results[0].sourceName, r.json?.total);
  const firstItem = r.json.results[0].id as string;
  r = await call("GET", "/search?q=from:priya%20after:30d%20type:mail");
  check("GET /search operators (3 mails from Priya)", r.json.total === 3, r.json.total);
  r = await call("GET", "/search?q=globex&scope=deal&sort=newest");
  check("GET /search scope and sort", r.status === 200 && r.json.results.every((x: any) => x.kind === "deal") && r.json.counts.scope.all >= r.json.total, r.json.counts);
  r = await call("POST", "/search/rerank", { queryId });
  check("POST /search/rerank answers from rerank.json", r.status === 200 && r.json.queryId === queryId && (r.json.reranked === true || r.json.reason === "sample_no_fixture"), r.json);
  const asked1 = r.json.asked;
  r = await call("GET", "/search?q=globex%20renewal&limit=30");
  r = await call("POST", "/search/rerank", { queryId: r.json.queryId });
  check("POST /search/rerank a repeat search reuses every stored score (no Jev call)", r.status === 200 && r.json.reranked === true && r.json.asked === 0 && r.json.stored > 0 && asked1 > 0, { asked1, ...r.json, order: undefined });
  r = await call("POST", "/search/rerank", { queryId: r.json.queryId, fresh: true });
  check("POST /search/rerank fresh asks Jev again", r.status === 200 && r.json.asked > 0, { ...r.json, order: undefined });
  r = await call("GET", "/search?q=globex%20renewal&limit=30&fresh=1");
  check("GET /search fresh=1", r.status === 200 && r.json.total > 3);
  r = await call("POST", "/search/rerank", {});
  check("POST /search/rerank without queryId is 400", r.status === 400);
  r = await call("GET", "/search/count?q=type:deal");
  // 7 deal records, 2 of them one deal kept in two CRMs: 5 rows
  check("GET /search/count", r.status === 200 && r.json.count === 5, r.json);
  r = await call("GET", "/suggest?prefix=from:pri");
  check("GET /suggest from:pri", r.status === 200 && r.json.operators.some((o: any) => /priya/i.test(o.label)), r.json);
  r = await call("GET", "/suggest?prefix=globex");
  check("GET /suggest recent", r.json.recent.includes("globex"), r.json.recent);

  // items
  r = await call("GET", `/items/${firstItem}`);
  check("GET /items/:id", r.status === 200 && r.json.row.id === firstItem && Array.isArray(r.json.properties) && r.json.classification && r.json.rawAvailable, r.json?.row?.title);
  r = await call("GET", "/search?q=re:%20globex%20renewal%20terms%20type:mail");
  const mail = r.json.results.find((x: any) => x.kind === "email_thread");
  if (mail) { r = await call("GET", `/items/${mail.id}`); check("GET /items/:id mail thread has message parts", r.json.parts.length >= 2, r.json.parts.length); }
  r = await call("GET", `/items/${firstItem}/raw`);
  check("GET /items/:id/raw", r.status === 200 && r.json.item !== undefined);
  r = await call("GET", "/items/itm_nope");
  check("GET /items/:id unknown is 404", r.status === 404 && r.json.error.code === "not_found");
  r = await call("GET", "/recent-items");
  check("GET /recent-items lists opened items", r.status === 200 && r.json[0]?.id && r.json.some((x: any) => x.id === firstItem), r.json?.length);

  // entities
  r = await call("GET", "/entities?q=priya&type=person");
  const priya = r.json?.[0];
  check("GET /entities?q=priya", r.status === 200 && priya?.name === "Priya Shah" && priya.isSelf === false && priya.email === "priya@globex.com", r.json);
  r = await call("GET", "/entities?limit=200");
  check("GET /entities limit up to 200, self first", r.status === 200 && r.json.length > 10 && r.json[0].isSelf === true, r.json?.[0]);
  r = await call("GET", `/entities/${priya.id}`);
  check("GET /entities/:id Priya across sources", r.status === 200 && r.json.entity.sources.length >= 6 && r.json.timeline.length > 5, r.json?.entity?.sources);
  // item 10 (polish): a card and the page it opens show the same number
  for (const q of ["priya", "globex", "who is Ravi", "owen"]) {
    const cards = (await call("GET", `/search?q=${encodeURIComponent(q)}`)).json.entities ?? [];
    for (const card of cards) {
      const page = (await call("GET", `/entities/${card.id}`)).json;
      const total = page.entity.sources.reduce((n: number, x: any) => n + x.count, 0);
      check(`card and page agree: ${card.name} (${q})`, card.itemCount === page.entity.itemCount && total === page.entity.itemCount, { card: card.itemCount, page: page.entity.itemCount, tools: total });
      // the timeline leaves out its own record and shows each person or company once
      const own = page.timeline.filter((r: any) => (r.people ?? []).some((p: any) => p.entityId === card.id && p.role === "is"));
      const ids = page.timeline.map((r: any) => r.id);
      check(`timeline without its own record, no repeats: ${card.name} (${q})`, own.length === 0 && new Set(ids).size === ids.length && page.timeline.length <= page.entity.itemCount, { own: own.map((r: any) => r.title) });
    }
  }
  const pend = (await call("GET", "/entities?limit=200")).json as any[];
  let matchId: string | null = null, matchEntity: string | null = null;
  for (const e of pend) { const d = (await call("GET", `/entities/${e.id}`)).json; if (d.pendingMatches?.length) { matchId = d.pendingMatches[0].matchId; matchEntity = e.id; break; } }
  if (matchId) {
    r = await call("POST", `/entity-matches/${matchId}`, { decision: "reject" });
    check("POST /entity-matches/:id reject", r.status === 204);
  } else check("a pending match exists to decide", false, "none");
  const two = pend.filter((e: any) => e.type === "person" && !e.isSelf).slice(-2);
  r = await call("POST", `/entities/${two[0].id}/merge`, { otherId: two[1].id });
  check("POST /entities/:id/merge", r.status === 200 && r.json.entity.id === two[0].id, r.json);
  r = await call("POST", `/entities/${two[1].id}/unmerge`);
  check("POST /entities/:id/unmerge", r.status === 200, r.json);
  void matchEntity;

  // chat and answer
  r = await call("POST", "/chat", { message: "Where are we with Globex?", context: { query: "globex", queryId } });
  const events = r.text.split("\n\n").filter((b) => b.includes("data:")).map((b) => JSON.parse(b.split("\n").find((l) => l.startsWith("data:"))!.slice(5)));
  const answer = events.find((e) => e.type === "answer");
  const chatId = events.find((e) => e.type === "chat")?.chatId;
  check("POST /chat streams chat, steps, answer with 3 citations, proposal, done", r.headers.get("content-type")?.includes("text/event-stream") && events[0].type === "chat" && events.at(-1).type === "done" && events.at(-1).messageId && answer?.citations.length === 3 && answer.citations.every((x: any) => x.kind) && answer.model === "fixture" && events.some((e) => e.type === "proposal"), events.map((e) => e.type));
  r = await call("POST", "/chat", { message: "" });
  check("POST /chat empty is 400", r.status === 400);
  r = await call("GET", "/chats");
  check("GET /chats", r.status === 200 && r.json.some((x: any) => x.id === chatId));
  r = await call("GET", `/chats/${chatId}`);
  check("GET /chats/:id has both messages", r.status === 200 && r.json.messages.length === 2 && r.json.messages[1].citations.length === 3, r.json?.messages?.length);
  r = await call("POST", "/answer", { q: "who is priya shah?" });
  check("POST /answer", r.status === 200 && r.json.text && Array.isArray(r.json.citations), r.json);
  r = await call("DELETE", `/chats/${chatId}`);
  check("DELETE /chats/:id", r.status === 204 && (await call("GET", `/chats/${chatId}`)).status === 404);

  // sources and runs
  r = await call("GET", "/sources");
  const gmail = r.json.sources.find((s: any) => s.platform === "gmail");
  check("GET /sources", r.status === 200 && gmail && Array.isArray(r.json.notInApp) && Array.isArray(r.json.available));
  check("GET /sources says the sample embedder is not semantic, with no banner for it", r.json.semantic?.semantic === false && r.json.semantic.reason === "sample" && (r.json.banner === null || r.json.banner.sourceId !== null), r.json.semantic);
  r = await call("GET", `/sources/${gmail.id}`);
  check("GET /sources/:id", r.status === 200 && r.json.profile.slug === "gmail.threads" && r.json.settingsSpec && r.json.scheduleEvery === "5m", r.json?.profile);
  r = await call("PATCH", `/sources/${gmail.id}`, { scheduleEvery: "15m", settings: { backfill: "30d" }, paused: true });
  check("PATCH /sources/:id", r.status === 200 && r.json.scheduleEvery === "15m" && r.json.settings.backfill === "30d" && r.json.health.status === "paused", r.json?.health);
  check("PATCH a setting the fetch reads marks the source for a refetch", r.json.refetchPending === true, r.json?.refetchPending);
  r = await call("PATCH", `/sources/${gmail.id}`, { paused: false });
  check("PATCH /sources/:id resume", r.json.health.status !== "paused");
  r = await call("PATCH", `/sources/${gmail.id}`, { scheduleEvery: "nope" });
  check("PATCH /sources/:id bad schedule is 400", r.status === 400);
  r = await call("POST", `/sources/${gmail.id}/sync`, { full: true });
  check("POST /sources/:id/sync", r.status === 200 && /^run_/.test(r.json.runId), r.json);
  await server.deps.scheduler.idle();
  r = await call("GET", `/sources/${gmail.id}/runs?limit=5`);
  check("GET /sources/:id/runs", r.status === 200 && r.json.length >= 2 && r.json[0].trigger === "manual" && r.json[0].outcome === "ok", r.json?.[0]);
  r = await call("GET", `/sources/${gmail.id}/errors`);
  check("GET /sources/:id/errors", r.status === 200 && Array.isArray(r.json));
  r = await call("POST", `/sources/${gmail.id}/errors/retry`, {});
  check("POST /sources/:id/errors/retry", r.status === 200 && typeof r.json.queued === "number");
  r = await call("POST", `/sources/${gmail.id}/update-profile`, {});
  check("POST /sources/:id/update-profile", r.status === 200 && r.json.profile.updateAvailable === false, r.json?.profile);
  await server.deps.scheduler.idle();

  // profiles
  r = await call("GET", "/profiles");
  const gmailProfile = r.json.find((p: any) => p.slug === "gmail.threads");
  check("GET /profiles has json on every row", r.status === 200 && r.json.length >= 20 && r.json.every((p: any) => p.json && p.json.id === p.slug));
  r = await call("GET", `/profiles/${gmailProfile.id}`);
  check("GET /profiles/:id", r.status === 200 && r.json.json.platform === "gmail");
  r = await call("GET", `/profiles/${gmailProfile.id}/versions`);
  check("GET /profiles/:id/versions", r.status === 200 && r.json[0].version === 1);
  r = await call("GET", `/profiles/${gmailProfile.id}/export`);
  const pack = r.json;
  check("GET /profiles/:id/export", r.status === 200 && /attachment/.test(r.headers.get("content-disposition") ?? "") && pack.profiles[0].author === "builtin");
  r = await call("POST", "/profiles/validate", { json: pack.profiles[0] });
  check("POST /profiles/validate", r.status === 200 && r.json.ok, r.json);
  r = await call("POST", "/profiles/validate", { json: { id: "x" } });
  check("POST /profiles/validate a bad profile", r.status === 200 && !r.json.ok);
  r = await call("POST", `/profiles/${gmailProfile.id}/fork`);
  const fork = r.json;
  check("POST /profiles/:id/fork", r.status === 200 && fork.origin === "user" && fork.id !== gmailProfile.id, r.json);
  const edited = { ...fork.json, title: "My Gmail", fields: { ...fork.json.fields, snippet: "item.snippet" } };
  r = await call("PUT", `/profiles/${fork.id}`, { json: edited, note: "smoke" });
  check("PUT /profiles/:id remaps", r.status === 200 && r.json.report.ok && ["remap", "none"].includes(r.json.effect) && r.json.profile.currentVersion >= 1, r.json?.effect);
  r = await call("PUT", `/profiles/${fork.id}`, { json: { ...edited, list: undefined } });
  check("PUT /profiles/:id invalid is 400 invalid_profile", r.status === 400 && r.json.error.code === "invalid_profile");
  r = await call("POST", "/profiles/import", { pack: { ...pack, profiles: [{ ...pack.profiles[0], title: "Imported Gmail" }] } });
  check("POST /profiles/import { pack }", r.status === 200 && r.json.importId && r.json.diff[0].status !== "new", r.json?.diff);
  r = await call("POST", `/profiles/import/${r.json.importId}/accept`);
  check("POST /profiles/import/:id/accept installs it as mine", r.status === 200 && r.json[0].title === "Imported Gmail" && r.json[0].origin !== "builtin", r.json);
  r = await call("POST", "/profiles/import", { url: "http://example.com/pack.json" });
  check("POST /profiles/import { url } refuses http", r.status === 400, r.json);
  r = await call("POST", "/profiles/import", { url: "https://127.0.0.1/pack.json" });
  check("POST /profiles/import { url } refuses private addresses", r.status === 400, r.json);
  r = await call("POST", "/profiles/import", { pack: { nope: 1 } });
  check("POST /profiles/import a bad pack is 400 invalid_profile", r.status === 400 && r.json.error.code === "invalid_profile");

  // catalog, connections, the New profile flow on Zendesk
  r = await call("GET", "/catalog/platforms?q=zen");
  check("GET /catalog/platforms", r.status === 200 && r.json.platforms.some((p: any) => p.platform === "zendesk" && p.inGrant && !p.builtin), r.json);
  r = await call("GET", "/connections");
  check("GET /connections (the sample grant)", r.status === 200 && r.json.some((c: any) => c.platform === "zendesk") && r.json.some((c: any) => c.platform === "anthropic"));
  r = await call("POST", "/profile-drafts", { platform: "zendesk" });
  check("POST /profile-drafts lists models, no AI", r.status === 200 && r.json.proposal === null && r.json.models.some((m: any) => m.key === "ticket"), r.json?.models?.map((m: any) => m.key));
  r = await call("POST", `/profile-drafts/${r.json.id}/models`, { models: ["ticket"] });
  const draft = r.json;
  check("POST /profile-drafts zendesk", r.status === 200 && draft.proposedBy === "fixture" && draft.validation?.ok && draft.edits.selected[0] === "zendesk.tickets", draft?.validation);
  r = await call("GET", `/profile-drafts/${draft.id}`);
  check("GET /profile-drafts/:id", r.status === 200 && r.json.id === draft.id);
  r = await call("PATCH", `/profile-drafts/${draft.id}`, { step: "fields", edits: { selected: ["zendesk.tickets"], profiles: { "zendesk.tickets": { title: "Support tickets" } } } });
  check("PATCH /profile-drafts/:id", r.status === 200 && r.json.step === "fields" && r.json.edits.profiles["zendesk.tickets"].title === "Support tickets");
  r = await call("POST", `/profile-drafts/${draft.id}/dry-run`, { actionId: "sample::zendesk::incremental-tickets-cursor" });
  check("POST /profile-drafts/:id/dry-run", r.status === 200 && r.json.ok && r.json.count > 0, r.json);
  r = await call("POST", `/profile-drafts/${draft.id}/preview`, { profileId: "zendesk.tickets" });
  check("POST /profile-drafts/:id/preview", r.status === 200 && r.json.samples.length >= 3 && r.json.samples[0].row.title, r.json?.samples?.length);
  r = await call("POST", `/profile-drafts/${draft.id}/validate`);
  check("POST /profile-drafts/:id/validate", r.status === 200 && r.json.ok, r.json?.issues?.filter((i: any) => i.level === "error"));
  r = await call("POST", `/profile-drafts/${draft.id}/repropose`, { hint: "tickets only" });
  check("POST /profile-drafts/:id/repropose", r.status === 200 && r.json.proposal.models.length >= 1);
  r = await call("POST", `/profile-drafts/${draft.id}/save`, { name: "Support tickets", profiles: ["zendesk.tickets"] });
  check("POST /profile-drafts/:id/save", r.status === 200 && r.json.sourceIds.length === 1 && r.json.firstRunIds.length === 1, r.json);
  const zdSource = r.json.sourceIds[0];
  await server.deps.scheduler.idle();
  r = await call("GET", `/sources/${zdSource}`);
  check("the saved Zendesk source ran its first run", r.json.health.status === "healthy" && r.json.health.itemCount >= 10 && r.json.profile.origin === "user", r.json?.health);
  r = await call("GET", "/search?q=in:zendesk");
  check("Zendesk tickets are searchable", r.json.total >= 10, r.json.total);
  r = await call("POST", "/sources", { platform: "zendesk", connectionKey: "sample:zendesk", profileId: (await call("GET", "/profiles")).json.find((p: any) => p.slug === "zendesk.tickets").id });
  check("POST /sources (existing source answers)", r.status === 200 && r.json.id === zdSource, r.json);
  r = await call("POST", "/profile-drafts", { platform: "pipedrive" });
  check("POST /profile-drafts outside the grant", r.status === 200 && r.json.inGrant === false && r.json.connection === null, r.json);
  const outDraft = r.json.id;
  // the Connect app asks for everything: no route changes its ask any more
  r = await call("POST", `/profile-drafts/${outDraft}/widen-ask`);
  check("widen-ask is gone (the app asks for everything)", r.status === 404 && !existsSync(join(home, "connect.extra.json")), r.status);
  r = await call("DELETE", `/profile-drafts/${outDraft}`);
  check("DELETE /profile-drafts/:id", r.status === 204 && (await call("GET", `/profile-drafts/${outDraft}`)).status === 404);
  r = await call("DELETE", `/sources/${zdSource}`, { keepItems: false });
  const after = await call("GET", "/search?q=in:zendesk");
  check("DELETE /sources/:id", r.status === 204 && after.json.total === 0, { status: r.status, body: r.json, total: after.json?.total });

  // settings, saved and recent
  r = await call("GET", "/settings");
  check("GET /settings", r.status === 200 && r.json.chatModel);
  r = await call("PUT", "/settings", { rerank: false, lanesOn: true });
  check("PUT /settings", r.status === 200 && r.json.settings.rerank === false && r.json.effect === null);
  r = await call("GET", "/one-plan");
  check("GET /one-plan (auto, Free until One answers)", r.status === 200 && r.json.plan === "auto" && r.json.limit === 20 && r.json.pace === 18 && r.json.limitFrom === "default" && typeof r.json.monthCalls === "number");
  r = await call("PUT", "/settings", { onePlan: "custom" });
  check("PUT /settings onePlan custom without oneRpm -> 400", r.status === 400);
  r = await call("PUT", "/settings", { onePlan: "custom", oneRpm: 2000 });
  const plan = await call("GET", "/one-plan");
  check("PUT /settings onePlan custom 2000 -> pace 1800", r.status === 200 && plan.json.limit === 2000 && plan.json.pace === 1800 && plan.json.limitFrom === "chosen");
  await call("PUT", "/settings", { onePlan: "auto", oneRpm: null });
  r = await call("PUT", "/settings", { nope: 1 });
  check("PUT /settings unknown key is 400", r.status === 400);
  // the AI engine (Settings, Assistant)
  check("GET /settings engine defaults to auto", (await call("GET", "/settings")).json.engine === "auto");
  r = await call("PUT", "/settings", { engine: "one", localChatModel: "default" });
  check("PUT /settings engine one", r.status === 200 && r.json.settings.engine === "one" && r.json.settings.localChatModel === "default", r.json);
  r = await call("GET", "/assistant/engine");
  check("GET /assistant/engine follows the setting", r.status === 200 && r.json.choice === "one" && r.json.engine === "one" && Array.isArray(r.json.clis), r.json);
  r = await call("POST", "/assistant/engine/redetect");
  check("POST /assistant/engine/redetect", r.status === 200 && r.json.choice === "one", r.json);
  check("PUT /settings bad engine is 400", (await call("PUT", "/settings", { engine: "gpt" })).status === 400);
  await call("PUT", "/settings", { engine: "auto" });
  r = await call("POST", "/saved-searches", { name: "Globex", query: "with:globex.com" });
  const saved = r.json;
  check("POST /saved-searches", r.status === 200 && saved.id && saved.position === 0);
  r = await call("PATCH", `/saved-searches/${saved.id}`, { name: "Globex, all" });
  check("PATCH /saved-searches/:id", r.json.name === "Globex, all");
  r = await call("GET", "/saved-searches");
  check("GET /saved-searches", r.json.length === 1);
  r = await call("DELETE", `/saved-searches/${saved.id}`);
  check("DELETE /saved-searches/:id", r.status === 204 && (await call("GET", "/saved-searches")).json.length === 0);
  r = await call("GET", "/recent-searches");
  check("GET /recent-searches", r.status === 200 && r.json[0].query && typeof r.json[0].resultCount === "number");
  r = await call("DELETE", "/recent-searches");
  check("DELETE /recent-searches", r.status === 204 && (await call("GET", "/recent-searches")).json.length === 0);

  // access and ledger
  r = await call("GET", "/access");
  check("GET /access", r.status === 200 && r.json.readOnly && r.json.mode === "fixture" && r.json.status === "active" && r.json.platforms.length >= 10 && r.json.platforms.some((p: any) => p.actions.some((a: any) => a.level === "write" && !a.granted)), r.json?.platforms?.length);
  r = await call("POST", "/access/receipt-demo");
  check("POST /access/receipt-demo declines, 403", r.status === 200 && r.json.blockedByGrant && r.json.status === 403 && /declined, 403/.test(r.json.sentence), r.json);
  r = await call("GET", "/ledger?limit=500");
  check("GET /ledger", r.status === 200 && r.json.some((x: any) => x.actor === "indexer") && r.json.some((x: any) => x.actor === "mapper") && r.json.some((x: any) => x.blockedByGrant), r.json?.length);
  r = await call("GET", "/ledger?actor=assistant");
  check("GET /ledger?actor=", r.json.every((x: any) => x.actor === "assistant"));

  // setup (local only, write-only)
  r = await call("GET", "/setup/connect");
  check("GET /setup/connect", r.status === 200 && r.json.available && !r.json.configured && r.json.storage === "file" && r.json.redirectUri === `http://localhost:${PORT}/api/one/callback` && r.json.create.askChanged !== undefined, r.json);
  r = await call("POST", "/setup/connect", { ONE_CLIENT_ID: "client_smoke_1234" }, { origin: "https://evil.example" });
  check("POST /setup/connect from another origin is 403 local_only", r.status === 403 && r.json.error.code === "local_only", r.json);
  r = await call("POST", "/setup/connect", { ONE_CLIENT_SECRET: "sk_live_wrongfield1234567" });
  check("POST /setup/connect checks each field", r.status === 400 && r.json.error.code === "invalid_fields" && r.json.error.data.fields.ONE_CLIENT_SECRET);
  r = await call("POST", "/setup/connect", { ONE_CLIENT_ID: "client_smoke_1234", ONE_CLIENT_SECRET: "one_secret_smoke_abcdefghijkl", ONE_CONNECT_KEY: "sk_live_smoke_abcdefghijkl" });
  check("POST /setup/connect saves write-only and turns sign-in on", r.status === 200 && r.json.configured && !JSON.stringify(r.json).includes("one_secret_smoke") && r.json.fields.find((f: any) => f.name === "ONE_CONNECT_KEY").last4 === "ijkl", r.json);
  r = await call("GET", "/me");
  check("GET /me says sign-in is on without a restart", r.json.connect.configured && r.json.connect.signInUrl === "/api/one/authorize");
  r = await call("GET", "/api/one/authorize");
  check("GET /api/one/authorize redirects to One", r.status === 302 && /^https:\/\//.test(r.headers.get("location") ?? ""), r.headers.get("location"));
  r = await call("POST", "/sources/sample");
  check("signing in moved the session off the sample; the sample comes back", r.status === 200 && (await call("GET", "/me")).json.user?.isSample === true);
  r = await call("DELETE", "/setup/connect/ONE_CONNECT_KEY");
  check("DELETE /setup/connect/:name", r.status === 200 && !r.json.configured);
  r = await call("GET", "/setup/connect/create");
  check("GET /setup/connect/create (poll)", r.status === 200 && r.json.create.state === "idle");

  // oauth clients (Phase 3 fills them) and events
  r = await call("GET", "/oauth-clients");
  check("GET /oauth-clients", r.status === 200 && Array.isArray(r.json));
  r = await call("DELETE", "/oauth-clients/cli_none");
  check("DELETE /oauth-clients/:clientId", r.status === 204);
  const ac = new AbortController();
  const ev = await fetch(`${base}/api/v1/events`, { headers: { cookie }, signal: ac.signal });
  const reader = ev.body!.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  ac.abort();
  check("GET /events streams unnamed data frames", ev.headers.get("content-type")?.includes("text/event-stream") === true && /^data: \{"type":"ping"\}/m.test(first) && !/^event:/m.test(first), first);

  // sign out
  r = await call("POST", "/signout");
  check("POST /signout", r.status === 204 && (await call("GET", "/me")).json.signedIn === false);
  r = await call("POST", "/connect/disconnect");
  check("POST /connect/disconnect", r.status === 204);
} catch (e) {
  failures++;
  console.log(`FAIL crashed: ${(e as Error).stack}`);
} finally {
  await server.stop();
  rmSync(home, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} failed, ${passed} passed` : `\nall ${passed} passed`);
process.exit(failures ? 1 : 0);
