// `search mcp`: a stdio MCP server that forwards every JSON-RPC message to the
// running Search's HTTP MCP endpoint (/mcp) with a stored sign-in, for Claude
// Code, Cursor, Claude Desktop and any client that starts local servers.
//
// stdout carries protocol only; every human line goes to stderr. Without --as it
// uses the CLI's sign-in (`search login`) and stops at once, with a clear message,
// when there is none. With --as <agent> it uses that agent's own sign-in in
// SEARCH_HOME/agents/<agent>-token.json (made by the Connect button, bound to
// /mcp), and when there is none it signs in through the browser the first time
// Search is reachable. `--home` points at a SEARCH_HOME other than ~/.search.
//
// Search may not be running when the agent starts the bridge. Then the bridge
// answers `initialize` itself, answers tool calls with a plain error, checks again
// every few seconds, and tells the client its tools changed once Search is up.
// Search's /mcp is stateless and answers JSON, so each line in is one POST.

import { createInterface } from "node:readline";
import { login } from "./login.js";
import { CliError, EXIT, readToken, recoverRefresh, refresh, SignInEnded, signInEndedText, useAgentToken, type TokenFile } from "./remote.js";

export interface BridgeOptions { server: string; as: string | null; clientName?: string; home?: string | null }

const err = (line: string) => process.stderr.write(`[search mcp] ${line}\n`);

type Json = Record<string, unknown>;
const rpcError = (id: unknown, code: number, message: string): Json => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const rpcResult = (id: unknown, result: unknown): Json => ({ jsonrpc: "2.0", id, result });

