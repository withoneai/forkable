// `search login`: OAuth 2.1 against the Search server as a public client (DCR, no
// secret), PKCE S256, and a loopback redirect on a random 127.0.0.1 port (RFC 8252).
// The browser shows Search's consent page, then Sign in with One (or the Acme
// sample) behind it. Tokens land in ~/.search/cli-token.json, 0600.

import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { hostname } from "node:os";
import { ALL_SCOPES, CliError, dropToken, EXIT, issuedToFile, reach, readToken, tokenRequest, type TokenFile } from "./remote.js";

const DONE_PAGE = (ok: boolean, text: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Search</title>
<style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;font:14px/1.5 Inter,system-ui,sans-serif;background:#fbfdfc;color:#0b0f0d}
@media (prefers-color-scheme:dark){body{background:#0a0a0a;color:#ededed}}main{max-width:360px;padding:24px;text-align:center}h1{font-size:18px;margin:0 0 6px}p{margin:0;opacity:.7}</style></head>
<body><main><h1>${ok ? "You are signed in" : "Sign-in did not finish"}</h1><p>${text}</p></main></body></html>`;

export function openBrowser(url: string): void {
  void import("node:child_process").then(({ spawn }) => {
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
    try { spawn(opener, [url], { stdio: "ignore", detached: true }).unref(); } catch { /* no browser: the URL is printed */ }
  });
}

/** A client id this server still knows: probing /token answers invalid_client for an unknown one. */
async function knownClient(server: string, clientId: string): Promise<boolean> {
  const r = await tokenRequest(server, { grant_type: "refresh_token", client_id: clientId, refresh_token: "probe" });
  return r.json.error !== "invalid_client";
}

async function register(server: string, endpoint: string): Promise<string> {
  const res = await reach(endpoint, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: `Search CLI on ${hostname().replace(/\.local$/, "")}`,
      redirect_uris: ["http://127.0.0.1/callback"],
      token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
      scope: ALL_SCOPES.join(" "), software_id: "withone-search-cli",
    }),
  });
  const j = (await res.json().catch(() => ({}))) as { client_id?: string; error_description?: string };
  if (res.status !== 201 || !j.client_id) throw new CliError(`Could not register the CLI with ${server}: ${j.error_description ?? res.status}`);
  return j.client_id;
}

export interface LoginOptions { server: string; open: boolean; log: (line: string) => void; timeoutMs?: number }

export async function login(o: LoginOptions): Promise<TokenFile> {
  const { server } = o;
  const health = await reach(`${server}/api/health`);
  if (!health.ok) throw new CliError(`${server} does not look like a Search server (${health.status}).`, EXIT.notRunning);
  const meta = (await (await reach(`${server}/.well-known/oauth-authorization-server`)).json()) as { authorization_endpoint: string; token_endpoint: string; registration_endpoint: string; issuer: string };

  const prev = readToken();
  let clientId = prev && prev.server === server && prev.clientId && (await knownClient(server, prev.clientId)) ? prev.clientId : null;
  clientId ??= await register(server, meta.registration_endpoint);

  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("base64url");

  let srv: Server | null = null;
  const result = new Promise<{ code: string; redirectUri: string }>((resolveCode, reject) => {
    srv = createServer((req, res) => {
      const u = new URL(req.url ?? "/", "http://127.0.0.1");
      if (u.pathname !== "/callback") { res.writeHead(404).end(); return; }
      const err = u.searchParams.get("error");
      if (u.searchParams.get("state") !== state) {
        res.writeHead(400, { "content-type": "text/html" }).end(DONE_PAGE(false, "The answer did not match this sign-in. Run search login again."));
        return;
      }
      if (err) {
        res.writeHead(200, { "content-type": "text/html" }).end(DONE_PAGE(false, err === "access_denied" ? "You cancelled. Nothing was shared." : `The server said ${err}.`));
        reject(new CliError(err === "access_denied" ? "Sign-in cancelled." : `Sign-in failed: ${u.searchParams.get("error_description") ?? err}`, EXIT.notSignedIn));
        return;
      }
      if (u.searchParams.get("iss") && u.searchParams.get("iss") !== meta.issuer) {
        res.writeHead(400, { "content-type": "text/html" }).end(DONE_PAGE(false, "The answer came from a different server."));
        reject(new CliError("Sign-in answer came from a different issuer."));
        return;
      }
      res.writeHead(200, { "content-type": "text/html" }).end(DONE_PAGE(true, "You can close this tab and go back to your terminal."));
      const addr = srv!.address();
      resolveCode({ code: u.searchParams.get("code") ?? "", redirectUri: `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/callback` });
    });
    srv.on("error", reject);
  });
  await new Promise<void>((ok) => srv!.listen(0, "127.0.0.1", () => ok()));
  const port = (srv!.address() as { port: number }).port;
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const authUrl = new URL(meta.authorization_endpoint);
  authUrl.search = new URLSearchParams({
    response_type: "code", client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: "S256",
    state, scope: ALL_SCOPES.join(" "), resource: `${server}/api/v1`,
  }).toString();

  o.log(`Opening your browser to sign in to Search at ${server}.`);
  o.log(`If it does not open, visit:\n  ${authUrl.toString()}`);
  if (o.open) openBrowser(authUrl.toString());

  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new CliError("Timed out waiting for the browser (5 minutes). Run search login again.", EXIT.notSignedIn)), o.timeoutMs ?? 5 * 60_000).unref());
  try {
    const { code } = await Promise.race([result, timeout]);
    const r = await tokenRequest(server, { grant_type: "authorization_code", client_id: clientId, code, code_verifier: verifier, redirect_uri: redirectUri, resource: `${server}/api/v1` });
    if (r.status !== 200) throw new CliError(`Token exchange failed: ${String(r.json.error_description ?? r.json.error ?? r.status)}`, EXIT.notSignedIn);
    return issuedToFile(server, clientId, r.json);
  } finally {
    (srv as Server | null)?.close();
  }
}

/** `search logout`: revoke the sign-in on the server (the whole token family), then forget it here. */
export async function logout(): Promise<string> {
  const t = readToken();
  if (!t) return "Not signed in.";
  try {
    await reach(`${t.server}/revoke`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: t.clientId, token: t.refreshToken, token_type_hint: "refresh_token" }).toString() });
  } catch { /* server down: still forget locally */ }
  dropToken();
  return `Signed out of ${t.server}.`;
}
