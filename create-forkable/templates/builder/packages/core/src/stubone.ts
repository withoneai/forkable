// The sample One (keyless demo, tests, smokes): the slice of One's API
// a preview app's own Connect client talks to, answered from the stub grant
// over fixtures. Served by the platform at /api/stub-one only when the
// platform runs on the sample source; a preview app reaches it through
// ONE_API_URL, which the platform sets only then. Nothing leaves this
// computer, and every answer the app shows from it is labeled Sample.
//
// It holds the app to One's rules where they matter for the flow: the
// redirect URI must be the registered preview callback exactly, the client
// id and secret must be the setup's, the code is single use, PKCE S256 is
// checked, and a call outside the grant is refused the way One refuses it
// (HTTP 403 with a correlationId), so the app's real `declined, 403` path
// runs in preview.

import { createHash, randomBytes } from "node:crypto";
import { PREVIEW_CALLBACK } from "./brand.js";
import type { ConnectSetups } from "./connect.js";
import type { StubGrant } from "./fixtures.js";

interface Code {
  clientId: string;
  redirectUri: string;
  challenge: string;
  hint: string | null;
  at: number;
}

const b64url = (b: Buffer) => b.toString("base64url");
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

/** cu_ + 64 hex, as One derives it: per app and per person, stable. */
export function sampleConnectUserId(clientId: string, who: string): string {
  return `cu_${createHash("sha256").update(`${clientId}|${who}`).digest("hex")}`;
}

/** The values a filled path holds for its template's {{placeholders}} (the stub answers some calls by them). */
export function pathParamsOf(template: string, filled: string): Record<string, string> | undefined {
  const names: string[] = [];
  const rx = template
    .split(/(\{\{?\s*[A-Za-z0-9_]+\s*\}?\})/)
    .map((part) => {
      const m = /^\{\{?\s*([A-Za-z0-9_]+)\s*\}?\}$/.exec(part);
      if (m) {
        names.push(m[1]!);
        return "([^/]+)";
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
  if (!names.length) return undefined;
  const hit = new RegExp(`^${rx}$`).exec(filled.split("?")[0]!);
  if (!hit) return undefined;
  return Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(hit[i + 1]!)]));
}

export interface StubOne {
  /** `sub` is the path after /api/stub-one/ (oauth/authorize, oauth/token, v1/...). */
  handle(req: Request, sub: string): Promise<Response>;
}

