// Mock routes: sign out, disconnect, access and the ledger, the write-only
// Connect setup (and its Create my Connect app flow), OAuth clients.
import type { AccessResponse, AgentId, AgentRow, AgentsResponse, ConnectSetupResponse, LedgerRow, OAuthClientRow } from "@/contract/api-types";
import { logoUrl, platformName } from "@/lib/utils";
import { emit, fail, json, noContent, route } from "./http";
import { createState, ledger, ledgerRow, persist, persisted, setupFields, sources } from "./state";
import { ME } from "./world";

route("POST", "/signout", () => { persisted.signedIn = false; persist(); return noContent(); });
route("POST", "/connect/disconnect", () => { persisted.signedIn = false; persist(); return noContent(); });

const VERB: Record<string, string> = { search: "Search", list: "List", get: "Read", query: "Query", delta: "Read changes in", history: "Read", replies: "Read replies in", calendarList: "List", calendarView: "Read changes in", graphql: "Read", children: "Read" };

function actionRow(platform: string, actionId: string, model: string) {
  const parts = actionId.split(".");
  const last = parts.find((p) => VERB[p]) ?? parts[parts.length - 1]!;
  const verb = VERB[last] ?? "Read";
  return { actionId: `conn_mod_def::${platform}::${actionId}`, title: `${platformName(platform)} ${model.replace(/-/g, " ")}`, verb, level: "read" as const, granted: true, usedBy: [`profiles/${platform}/pack.json`] };
}

function access(): AccessResponse {
  const byPlatform = new Map<string, AccessResponse["platforms"][number]>();
  for (const s of sources.values()) {
    const p = s.def.platform;
    if (!byPlatform.has(p)) byPlatform.set(p, { platform: p, name: platformName(p), logoUrl: logoUrl(p), connectionLabel: s.def.connectionLabel, actions: [] });
    const entry = byPlatform.get(p)!;
    for (const a of s.def.actions) {
      const row = actionRow(p, a, s.def.model);
      if (!entry.actions.some((x) => x.actionId === row.actionId)) entry.actions.push(row);
    }
  }
  byPlatform.get("gmail")?.actions.push({ actionId: "conn_mod_def::GJ3ocgKltKQ::s8UCfiDLSaO9w9oPU32TYA", title: "Gmail message", verb: "Delete", level: "write", granted: false, usedBy: [] });
  const ai: [string, string, string, string][] = [
    ["anthropic", "messages", "Write", "answers with Claude"],
    ["typesafe", "systemone", "Ask", "Jev for lanes and ranking"],
    ["openai", "embeddings", "Create", "embeddings"],
  ];
  for (const [p, id, verb, title] of ai) {
    byPlatform.set(p, { platform: p, name: platformName(p), logoUrl: logoUrl(p), connectionLabel: "dana@acme.com", actions: [{ actionId: `conn_mod_def::${p}::${id}`, title, verb, level: "read", granted: true, usedBy: ["packages/core"] }] });
  }
  return { grantedBy: { name: ME.name, email: ME.emails[0]! }, platforms: [...byPlatform.values()], readOnly: true, manageUrl: "https://app.withone.ai/connections", status: "active", mode: "fixture" };
}

route("GET", "/access", () => access());
route("POST", "/access/receipt-demo", () => {
  const row: LedgerRow = ledgerRow({
    platform: "gmail", action: "Delete a message", actionId: "conn_mod_def::GJ3ocgKltKQ::s8UCfiDLSaO9w9oPU32TYA", actor: "user", method: "DELETE",
    path: "/gmail/v1/users/me/messages/{id}", level: "write", status: 403, ok: false, blockedByGrant: true, refusal: "grant", ms: 9,
    summary: "Search was never allowed to delete. Gmail was never asked.", sentence: "Search tried to delete a Gmail message and One declined it", note: "Receipt demo from the Access page",
  });
  ledger.unshift(row);
  emit({ type: "ledger", row });
  return row;
});
route("GET", "/ledger", ({ url }) => {
  const actor = url.searchParams.get("actor");
  const limit = Number(url.searchParams.get("limit") ?? 100);
  return ledger.filter((r) => !actor || r.actor === actor).slice(0, limit);
});

// ---- Connect setup ---------------------------------------------------------------
type Field = (typeof setupFields)[number];
const required: Field[] = ["ONE_CLIENT_ID", "ONE_CLIENT_SECRET", "ONE_CONNECT_KEY"];