export async function bridge(o: BridgeOptions): Promise<number> {
  if (o.home) process.env.SEARCH_HOME = o.home;
  useAgentToken(o.as);
  const server = o.server.replace(/\/+$/, "");
  let current: TokenFile | null = readToken();
  if (current && current.server !== server) current = null;
  if (!current && !o.as) throw new CliError(`Not signed in to ${server}. Run \`pnpm run search login\` in the Search folder once, then restart this agent.`, EXIT.notSignedIn);
  /** The sign-in ended (revoked, removed): no browser pops up; each call looks for a new one from Connect. */
  let ended = false;
  /** Whatever another process (or the Connect button) last wrote for this server. */
  const onDisk = (): TokenFile | null => { const t = readToken(); return t && t.server === server ? t : null; };
  const out = (msg: unknown) => process.stdout.write(`${JSON.stringify(msg)}\n`);
  let up = false;
  let answeredInitLocally = false;
  let loggingIn: Promise<void> | null = null;
  let refreshing: Promise<TokenFile> | null = null;
  const notDown = `Search is not running at ${server}. Start it (pnpm dev in the Search folder), then try again.`;
  const waitingForBrowser = "Allow Search in the browser window that opened, then try again.";

  async function reachable(): Promise<boolean> {
    // twice: a check that was in flight when the computer slept (or the process was
    // paused) times out the moment it wakes, though Search is up
    for (let i = 0; i < 2; i++) {
      try {
        const r = await fetch(`${server}/api/health`, { signal: AbortSignal.timeout(2000) });
        if (r.ok) return true;
      } catch { /* look once more */ }
      if (i === 0) await new Promise((r) => setTimeout(r, 300));
    }
    return false;
  }

  /** Up and signed in. Starts the browser sign-in (agents only) when Search is up and there is none. */
  async function ready(): Promise<"ready" | "down" | "login" | "ended"> {
    const was = up;
    up = await reachable();
    if (!up) return "down";
    if (!ended) await recoverRefresh().catch((e: unknown) => { if (e instanceof SignInEnded) { current = null; ended = true; } });
    const disk = onDisk();
    if (disk && (!current || disk.refreshToken !== current.refreshToken)) { current = disk; if (ended) { ended = false; changed(); } }
    if (ended) return "ended";
    if (!current) {
      loggingIn ??= login({
        server, open: !process.env.SEARCH_NO_OPEN, log: (l) => err(l), clientName: o.clientName ?? o.as ?? undefined,
        scopes: ["search:read", "search:ask"], resource: `${server}/mcp`, doneText: "You can close this tab. Search is ready in your agent.",
      }).then((t) => { current = t; err("Signed in."); changed(); }, (e: unknown) => { err(`Sign-in did not finish: ${(e as Error).message}`); }).finally(() => { loggingIn = null; });
      return "login";
    }
    if (!was && answeredInitLocally) changed();
    return "ready";
  }

  /** Tell a client that met a stand-in server that the real tools are there now. */
  function changed(): void {
    if (!answeredInitLocally) return;
    answeredInitLocally = false;
    out({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
  }

  const renew = () => (refreshing ??= refresh(current!).then((t) => { current = t; return t; }).finally(() => { refreshing = null; }));
  const post = (body: string, t: TokenFile) => fetch(`${server}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${t.accessToken}` },
    body,
  });

  /** What to answer while Search cannot: initialize as a stand-in, tool calls as a plain tool error. */
  function standIn(msg: Json, why: string): void {
    if (msg.id === undefined) return; // a notification: nothing to answer
    if (msg.method === "initialize") {
      answeredInitLocally = true;
      const params = (msg.params ?? {}) as { protocolVersion?: string };
      out(rpcResult(msg.id, { protocolVersion: params.protocolVersion ?? "2025-06-18", capabilities: { tools: { listChanged: true } }, serverInfo: { name: "search", title: "Search", version: "0" }, instructions: `Search is the person's own search over their mail, calendar, deals, people and docs. ${why}` }));
    } else if (msg.method === "ping") out(rpcResult(msg.id, {}));
    else if (msg.method === "tools/list") out(rpcResult(msg.id, { tools: [] }));
    else if (msg.method === "tools/call") out(rpcResult(msg.id, { content: [{ type: "text", text: why }], isError: true }));
    else out(rpcError(msg.id, -32001, why));
  }

  async function forward(line: string): Promise<void> {
    let parsed: Json | Json[];
    try { parsed = JSON.parse(line) as Json | Json[]; } catch { out(rpcError(null, -32700, "Parse error")); return; }
    const list = Array.isArray(parsed) ? parsed : [parsed];
    const state = await ready();
    if (state !== "ready") { for (const m of list) standIn(m, state === "down" ? notDown : state === "ended" ? signInEndedText() : waitingForBrowser); return; }
    try {
      if (Date.parse(current!.expiresAt) - Date.now() < 30_000) await renew();
      let res = await post(line, current!);
      if (res.status === 401) { await renew(); res = await post(line, current!); }
      if (res.status === 401) { current = null; ended = true; for (const m of list) standIn(m, signInEndedText()); return; }
      if (res.status === 202 || res.status === 204) return;
      const text = await res.text();
      if (!text.trim()) { if (!res.ok) for (const m of list) if (m.id !== undefined) out(rpcError(m.id, -32603, `Search answered ${res.status}.`)); return; }
      if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) {
        for (const l of text.split(/\r?\n/)) if (l.startsWith("data:")) { const d = l.slice(5).trim(); if (d) process.stdout.write(`${d}\n`); }
        return;
      }
      try { out(JSON.parse(text)); } catch { for (const m of list) if (m.id !== undefined) out(rpcError(m.id, -32603, `Search answered ${res.status} with something that is not JSON.`)); }
    } catch (e) {
      if (e instanceof SignInEnded) { current = null; ended = true; }
      if (e instanceof CliError) { for (const m of list) standIn(m, e.message); return; }
      up = false;
      for (const m of list) standIn(m, notDown);
    }
  }

  // While Search is down, look again every few seconds so the tools come back on their own.
  const watch = setInterval(() => { if (!up && answeredInitLocally) void ready(); }, 3000);
  watch.unref();

  const pending = new Set<Promise<void>>();
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    const p = forward(line).finally(() => pending.delete(p));
    pending.add(p);
  });
  await new Promise<void>((done) => rl.once("close", () => done()));
  await Promise.allSettled([...pending]);
  clearInterval(watch);
  return EXIT.ok;
}
