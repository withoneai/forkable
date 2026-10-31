// The CLI's side of the REST API: the token file (~/.search/cli-token.json, 0600),
// bearer requests with one refresh on 401, and the exit codes from SPEC 16.3.

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

export const EXIT = { ok: 0, error: 1, usage: 2, notSignedIn: 3, notRunning: 4 } as const;
export const DEFAULT_SERVER = "http://localhost:52289";
export const ALL_SCOPES = ["search:read", "search:ask", "sources:write", "account:read"];

export class CliError extends Error {
  constructor(message: string, public readonly exit: number = EXIT.error) { super(message); }
}

export interface TokenFile { server: string; clientId: string; accessToken: string; refreshToken: string; expiresAt: string; scopes: string[] }

export const home = () => resolve(process.env.SEARCH_HOME || resolve(homedir(), ".search"));
export const tokenPath = () => resolve(home(), "cli-token.json");

export function readToken(): TokenFile | null {
  const p = tokenPath();
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")) as TokenFile; } catch { return null; }
}

export function writeToken(t: TokenFile): void {
  const p = tokenPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify(t, null, 2)}\n`, { mode: 0o600 });
  chmodSync(p, 0o600);
}

export function dropToken(): void {
  rmSync(tokenPath(), { force: true });
}

export function serverUrl(flag?: string): string {
  return (flag || process.env.SEARCH_SERVER || readToken()?.server || DEFAULT_SERVER).replace(/\/+$/, "");
}

export async function reach(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    const code = (e as { cause?: { code?: string } }).cause?.code;
    if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "ECONNRESET" || code === "UND_ERR_SOCKET") {
      throw new CliError(`Search is not running at ${new URL(url).origin}. Start it with \`search start\` (or \`pnpm dev\`).`, EXIT.notRunning);
    }
    throw e;
  }
}

export async function tokenRequest(server: string, body: Record<string, string>): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await reach(`${server}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: new URLSearchParams(body).toString() });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

function saveIssued(t: TokenFile, json: Record<string, unknown>): TokenFile {
  const next: TokenFile = {
    ...t,
    accessToken: String(json.access_token),
    refreshToken: String(json.refresh_token ?? t.refreshToken),
    expiresAt: new Date(Date.now() + Number(json.expires_in ?? 3600) * 1000).toISOString(),
    scopes: typeof json.scope === "string" ? json.scope.split(" ") : t.scopes,
  };
  writeToken(next);
  return next;
}

export function issuedToFile(server: string, clientId: string, json: Record<string, unknown>): TokenFile {
  return saveIssued({ server, clientId, accessToken: "", refreshToken: "", expiresAt: "", scopes: [] }, json);
}

async function refresh(t: TokenFile): Promise<TokenFile> {
  const r = await tokenRequest(t.server, { grant_type: "refresh_token", client_id: t.clientId, refresh_token: t.refreshToken });
  if (r.status !== 200) {
    dropToken();
    throw new CliError(`Your sign-in ended (${String(r.json.error_description ?? r.json.error ?? r.status)}). Run \`search login\` again.`, EXIT.notSignedIn);
  }
  return saveIssued(t, r.json);
}

export interface ApiResult<T> { status: number; data: T; res: Response }

/** A bearer request to /api/v1 on the signed-in server. Refreshes once on 401 or when the access token is about to expire. */
export async function api<T = any>(method: string, path: string, body?: unknown, opts: { server?: string } = {}): Promise<T> {
  let t = readToken();
  if (!t) throw new CliError("Not signed in. Run `search login` first.", EXIT.notSignedIn);
  if (opts.server && opts.server !== t.server) throw new CliError(`Signed in to ${t.server}, not ${opts.server}. Run \`search login --server ${opts.server}\`.`, EXIT.notSignedIn);
  if (Date.parse(t.expiresAt) - Date.now() < 30_000) t = await refresh(t);
  const send = (tok: TokenFile) => reach(`${tok.server}/api/v1${path}`, {
    method, headers: { authorization: `Bearer ${tok.accessToken}`, accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let res = await send(t);
  if (res.status === 401) {
    t = await refresh(t);
    res = await send(t);
  }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (res.status === 401) throw new CliError(`Not signed in (${data?.error?.message ?? "401"}). Run \`search login\`.`, EXIT.notSignedIn);
  if (!res.ok) {
    const code = data?.error?.code;
    const msg = data?.error?.message ?? `${res.status} ${res.statusText}`;
    if (code === "not_signed_in") throw new CliError(`${msg} Run \`search login\` again.`, EXIT.notSignedIn);
    throw new CliError(code === "insufficient_scope" ? `${msg} Run \`search login\` to grant it.` : msg);
  }
  return data as T;
}
