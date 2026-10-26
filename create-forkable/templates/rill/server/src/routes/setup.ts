import { Hono, type Context } from "hono";
import { CONNECT_FIELDS, checkConnectField, type ConnectFieldName, type ConnectSetupInput, type ConnectSetupResponse } from "@rill/core/connect-setup";
import { connectConfigured, localRedirectUri } from "../config.js";
import type { AppEnv } from "../deps.js";
import { HttpError, badRequest } from "../errors.js";
import { readJson } from "./lib.js";

// The Connect setup screen (local mode only). Write-only: no route returns a
// stored value, only that it is saved, where, when, and its last four. Values
// arrive in a JSON body and go straight to the store; they are never logged,
// never put in an event, never in an error message.

export const setupRoutes = new Hono<AppEnv>();

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** The setup routes answer only this machine's own pages: no other host, no other origin. */
function guard(c: Context<AppEnv>) {
  const setup = c.get("deps").connectSetup;
  if (!setup) throw new HttpError(404, "not_available", "Connect setup runs in local mode only.");
  const host = (c.req.header("host") ?? "").replace(/:\d+$/, "");
  if (!LOCAL_HOSTS.has(host)) throw new HttpError(403, "forbidden", "Connect setup answers only on this computer.");
  const origin = c.req.header("origin");
  if (origin && c.req.method !== "GET") {
    let ok = false;
    try { ok = LOCAL_HOSTS.has(new URL(origin).hostname); } catch { ok = false; }
    if (!ok) throw new HttpError(403, "forbidden", "Connect setup answers only on this computer.");
  }
  return setup;
}

function status(c: Context<AppEnv>): ConnectSetupResponse {
  const deps = c.get("deps");
  const setup = deps.connectSetup!;
  const stored = setup.store.status();
  return {
    available: true,
    configured: connectConfigured(deps.env),
    source: setup.source,
    redirectUri: localRedirectUri(deps.env.PORT),
    storage: setup.store.preferred,
    fields: CONNECT_FIELDS.map((f) => {
      const e = stored[f.name];
      return { name: f.name, saved: !!e, where: e?.where ?? null, updatedAt: e?.updatedAt ?? null, hint: e?.hint ?? null };
    }),
  };
}

setupRoutes.get("/setup/connect", (c) => {
  if (!c.get("deps").connectSetup) {
    const body: Partial<ConnectSetupResponse> = { available: false };
    return c.json(body);
  }
  guard(c);
  return c.json(status(c));
});

/** Save any of the four fields. Empty strings are ignored; use DELETE to clear one. */
setupRoutes.post("/setup/connect", async (c) => {
  const setup = guard(c);
  const body = await readJson<ConnectSetupInput>(c);
  const values: Partial<Record<ConnectFieldName, string>> = {};
  const errors: Record<string, string> = {};
  for (const f of CONNECT_FIELDS) {
    const raw = body?.[f.name];
    if (typeof raw !== "string" || !raw.trim()) continue;
    const check = checkConnectField(f.name, raw);
    if (!check.ok) errors[f.name] = check.message;
    else values[f.name] = raw.trim();
  }
  if (Object.keys(errors).length) throw new HttpError(400, "invalid_fields", "Some values are not in the right format.", { fields: errors });
  if (!Object.keys(values).length) throw badRequest("Nothing to save.");
  // The redirect is the pinned local port's, stored with the app so the client never guesses it.
  await setup.store.set({ ...values, ONE_REDIRECT_URI: localRedirectUri(c.get("deps").env.PORT) });
  await setup.reload();
  return c.json(status(c));
});

setupRoutes.delete("/setup/connect/:name", async (c) => {
  const setup = guard(c);
  const name = c.req.param("name");
  const field = CONNECT_FIELDS.find((f) => f.name === name);
  if (!field) throw badRequest("Not a Connect setting.");
  await setup.store.remove([field.name]);
  await setup.reload();
  return c.json(status(c));
});