function setupResponse(): ConnectSetupResponse {
  if (createState.state === "waiting" && Date.now() - createState.startedAt > 6000) {
    createState.state = "approved";
    const at = new Date().toISOString();
    persisted.setup.ONE_CLIENT_ID = { last4: "a91c", at };
    persisted.setup.ONE_PERMISSION_SET = { last4: "7e02", at };
    persist();
  }
  const configured = required.every((f) => persisted.setup[f]);
  // Like the real server: an approved app's ids are in .env (pnpm connect wrote them), only the secrets are stored.
  const fromEnv = (name: Field) => createState.state === "approved" && (name === "ONE_CLIENT_ID" || name === "ONE_PERMISSION_SET");
  return {
    available: true, configured, source: createState.state === "approved" ? "env" : Object.keys(persisted.setup).length ? "store" : null, redirectUri: "http://localhost:52289/api/one/callback",
    storage: "keychain", shadowed: false,
    fields: setupFields.map((name) => ({ name, saved: !!persisted.setup[name], where: persisted.setup[name] ? (fromEnv(name) ? "env" : "keychain") : null, updatedAt: fromEnv(name) ? null : persisted.setup[name]?.at ?? null, last4: persisted.setup[name]?.last4 ?? null })),
    create: {
      running: createState.state === "waiting", state: createState.state,
      approvalUrl: createState.state === "waiting" ? "https://app.withone.ai/connect/approve/sample" : null,
      message: createState.state === "approved" ? "Approved. The client ID and permission set are saved." : undefined,
      askChanged: false,
    },
  };
}

function check(name: Field, v: string): string | null {
  const t = v.trim();
  if (!t) return "Paste a value first.";
  if (/\s/.test(t)) return "No spaces. Paste the value exactly as One shows it.";
  if ((name === "ONE_CLIENT_SECRET" || name === "ONE_CONNECT_KEY") && t.length < 16) return "That looks too short for this value.";
  return null;
}

route("GET", "/setup/connect", () => setupResponse());
route("POST", "/setup/connect", ({ body }) => {
  const input = (body ?? {}) as Partial<Record<Field, string>>;
  const errs: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    if (!(setupFields as readonly string[]).includes(k)) { errs[k] = "Unknown field."; continue; }
    const e = check(k as Field, v ?? "");
    if (e) errs[k] = e;
  }
  if (Object.keys(errs).length) return json({ error: { code: "invalid_fields", message: "Some values do not look right.", data: { fields: errs } } }, 400);
  const at = new Date().toISOString();
  for (const [k, v] of Object.entries(input)) persisted.setup[k] = { last4: (v ?? "").trim().slice(-4), at };
  persist();
  return setupResponse();
});
route("DELETE", "/setup/connect/:name", ({ params }) => { delete persisted.setup[params.name!]; persist(); return setupResponse(); });
route("POST", "/setup/connect/create", () => {
  if (createState.state === "waiting") fail(409, "conflict", "A Connect app is already being created.");
  createState.state = "waiting";
  createState.startedAt = Date.now();
  return setupResponse();
});
route("GET", "/setup/connect/create", () => setupResponse());

// ---- OAuth clients -----------------------------------------------------------------
const H = 3_600_000;
const clients: OAuthClientRow[] = [
  { clientId: "cli_search_cli", name: "Search CLI", createdAt: new Date(Date.now() - 50 * H).toISOString(), lastUsedAt: new Date(Date.now() - 2 * H).toISOString(), scopes: ["search:read", "search:ask", "sources:write", "account:read"], activeTokens: 1 },
  { clientId: "cli_claude_code", name: "Claude Code", createdAt: new Date(Date.now() - 26 * H).toISOString(), lastUsedAt: new Date(Date.now() - 0.3 * H).toISOString(), scopes: ["search:read", "search:ask"], activeTokens: 2 },
];
route("GET", "/oauth-clients", () => clients);
// like the server: a revoked client stays listed as signed out
route("DELETE", "/oauth-clients/:clientId", ({ params }) => { const c = clients.find((x) => x.clientId === params.clientId); if (c) c.activeTokens = 0; return noContent(); });

