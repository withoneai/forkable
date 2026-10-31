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
import { hybridSearch, runChatTurn, SearchError, type ChatEvent } from "@search/core";
import type { AppEnv, Deps } from "./deps.js";
import { ApiError } from "./errors.js";
import { origins, resolveBearer, TokenProblem, wwwAuthenticate, type Bearer, type PgOAuthProvider } from "./oauth.js";
import { entityDetail, itemDetail, sourcesResponse } from "./views.js";

const INSTRUCTIONS = `Search is the user's personal index over the tools they connected through One (mail, calendar, CRM, docs, issues, chat, meeting notes).
Use search for a query, then fetch an id for the full text. Queries take operators: source:gmail type:deal from:priya with:globex.com after:14d before:2026-10-01 is:unread lane:needs_you status:open amount:>50000.
Quote phrases ("final redline"), negate with a minus (-type:event), OR between words.
get_entity answers who someone is (email, domain or name) with their recent items; list_sources says what is indexed and how fresh it is.
ask answers a question grounded only in the user's items, with numbered citations. Everything is read-only.`;

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

  server.registerTool("search", {
    title: "Search everything",
    description: "Search the user's index across every connected source. Supports operators (source:, type:, from:, with:, after:, before:, is:, lane:, status:). Returns ids to pass to fetch.",
    inputSchema: { query: z.string().min(1).max(500), limit: z.number().int().min(1).max(50).default(10) },
    annotations: ro,
  }, (args) => guard("search:read", async () => {
    const res = await hybridSearch(deps.ctx, userId, { q: args.query, limit: args.limit ?? 10 });
    const results = res.results.map((r) => ({ id: r.id, title: r.title, url: r.url, source: r.sourceName, kind: r.kind, date: r.occurredAt, snippet: r.snippet }));
    if (!results.length) return ok(`No results for ${args.query}.${res.parsed.errors.length ? ` (${res.parsed.errors.map((e) => e.message).join("; ")})` : ""}`, { results });
    const lines = results.map((r, i) => `${i + 1}. ${r.title} [${r.source} ${r.kind}, ${day(r.date)}] id ${r.id}${r.url ? `\n   ${r.url}` : ""}${r.snippet ? `\n   ${r.snippet.replace(/\s+/g, " ").slice(0, 240)}` : ""}`);
    // the agent should know when results are weaker than usual (D41, D44)
    const notes = [
      !res.embedder.semantic && (res.embedder.reason === "not_in_grant" || res.embedder.reason === "error") ? `Semantic search is off: ${res.embedder.message ?? res.embedder.reason}. Keyword matches only.` : "",
      res.fallback === "or" ? "No item had every word, so these match any of them." : "",
      res.didYouMean ? `Did you mean ${res.didYouMean.name}?` : "",
    ].filter(Boolean);
    return ok(`${res.total} match${res.total === 1 ? "" : "es"} (${res.mode}), top ${results.length}:\n${lines.join("\n")}${notes.length ? `\n\n${notes.join("\n")}` : ""}`, { results });
  }));

  server.registerTool("fetch", {
    title: "Fetch an item",
    description: "The full text and metadata of one item from search (by id).",
    inputSchema: { id: z.string().min(1) },
    annotations: ro,
  }, (args) => guard("search:read", async () => {
    const d = await itemDetail(deps, userId, args.id);
    const body = (d.body || d.parts.map((p) => [p.author && `${p.author}${p.at ? `, ${day(p.at)}` : ""}:`, p.title, p.text].filter(Boolean).join("\n")).join("\n\n")).slice(0, 20_000);
    const out = { id: d.row.id, title: d.row.title, url: d.row.url, text: body, metadata: { source: d.row.sourceName, kind: d.row.kind, date: d.row.occurredAt, people: d.row.people.map((p) => p.name), facets: d.row.facets } };
    const props = d.properties.map((p) => `${p.label}: ${p.value}`).join("\n");
    return ok(`${d.row.title}\n${d.row.sourceName} ${d.row.kind}, ${day(d.row.occurredAt)}${d.row.url ? `\n${d.row.url}` : ""}${props ? `\n${props}` : ""}\n\n${body}`, out);
  }));

  server.registerTool("get_entity", {
    title: "Look up a person or company",
    description: "Who someone is: pass an email, a domain or a name. Returns the person or company card and their latest items.",
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
    description: "What is indexed: each connected source with its status, item count and last sync.",
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
    description: "Answer a question grounded only in the user's indexed items, with numbered citations. Optional query narrows what it reads (same operators as search). Uses model calls on the user's grant.",
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
