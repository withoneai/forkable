// The MCP server (SPEC 16.4, CONTRACT 11): POST /mcp, Streamable HTTP, stateless
// (a fresh McpServer and transport per request, JSON responses), behind OAuth
// bearer auth. Read-only tools that call the same code as the REST routes, always
// as the token's user, never a user id from arguments. Hosts drop structuredContent
// when isError is set, so errors are text only.

import type { Context, Hono } from "hono";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { hybridSearch, parseQuery, PLATFORM_NAMES, runChatTurn, SearchError, TYPE_ALIASES, type ChatEvent, type OpValue, type ResultRow } from "@search/core";
import type { AppEnv, Deps } from "./deps.js";
import { ApiError } from "./errors.js";
import { origins, resolveBearer, TokenProblem, wwwAuthenticate, type Bearer, type PgOAuthProvider } from "./oauth.js";
import { entityDetail, itemDetail, sourcesResponse } from "./views.js";

const INSTRUCTIONS = `Search is the person's own index over the tools they connected through One: mail, calendars, meeting notes, CRM deals and contacts, docs, issues and chat. It runs on their computer and is read only.
Reach for it whenever a question is about their own work: who someone is, what was said or agreed, where a deal or project stands, what is on the calendar, or where a document is. Not for general knowledge.
Who is someone, or what is going on with a company: call get_entity first (a name, an email or a domain).
Otherwise start with search: a few words plus filters (source, type, container for a channel or folder, from, with, after, before), or inline like in:gmail from:priya after:14d is:unread "exact phrase" -type:event; in:#deals means the deals channel. Put a filter in its field or in the query, not both. It tells you the total and the offset for the next page.
When you pass along the person's own sentence ("emails from Priya last week"), set understand: true and check understood and searchedAs; for your own short keywords and filters leave it off.
Then fetch the ids that matter; long items come in parts (truncated plus an offset to continue).
list_sources says what is connected and how fresh it is; ask writes one answer with citations (it costs a model call).
Cite the title, source, date and url of what you used.`;

export interface SearchFilters { query?: string; source?: string; type?: string; from?: string; with?: string; after?: string; before?: string; container?: string }
const FILTER_KEYS = ["source", "type", "container", "from", "with", "after", "before"] as const;

/** The kinds `type` takes, as the person would say them. */
export const TYPE_WORDS = ["mail", "event", "meeting", "deal", "doc", "task", "message", "person", "company", "note"];

/**
 * People and agents say in:#deals for a channel, but in: is the source filter
 * (in:gmail). A value that starts with # is a channel, so it becomes container:
 * (the typed filter for a channel, folder, project or list). Returns the query
 * and what was read that way, so the answer can say so.
 */
export function channelsAsContainer(query: string): { query: string; read: string[] } {
  const read: string[] = [];
  const out = query.replace(/(^|\s)(-?)in:#("[^"]+"|\S+)/gi, (_m, pre: string, neg: string, name: string) => {
    read.push(`in:#${name} as ${neg}container:${name}`);
    return `${pre}${neg}container:${name}`;
  });
  return { query: out, read };
}

/**
 * Unknown type: and source: values (type:spaceship, source:myspace) are an error
 * that lists what is valid, instead of a quiet "No results". `connected` is the
 * person's connected platforms.
 */