// ---- Agents (the Agents screen) ------------------------------------------------------
// Claude Code starts connected (its OAuth client above), Codex and Cursor are found,
// Claude Desktop is not on this computer. Connect moves a card to "added"; the mock
// then signs it in after 4 s, like a person finishing the step.
const MOCK_BASE = "http://localhost:52289";
const AGENT_NAMES: Record<AgentId, string> = { "claude-code": "Claude Code", codex: "Codex", cursor: "Cursor", "claude-desktop": "Claude Desktop" };
const NEXT: Record<AgentId, string> = {
  "claude-code": "Open Claude Code, type /mcp, pick search and choose Authenticate. Your browser asks you to allow it.",
  codex: "Allow Search in the browser tab that just opened. If none opened, run: codex mcp login search.",
  cursor: "Open Cursor Settings, then MCP, and click Connect next to search. Your browser asks you to allow it.",
  "claude-desktop": "Quit Claude and open it again. Your browser opens once to ask you to allow it.",
};
const READY: Record<AgentId, string> = {
  "claude-code": "Ready. Open a new Claude Code session to use it.",
  codex: "Ready. Open a new Codex session to use it.",
  cursor: "Ready. Cursor picks it up on its own. To see it, in Cursor open Settings, then MCP.",
  "claude-desktop": "Ready. Quit Claude and open it again, then ask it about your mail, meetings or deals.",
};
const agentMock: Record<AgentId, { found: string | null; added: boolean; signedInAt: string | null; usedAt?: string | null; config: string }> = {
  "claude-code": { found: "/Users/dana/.local/bin/claude", added: true, signedInAt: new Date(Date.now() - 0.3 * H).toISOString(), usedAt: new Date(Date.now() - 0.3 * H).toISOString(), config: "/Users/dana/.claude.json" },
  codex: { found: "/Users/dana/.local/bin/codex", added: false, signedInAt: null, config: "/Users/dana/.codex/config.toml" },
  cursor: { found: "/Applications/Cursor.app", added: false, signedInAt: null, config: "/Users/dana/.cursor/mcp.json" },
  "claude-desktop": { found: null, added: false, signedInAt: null, config: "/Users/dana/Library/Application Support/Claude/claude_desktop_config.json" },
};
function agentRowMock(id: AgentId): AgentRow {
  const a = agentMock[id];
  const state = a.added && a.signedInAt ? "connected" : a.added ? "added" : a.found ? "not_connected" : "not_found";
  return {
    id, name: AGENT_NAMES[id], found: !!a.found, foundWhere: a.found, added: a.added, state, lastUsedAt: a.added ? a.usedAt ?? null : null,
    nextStep: state === "added" ? NEXT[id] : state === "connected" && !a.usedAt ? READY[id] : null, configPath: a.config, clientIds: a.signedInAt ? [`cli_${id}`] : [],
    entryName: a.added ? "search" : null, note: null,
    ...(id === "claude-code" ? { skillInstalled: a.added } : {}),
  };
}
route("GET", "/agents", (): AgentsResponse => ({
  local: true, mcpUrl: `${MOCK_BASE}/mcp`, startUrl: `${MOCK_BASE}/start.md`, setupSentence: `Set up Search for me with ${MOCK_BASE}/start.md`,
  genericJson: JSON.stringify({ mcpServers: { search: { type: "http", url: `${MOCK_BASE}/mcp` } } }, null, 2),
  agents: (Object.keys(agentMock) as AgentId[]).map(agentRowMock),
}));
route("POST", "/agents/:id/connect", ({ params }) => {
  const id = params.id as AgentId;
  const a = agentMock[id];
  if (!a) return fail(404, "not_found", "No such agent.");
  if (!a.found) return fail(404, "not_found", `${AGENT_NAMES[id]} is not on this computer. Install it first, then try again.`);
  const changed = !a.added;
  a.added = true;
  // like the server: Connect signs in Claude Code, Cursor and Claude Desktop at once; Codex waits for the browser
  if (changed && id !== "codex") a.signedInAt = new Date().toISOString();
  if (changed && id === "codex") setTimeout(() => { if (agentMock[id].added) agentMock[id].signedInAt = new Date().toISOString(); }, 4000);
  return json({ agent: agentRowMock(id), changed, backup: null, message: changed ? `Added Search to ${AGENT_NAMES[id]}. ${NEXT[id]}` : `${AGENT_NAMES[id]} already has Search.` });
});
route("DELETE", "/agents/:id", ({ params }) => {
  const id = params.id as AgentId;
  const a = agentMock[id];
  if (!a) return fail(404, "not_found", "No such agent.");
  const changed = a.added;
  a.added = false; a.signedInAt = null; a.usedAt = null;
  return json({ agent: agentRowMock(id), changed, backup: null, message: changed ? `Removed Search from ${AGENT_NAMES[id]}.` : `${AGENT_NAMES[id]} did not have Search.` });
});
