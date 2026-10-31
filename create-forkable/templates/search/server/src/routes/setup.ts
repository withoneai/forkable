// The write-only Connect setup (CONTRACT 6.2, SPEC 13): local only, never returns
// a value, only whether each field is saved, where, when and its last four.
// Keychain service `search.connect` first, else ~/.search/connect.env (0600).
// Saving turns sign-in on without a restart.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Hono, type Context } from "hono";
import type { ConnectSetupResponse } from "@search/core";
import { CONNECT_FIELDS, checkConnectField, type ConnectFieldName } from "../connect-fields.js";
import { connectConfigured, connectExtraFile, localRedirectUri, connectEnvOf, type ServerEnv } from "../config.js";
import type { ConnectName } from "../connect-store.js";
import type { AppEnv, Deps } from "../deps.js";
import { ApiError, badRequest } from "../errors.js";
import { cookieOnly, readJson } from "./lib.js";

export const setupRoutes = new Hono<AppEnv>();

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** Answers only this machine's own pages: no other Host, no other Origin on a write. */
export function localOnly(c: Context<AppEnv>): void {
  const host = (c.req.header("host") ?? "").replace(/:\d+$/, "");
  if (!LOCAL_HOSTS.has(host)) throw new ApiError(403, "local_only", "Connect setup answers only on this computer.");
  const origin = c.req.header("origin");
  if (origin && c.req.method !== "GET") {
    let ok = false;
    try { ok = LOCAL_HOSTS.has(new URL(origin).hostname); } catch { ok = false; }
    if (!ok) throw new ApiError(403, "local_only", "Connect setup answers only on this computer.");
  }
}

function guard(c: Context<AppEnv>) {
  cookieOnly(c);
  const setup = c.get("deps").connectSetup;
  if (!setup) throw new ApiError(404, "not_found", "Connect setup runs in local mode only.");
  localOnly(c);
  return setup;
}

/** The ask Search would send: connect.manifest.json plus connect.extra.json (D26). */
export function askHash(env: Pick<ServerEnv, "ROOT" | "ENV_DIR">): string {
  const read = (f: string) => (existsSync(f) ? readFileSync(f, "utf8") : "");
  return createHash("sha256").update(read(resolve(env.ROOT, "connect.manifest.json"))).update("\u0000").update(read(connectExtraFile(env))).digest("hex").slice(0, 16);
}

function storedAsk(deps: Deps): string | null {
  try { return (JSON.parse(readFileSync(resolve(deps.env.HOME, "connect-ask.json"), "utf8")) as { hash?: string }).hash ?? null; } catch { return null; }
}

function extraPlatforms(env: Pick<ServerEnv, "ROOT" | "ENV_DIR">): number {
  try { return Object.keys((JSON.parse(readFileSync(connectExtraFile(env), "utf8")) as { platforms?: object }).platforms ?? {}).length; } catch { return 0; }
}

export function setupStatus(deps: Deps): ConnectSetupResponse {
  const setup = deps.connectSetup!;
  const stored = setup.store.status();
  const env = deps.env;
  const cr = setup.creator.get();
  const configured = connectConfigured(env);
  const prev = storedAsk(deps);
  const askChanged = !!env.ONE_CLIENT_ID && (prev ? prev !== askHash(env) : extraPlatforms(env) > 0);
  const fromEnv = connectEnvOf(env);
  return {
    available: true, configured, source: setup.resolution.source,
    redirectUri: env.ONE_REDIRECT_URI ?? localRedirectUri(env.PORT),
    storage: setup.store.preferred, shadowed: !!setup.resolution.shadowedClientId,
    fields: CONNECT_FIELDS.map((f) => {
      // The ids `pnpm connect` wrote to .env win, so they show as set by .env
      // even when the store keeps a copy; the two secrets always come from the store.
      const inEnv = (f.name === "ONE_CLIENT_ID" || f.name === "ONE_PERMISSION_SET") && fromEnv[f.name];
      if (inEnv) return { name: f.name, saved: true, where: "env" as const, updatedAt: null, last4: String(inEnv).slice(-4) };
      // A secret saved for another app (before .env named a new one) is not in use: ask again.
      const e = setup.resolution.source === "env" && !setup.resolution.values[f.name as ConnectName] ? undefined : stored[f.name as ConnectName];
      return { name: f.name, saved: !!e, where: e?.where ?? null, updatedAt: e?.updatedAt ?? null, last4: e?.hint ?? null };
    }),
    create: {
      running: setup.creator.running, approvalUrl: cr.link,
      state: cr.phase === "idle" ? "idle" : cr.phase === "done" ? "approved" : cr.phase === "failed" ? "failed" : "waiting",
      ...(cr.error ? { message: cr.error.message } : cr.phase === "done" ? { message: cr.outcome === "unchanged" ? "The Connect app already asks for this." : "Approved. Paste the client secret and Connect key shown on the approval page." } : {}),
      askChanged,
    },
  };
}