export function checkFilterValues(q: string, connected: string[], now: Date = new Date()): string | null {
  const parsed = parseQuery(q, now);
  const bad: string[] = [];
  const known = (v: string) => {
    const s = v.toLowerCase().replace(/^#/, "");
    return connected.some((slug) => {
      const name = (PLATFORM_NAMES[slug] ?? slug).toLowerCase();
      return slug === s || name === s || name.replace(/\s+/g, "") === s || name.replace(/\s+/g, "-") === s || slug.startsWith(`${s}-`) || (s === "calendar" && slug.endsWith("-calendar"));
    });
  };
  for (const c of parsed.clauses) {
    if (c.kind !== "op") continue;
    for (const v of c.values) {
      if (v.t !== "text") continue;
      if (c.key === "type" && !TYPE_ALIASES[String(v.v).toLowerCase()]) bad.push(`type:${v.v} is not a kind Search knows. Use one of: ${TYPE_WORDS.join(", ")}.`);
      if (c.key === "source" && !known(String(v.v))) bad.push(`${c.raw.split(":")[0]?.replace(/^-/, "")}:${v.v} is not a connected source. Connected: ${connected.length ? connected.join(", ") : "none yet"}.${String(v.v).startsWith("#") ? "" : " For a channel, use container (or in:#name)."}`);
    }
  }
  return bad.length ? bad.join(" ") : null;
}
/**
 * A status: value that matches nothing this person has (status:open on Linear, whose
 * states are Todo, In Progress, Done, ...) is an error that lists the values that do
 * exist, by tool, like type: and source:. Matching is the search's own: a prefix, any case.
 */
export async function checkStatusValues(deps: Deps, userId: string, q: string, now: Date = new Date()): Promise<string | null> {
  const asked = parseQuery(q, now).clauses.flatMap((c) => (c.kind === "op" && c.key === "status" ? c.values.filter((v) => v.t === "text").map((v) => String(v.v).toLowerCase()) : []));
  if (!asked.length) return null;
  const rows = (await deps.db.execute(sql`select platform, lower(status) as status, count(*)::int as n from items where user_id = ${userId} and deleted_at is null and coalesce(status, '') <> '' group by 1, 2 order by 1, 3 desc`)).rows as { platform: string; status: string; n: number }[];
  const missing = asked.filter((a) => !rows.some((r) => r.status.startsWith(a)));
  if (!missing.length) return null;
  const byTool = new Map<string, string[]>();
  for (const r of rows) byTool.set(r.platform, [...(byTool.get(r.platform) ?? []), r.status]);
  const list = [...byTool].map(([p, v]) => `${PLATFORM_NAMES[p] ?? p}: ${v.slice(0, 12).map((x) => (/\s/.test(x) ? `"${x}"` : x)).join(", ")}`).join("; ");
  return `${missing.map((m) => `status:${/\s/.test(m) ? `"${m}"` : m}`).join(", ")} matches nothing in this person's items. Statuses that exist: ${list || "none yet"}.`;
}

const DATE_HELP = "Use a date like 2026-10-01, a span like 14d or 3m, or words like today, yesterday, this week, last week, this month, last month.";

const opText = (v: OpValue): string => (v.t === "range" ? `${v.from}..${v.to}` : String(v.v));

/**
 * The query string from free text plus structured filters (CONTRACT 11). The rule
 * for a filter given twice: the same value in `query` and in its own field is used
 * once; different values are an error that names both, never a silent pick. A
 * filter value Search cannot read (a date it does not know, say) is an error too.
 * Date fields take what the query takes, with spaces read as dashes ("last week").
 */
export function composeQuery(a: SearchFilters, now: Date = new Date(), tz?: string): { q: string } | { error: string } {
  const text = a.query?.trim() ?? "";
  const inQuery = parseQuery(text, now, tz);
  if (inQuery.errors.length) {
    const msgs = inQuery.errors.map((e) => e.message);
    const types = msgs.map((m) => /^type: unknown type "(.+)"$/.exec(m)?.[1]).filter((x): x is string => !!x);
    if (types.length) return { error: `${types.map((t) => `type:${t}`).join(", ")} is not a kind Search knows. Use one of: ${TYPE_WORDS.join(", ")}.` };
    return { error: `Search could not read the query: ${msgs.join("; ")}.${msgs.some((m) => /date|range/.test(m)) ? ` ${DATE_HELP}` : ""}` };
  }
  const ops = inQuery.clauses.flatMap((c) => (c.kind === "op" && !c.negate ? [c] : []));
  const parts = [text];
  for (const key of FILTER_KEYS) {
    let v = a[key]?.trim().replace(/"/g, "");
    if (!v) continue;
    if (key === "after" || key === "before") {
      v = v.toLowerCase().replace(/\s+/g, "-");
      const probe = parseQuery(`${key}:${v}`, now, tz);
      const val = probe.clauses.find((c) => c.kind === "op");
      if (probe.errors.length || !val || val.kind !== "op" || !val.values.every((x) => x.t === "date" || x.t === "range" || x.t === "cmp")) {
        return { error: `${key}: Search could not read "${a[key]}" as a date. ${DATE_HELP}` };
      }
    }
    const same = ops.filter((c) => c.key === key);
    if (same.length) {
      const typed = same.map((c) => c.values.map(opText).join(",")).join(" ");
      if (typed.toLowerCase() === v.toLowerCase()) continue;
      return { error: `The query says ${same.map((c) => c.raw).join(" ")} but ${key} says ${a[key]}. Put the ${key} filter in one place: its own field, or the query.` };
    }
    parts.push(`${key}:${/\s/.test(v) ? `"${v}"` : v}`);
  }
  return { q: parts.filter(Boolean).join(" ") };
}

export const FETCH_DEFAULT_CHARS = 20_000;
export const FETCH_MAX_CHARS = 50_000;

const text = (t: string): CallToolResult => ({ content: [{ type: "text", text: t }] });
const fail = (t: string): CallToolResult => ({ content: [{ type: "text", text: t }], isError: true });
const ok = (t: string, structured: Record<string, unknown>): CallToolResult => ({ content: [{ type: "text", text: t }], structuredContent: structured });
const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");

function errText(e: unknown): string {
  if (e instanceof ApiError || e instanceof SearchError) return e.message;
  return "Search could not answer that. Try again in a moment.";
}

export function buildMcpServer(deps: Deps, who: Bearer): McpServer {
  const server = new McpServer({ name: "search", title: "Search", version: deps.version }, { instructions: INSTRUCTIONS, capabilities: { tools: {} } });
  const userId = who.userId;
  const has = (scope: string) => who.scopes.includes(scope);
  const guard = async (scope: string, fn: () => Promise<CallToolResult>): Promise<CallToolResult> => {
    if (!has(scope)) return fail(`This connection lacks the ${scope} scope. Reconnect and allow it.`);
    try { return await fn(); } catch (e) { return fail(errText(e)); }
  };
  const ro = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

  /** Primary email of each person on these rows, so an agent can tell who sent what. */
  const emailsOf = async (rows: ResultRow[]): Promise<Map<string, string>> => {
    const ids = [...new Set(rows.flatMap((r) => r.people.map((p) => p.entityId)))];
    if (!ids.length) return new Map();
    const r = await deps.db.execute(sql`select id, primary_email from entities where user_id = ${userId} and id in (${sql.join(ids.map((x) => sql`${x}`), sql`, `)}) and primary_email is not null`);
    return new Map((r.rows as { id: string; primary_email: string }[]).map((x) => [x.id, x.primary_email]));
  };
  const itemLink = (id: string, url: string | null) => url || `${new URL(deps.env.PUBLIC_URL).origin}/item/${encodeURIComponent(id)}`;

  server.registerTool("search", {
    title: "Search everything",
    description: [
      "Search the person's own items across every connected source (mail, calendar, meeting notes, CRM, docs, issues, chat).",
      "Use this when a question is about their own work: a person, a company, a deal, a project, a meeting, a message or a document. Start here, then fetch the ids that matter.",
      "Pass query (a few words) and any filters: source (gmail, outlook, google-calendar, hubspot, attio, notion, linear, slack, ...), type (mail, meeting, event, doc, issue, message, deal, note, person, company), container (a channel, folder or project, like deals for #deals), from, with (a person, email or domain), after and before (2026-10-01, or 14d for the last 14 days). query also takes inline filters like is:unread, in:#deals, \"exact phrase\", -type:event, and status: with the tool's own words: status:\"in progress\" or status:done for issues (Linear), status:contractsent or status:closedwon for deals (HubSpot), status:confirmed for events. An unknown type, source or status is an error that lists the values that exist.",
      "Each result lists its people with their address and role. The result says the total; when there are more, call again with the offset it gives.",
      "Relaying the person's own sentence (\"what did Priya send last week\")? Set understand: true. For a person or company itself, get_entity is better.",
    ].join(" "),
    inputSchema: {
      query: z.string().max(500).optional().describe("Words to look for. Optional when a filter is given."),
      source: z.string().max(80).optional().describe("Only this source, like gmail or hubspot."),
      type: z.string().max(40).optional().describe("Only this kind of item: mail, event, meeting, deal, doc, task, message, person, company, note."),
      container: z.string().max(120).optional().describe("Only items in this channel, folder, project or list (deals or #deals for a Slack channel)."),
      from: z.string().max(200).optional().describe("Sent or written by this person (name or email)."),
      with: z.string().max(200).optional().describe("Involving this person, email or domain."),
      after: z.string().max(40).optional().describe("On or after this date (2026-10-01), within this span (14d, 3m), or a word like yesterday or last week."),
      before: z.string().max(40).optional().describe("Before this date (2026-10-01) or this span ago (30d)."),
      understand: z.boolean().default(false).describe("Set true when query is the person's own sentence (\"emails from Priya last week\"): its phrases become filters; check understood and searchedAs. Leave off for your own keywords."),
      limit: z.number().int().min(1).max(50).default(10).describe("Results per page, 1 to 50."),
      offset: z.number().int().min(0).max(1000).default(0).describe("How many results to skip, for the next page."),
    },
    annotations: ro,
  }, (args) => guard("search:read", async () => {
    const channels = channelsAsContainer(args.query ?? "");
    const container = args.container?.trim().replace(/^#/, "");
    const composed = composeQuery({ ...args, query: channels.query, container }, deps.ctx.now());
    if ("error" in composed) return fail(composed.error);
    const q = composed.q;
    if (!q) return fail("Give a query or at least one filter (source, type, container, from, with, after, before).");
    const connected = [...new Set((await sourcesResponse(deps, who.user)).sources.map((x) => x.platform))];
    const badValue = checkFilterValues(q, connected, deps.ctx.now()) ?? (await checkStatusValues(deps, userId, q, deps.ctx.now()));
    if (badValue) return fail(badValue);
    const limit = args.limit ?? 10, offset = args.offset ?? 0;
    const understand = args.understand === true;
    const res = await hybridSearch(deps.ctx, userId, { q, limit, offset, understand });
    const emails = await emailsOf(res.results);
    const results = res.results.map((r) => ({
      id: r.id, title: r.title, url: itemLink(r.id, r.url), source: r.sourceName, kind: r.kind, date: r.occurredAt, snippet: r.snippet,
      people: r.people.filter((p) => p.role !== "about" && p.role !== "is").slice(0, 8).map((p) => ({ name: p.name, email: emails.get(p.entityId) ?? null, role: p.role })),
    }));
    const nextOffset = offset + results.length < res.total ? offset + results.length : null;
    const structured: Record<string, unknown> = { query: q, total: res.total, offset, nextOffset, results };
    if (understand) Object.assign(structured, { understood: res.understood.map((u) => ({ phrase: u.phrase, filter: u.filter, label: u.label })), searchedAs: res.searchedAs, suggestions: res.suggestions.map((x) => ({ phrase: x.phrase, choices: x.choices.map((c) => c.filter) })) });
    const channelNote = channels.read.length ? `Read ${channels.read.join(", ")} (the channel).\n` : "";
    const readAs = channelNote + (!understand ? "" : res.understood.length ? `Understood: ${res.understood.map((u) => `"${u.phrase}" as ${u.filter}`).join(", ")}. Searched as: ${res.searchedAs}\n` : `Nothing in the query read as a filter. Searched as: ${res.searchedAs}\n`);
    const problems = res.parsed.errors.length ? ` (${res.parsed.errors.map((e) => e.message).join("; ")})` : "";
    if (!results.length) {
      const why = offset > 0 && res.total > 0 ? `No more results: all ${res.total} were shown.` : `No results for ${q}.${problems} Try fewer words or drop a filter; list_sources says what is connected.`;
      return ok(`${readAs}${why}`, structured);
    }
    const peopleOf = (r: (typeof results)[number]) => r.people.length ? `\n   ${r.people.map((p) => `${p.role} ${p.name}${p.email ? ` <${p.email}>` : ""}`).join("; ")}` : "";
    const lines = results.map((r, i) => `${offset + i + 1}. ${r.title} [${r.source} ${r.kind}, ${day(r.date)}] id ${r.id}\n   ${r.url}${peopleOf(r)}${r.snippet ? `\n   ${r.snippet.replace(/\s+/g, " ").slice(0, 240)}` : ""}`);
    // the agent should know when results are weaker than usual (D41, D44)
    const notes = [
      problems ? `Note${problems}` : "",
      !res.embedder.semantic && (res.embedder.reason === "not_in_grant" || res.embedder.reason === "error") ? `Search by meaning is off: ${res.embedder.message ?? res.embedder.reason}. Results match your words.` : "",
      res.fallback === "or" ? "No item had every word, so these match any of them." : "",
      res.didYouMean ? `Did you mean ${res.didYouMean.name}?` : "",
      nextOffset !== null ? `More: call search again with the same arguments and offset ${nextOffset}.` : "That is every match.",
    ].filter(Boolean);
    return ok(`${readAs}${res.total} match${res.total === 1 ? "" : "es"} for ${q} (${res.mode}). Showing ${offset + 1} to ${offset + results.length} of ${res.total}:\n${lines.join("\n")}\n\n${notes.join("\n")}`, structured);
  }));

  server.registerTool("fetch", {
    title: "Fetch an item",
    description: [
      "The full text and details of one item, by the id search returned.",
      "Use this when a search result looks relevant and you need what it actually says before you answer (the whole mail thread, the meeting notes, the deal's fields, the doc).",
      `Returns up to max_chars characters (default ${FETCH_DEFAULT_CHARS.toLocaleString("en-US")}). When truncated is true, call again with the offset it gives to read the rest.`,
    ].join(" "),
    inputSchema: {
      id: z.string().min(1).describe("An item id from search, get_entity or ask."),
      offset: z.number().int().min(0).default(0).describe("Character to start from, for the next part of a long item."),
      max_chars: z.number().int().min(100).max(FETCH_MAX_CHARS).default(FETCH_DEFAULT_CHARS).describe(`Characters to return, 100 to ${FETCH_MAX_CHARS.toLocaleString("en-US")}.`),
    },
    annotations: ro,
  }, (args) => guard("search:read", async () => {
    const d = await itemDetail(deps, userId, args.id);
    const full = d.body || d.parts.map((p) => [p.author && `${p.author}${p.at ? `, ${day(p.at)}` : ""}:`, p.title, p.text].filter(Boolean).join("\n")).join("\n\n");
    const offset = Math.min(args.offset ?? 0, full.length);
    const max = args.max_chars ?? FETCH_DEFAULT_CHARS;
    const body = full.slice(offset, offset + max);
    const end = offset + body.length;
    const truncated = end < full.length;
    const out = {
      id: d.row.id, title: d.row.title, url: itemLink(d.row.id, d.row.url), text: body,
      truncated, offset, totalChars: full.length, nextOffset: truncated ? end : null,
      metadata: { source: d.row.sourceName, kind: d.row.kind, date: d.row.occurredAt, people: d.row.people.map((p) => p.name), facets: d.row.facets },
    };
    const props = d.properties.map((p) => `${p.label}: ${p.value}`).join("\n");
    const head = `${d.row.title}\n${d.row.sourceName} ${d.row.kind}, ${day(d.row.occurredAt)}\n${out.url}${props && offset === 0 ? `\n${props}` : ""}`;
    const part = offset > 0 || truncated ? `\n\n[Characters ${offset.toLocaleString("en-US")} to ${end.toLocaleString("en-US")} of ${full.length.toLocaleString("en-US")}.${truncated ? ` Truncated: call fetch with id ${d.row.id} and offset ${end} for the rest.` : " This is the end."}]` : "";
    return ok(`${head}\n\n${body}${part}`, out);
  }));

  server.registerTool("get_entity", {
    title: "Look up a person or company",
    description: "Who is this? Pass a name, an email or a domain. Returns the person's or company's card (title, company, emails, which sources mention them) and their 10 latest items with ids. Use this when someone asks who a person is, how they know them, or what is going on with a company: call it before search.",
    inputSchema: { query: z.string().min(1).max(200) },
    annotations: ro,
  }, (args) => guard("search:read", async () => {
    const q = args.query.trim().toLowerCase();
    const exact = sql`exists (select 1 from entity_keys k where k.entity_id = entities.id and k.user_id = ${userId} and k.key in (${`email:${q}`}, ${`domain:${q}`}))`;
    const r = await deps.db.execute(sql`select id from entities where user_id = ${userId} and merged_into_id is null
      and (lower(coalesce(primary_email, '')) = ${q} or lower(coalesce(domain, '')) = ${q} or ${exact} or lower(name) like ${`%${q}%`})
      order by (lower(coalesce(primary_email, '')) = ${q} or lower(coalesce(domain, '')) = ${q} or ${exact}) desc, item_count desc limit 1`);
    const id = (r.rows[0] as { id: string } | undefined)?.id;
    if (!id) return fail(`No person or company matches ${args.query}.`);
    const d = await entityDetail(deps, userId, id);
    const recent = d.timeline.slice(0, 10).map((t) => ({ id: t.id, title: t.title, source: t.sourceName, date: t.occurredAt }));
    const e = d.entity;
    const head = [`${e.name} (${e.type})`, e.title, e.company?.name && `at ${e.company.name}`, e.emails.length ? e.emails.join(", ") : null, e.domain].filter(Boolean).join(" · ");
    const srcs = e.sources.map((s) => `${s.platform} ${s.count}`).join(", ");
    return ok(`${head}\nSeen in: ${srcs || "nothing yet"}\nLatest:\n${recent.map((t, i) => `${i + 1}. ${t.title} [${t.source}, ${day(t.date)}] id ${t.id}`).join("\n") || "none"}`, { entity: e, recent });
  }));

  server.registerTool("list_sources", {
    title: "List sources",
    description: "What is connected and indexed: each source with its status, item count and when it last updated. Use this when a search comes back empty or thin, when someone asks what Search can see, or to check that the connection works.",
    inputSchema: {},
    annotations: ro,
  }, () => guard("search:read", async () => {
    const res = await sourcesResponse(deps, who.user);
    const sources = res.sources.map((s) => ({ id: s.id, platform: s.platform, name: `${s.name} ${s.profile.title}`.trim(), status: s.health.status, items: s.health.itemCount, lastSync: s.health.lastSuccessAt }));
    if (!sources.length) return ok("No sources yet. Open Search and connect a tool.", { sources });
    return ok(sources.map((s) => `${s.name}: ${s.status}, ${s.items} items, last sync ${s.lastSync ?? "never"} (id ${s.id})`).join("\n"), { sources });
  }));

  server.registerTool("ask", {
    title: "Ask about your items",
    description: "One written answer to a question, grounded only in the person's items, with numbered citations. Optional query narrows what it reads (same filters as search). Use this when the person wants a short summary answer and you do not need to read the items yourself; it costs a model call, so prefer search plus fetch when you will write the answer.",
    inputSchema: { question: z.string().min(1).max(2000), query: z.string().max(500).optional() },
    annotations: { ...ro, idempotentHint: false },
  }, (args) => guard("search:ask", async () => {
    let answer: Extract<ChatEvent, { type: "answer" }> | null = null;
    for await (const ev of runChatTurn(deps.ctx, userId, { message: args.question, context: { query: args.query ?? args.question } }, undefined, { actor: "mcp", clientId: who.clientId })) {
      if (ev.type === "answer") answer = ev;
      if (ev.type === "error") return fail(ev.error.message);
    }
    if (!answer) return fail("No answer came back.");
    const citations = answer.citations.map((c) => ({ n: c.n, id: c.itemId, title: c.title, url: c.url, quote: c.quote }));
    const refs = citations.map((c) => `[${c.n}] ${c.title}${c.url ? ` ${c.url}` : ""} (id ${c.id})`).join("\n");
    return ok(`${answer.text}${refs ? `\n\nSources:\n${refs}` : ""}`, { answer: answer.text, grounded: answer.grounded, citations });
  }));

  return server;
}

export function mountMcp(app: Hono<AppEnv>, deps: Deps, provider: PgOAuthProvider): void {
  const cors = (c: Context) => {
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Expose-Headers", "WWW-Authenticate, Mcp-Session-Id, Mcp-Protocol-Version");
  };
  app.options("/mcp", (c) => c.body(null, 204, {
    "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  }));
  app.all("/mcp", async (c) => {
    cors(c);
    let who: Bearer;
    try {
      who = await resolveBearer(deps, provider, c.req.header("authorization"), "mcp");
    } catch (e) {
      if (!(e instanceof TokenProblem)) throw e;
      const hasHeader = !!c.req.header("authorization");
      c.header("WWW-Authenticate", wwwAuthenticate(deps, c, "/mcp", hasHeader ? e : undefined));
      return c.json({ error: { code: e.code, message: e.message } }, 401);
    }
    if (c.req.method !== "POST") {
      // stateless: no standalone SSE stream and no sessions to delete
      return c.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed. POST JSON-RPC to /mcp." }, id: null }, 405, { Allow: "POST" });
    }
    const hosts = origins(deps).map((o) => new URL(o).host);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, enableJsonResponse: true,
      enableDnsRebindingProtection: true, allowedHosts: hosts,
    });
    const server = buildMcpServer(deps, who);
    await server.connect(transport);
    try {
      const res = await transport.handleRequest(c.req.raw, { authInfo: who.auth });
      const headers = new Headers(res.headers);
      headers.set("Access-Control-Allow-Origin", "*");
      return new Response(res.body, { status: res.status, headers });
    } finally {
      void server.close().catch(() => {});
    }
  });
}