export function createStubOne(o: { stub: StubGrant; setups: ConnectSetups }): StubOne {
  const codes = new Map<string, Code>();
  /** cu_ ids this stub handed out, and who signed in. */
  const people = new Map<string, { clientId: string; who: string }>();

  async function callerOf(req: Request): Promise<{ cu: string; who: string } | null> {
    const key = req.headers.get("x-one-secret") ?? "";
    const cu = req.headers.get("x-one-connect-user-id") ?? "";
    if (!key || !/^cu_[0-9a-f]{64}$/.test(cu)) return null;
    const app = await o.setups.byConnectKey(key);
    if (!app) return null;
    const known = people.get(cu);
    // A cu_ this process did not hand out (a restart): any well-formed id on a known app.
    return { cu, who: known && known.clientId === app.values.ONE_CLIENT_ID ? known.who : o.stub.file.builder.email };
  }

  return {
    async handle(req, sub) {
      const url = new URL(req.url);
      if (sub === "oauth/authorize" && req.method === "GET") {
        const q = url.searchParams;
        const clientId = q.get("client_id") ?? "";
        const redirect = q.get("redirect_uri") ?? "";
        const app = await o.setups.byClientId(clientId);
        if (!app) return new Response("Unknown client_id. This sample One only knows the Connect apps set up in this Builder.", { status: 400 });
        if (redirect !== PREVIEW_CALLBACK) return new Response(`redirect_uri must be exactly ${PREVIEW_CALLBACK}, the address registered for this app.`, { status: 400 });
        if (q.get("code_challenge_method") !== "S256" || !q.get("code_challenge")) return new Response("PKCE S256 is required.", { status: 400 });
        const code = `sample_${b64url(randomBytes(18))}`;
        codes.set(code, { clientId, redirectUri: redirect, challenge: q.get("code_challenge")!, hint: q.get("login_hint"), at: Date.now() });
        const back = new URL(redirect);
        back.searchParams.set("code", code);
        back.searchParams.set("state", q.get("state") ?? "");
        return new Response(null, { status: 302, headers: { location: back.toString(), "cache-control": "no-store" } });
      }
      if (sub === "oauth/token" && req.method === "POST") {
        const auth = req.headers.get("authorization") ?? "";
        const [id, secret] = Buffer.from(auth.replace(/^Basic\s+/i, ""), "base64").toString().split(":");
        const app = id ? await o.setups.byClientId(id) : null;
        if (!app || app.values.ONE_CLIENT_SECRET !== secret) return json({ error: "invalid_client" }, 401);
        const form = new URLSearchParams(await req.text());
        const given = form.get("code") ?? "";
        const code = codes.get(given);
        codes.delete(given);
        if (!code || code.clientId !== id || Date.now() - code.at > 10 * 60_000) return json({ error: "invalid_grant" }, 400);
        if (form.get("redirect_uri") !== code.redirectUri) return json({ error: "invalid_grant", error_description: "redirect_uri does not match" }, 400);
        if (b64url(createHash("sha256").update(form.get("code_verifier") ?? "").digest()) !== code.challenge) return json({ error: "invalid_grant", error_description: "PKCE verifier does not match" }, 400);
        const who = code.hint || o.stub.file.builder.email;
        const cu = sampleConnectUserId(id!, who);
        people.set(cu, { clientId: id!, who });
        const token = `${b64url(Buffer.from('{"alg":"none"}'))}.${b64url(Buffer.from("{}"))}.sample`;
        return json({ access_token: token, token_type: "Bearer", expires_in: 3600, connect_user_id: cu });
      }
      if (!sub.startsWith("v1/")) return new Response("Not in the sample One.", { status: 404 });
      const path = sub.slice(3);
      const caller = await callerOf(req);
      if (!caller) return new Response("403 Forbidden", { status: 403 });
      const b = o.stub.file.builder;
      if (path.startsWith("users/whoami") || path.startsWith("users/me")) {
        const self = caller.who === b.email;
        const name = self ? b.name : caller.who.split("@")[0]!;
        const id = self ? b.oneUserId : `sample-${name}`;
        if (path.startsWith("users/whoami")) return json({ user: { id, name, email: caller.who }, organization: null, project: null });
        const [firstName, ...rest] = name.split(" ");
        return json({ id, email: caller.who, firstName, lastName: rest.join(" "), avatar: null });
      }
      if (path.startsWith("connections/reachable")) {
        const rows = await o.stub.listConnections(caller.cu);
        return json({ rows: url.searchParams.get("limit") === "1" ? rows.slice(0, 1) : rows, total: rows.length });
      }
      if (path.startsWith("passthrough/")) {
        const actionId = req.headers.get("x-one-action-id") ?? "";
        const connectionKey = req.headers.get("x-one-connection-key") ?? "";
        const method = req.method.toUpperCase();
        const query: Record<string, string> = {};
        for (const [k, v] of url.searchParams) query[k] = v;
        let body: unknown;
        const text = method === "GET" || method === "HEAD" ? "" : await req.text();
        if (text) {
          try {
            body = JSON.parse(text);
          } catch {
            body = text;
          }
        }
        if (body && typeof body === "object" && !Array.isArray(body)) delete (body as Record<string, unknown>).connectionKey;
        const real = `/${path.slice("passthrough/".length)}`;
        const row = o.stub.knowledge.get(actionId);
        const r = await o.stub.runAction(caller.cu, { connectionKey, actionId, method, path: real, pathParams: row ? pathParamsOf(row.path, real) : undefined, body, query });
        if (r.blockedByGrant) return json({ error: "This action is outside what the user granted this app.", correlationId: `sample-${b64url(randomBytes(6))}` }, 403);
        return json(r.data ?? {}, r.status);
      }
      return new Response("Not in the sample One.", { status: 404 });
    },
  };
}