async function freshen(c: Context<AppEnv>): Promise<void> {
  const setup = c.get("deps").connectSetup!;
  if (setup.creator.running) return;
  if (JSON.stringify(connectEnvOf(c.get("deps").env)) !== setup.envSnapshot) await setup.reload();
}

setupRoutes.get("/setup/connect", async (c) => {
  if (!c.get("deps").connectSetup) return c.json({ available: false });
  guard(c);
  await freshen(c);
  return c.json(setupStatus(c.get("deps")));
});

const SECRETS: ConnectName[] = ["ONE_CLIENT_SECRET", "ONE_CONNECT_KEY"];

setupRoutes.post("/setup/connect", async (c) => {
  const setup = guard(c);
  const deps = c.get("deps");
  await freshen(c);
  const body = await readJson<Partial<Record<ConnectFieldName, unknown>>>(c);
  const values: Partial<Record<ConnectFieldName, string>> = {};
  const errors: Record<string, string> = {};
  for (const k of Object.keys(body)) if (!CONNECT_FIELDS.some((f) => f.name === k)) errors[k] = "Not a Connect setting.";
  for (const f of CONNECT_FIELDS) {
    const raw = body[f.name];
    if (typeof raw !== "string" || !raw.trim()) continue;
    const check = checkConnectField(f.name, raw);
    if (!check.ok) errors[f.name] = check.message;
    else values[f.name] = raw.trim();
  }
  if (Object.keys(errors).length) throw new ApiError(400, "invalid_fields", "Some values are not in the right format.", { fields: errors });
  if (!Object.keys(values).length) throw badRequest("Nothing to save.");
  const fromEnv = connectEnvOf(deps.env);
  const toStore: Partial<Record<ConnectName, string>> = { ...values };
  if (fromEnv.ONE_CLIENT_ID) {
    if (values.ONE_CLIENT_ID && values.ONE_CLIENT_ID !== fromEnv.ONE_CLIENT_ID) throw new ApiError(409, "conflict", "Your .env names a different Connect app, and that one wins. Remove ONE_CLIENT_ID from .env to use this one.");
    toStore.ONE_CLIENT_ID = fromEnv.ONE_CLIENT_ID;
    if (fromEnv.ONE_PERMISSION_SET && !values.ONE_PERMISSION_SET) toStore.ONE_PERMISSION_SET = fromEnv.ONE_PERMISSION_SET;
    toStore.ONE_REDIRECT_URI = fromEnv.ONE_REDIRECT_URI ?? localRedirectUri(deps.env.PORT);
  } else {
    toStore.ONE_REDIRECT_URI = localRedirectUri(deps.env.PORT);
  }
  const storedId = (await setup.store.values()).ONE_CLIENT_ID;
  if (toStore.ONE_CLIENT_ID && storedId && storedId !== toStore.ONE_CLIENT_ID) {
    const stale = (["ONE_PERMISSION_SET", ...SECRETS] as ConnectName[]).filter((n) => !(n in toStore));
    if (stale.length) await setup.store.remove(stale);
  }
  await setup.store.set(toStore);
  await setup.reload();
  return c.json(setupStatus(deps));
});

setupRoutes.post("/setup/connect/create", async (c) => {
  const setup = guard(c);
  await setup.creator.start();
  return c.json(setupStatus(c.get("deps")));
});

setupRoutes.get("/setup/connect/create", async (c) => {
  guard(c);
  return c.json(setupStatus(c.get("deps")));
});

setupRoutes.delete("/setup/connect/create", (c) => {
  const setup = guard(c);
  setup.creator.cancel();
  return c.json(setupStatus(c.get("deps")));
});

setupRoutes.delete("/setup/connect/:name", async (c) => {
  const setup = guard(c);
  const field = CONNECT_FIELDS.find((f) => f.name === c.req.param("name"));
  if (!field) throw badRequest("Not a Connect setting.");
  await setup.store.remove([field.name]);
  await setup.reload();
  return c.json(setupStatus(c.get("deps")));
});
