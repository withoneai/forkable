import { config as loadDotenv } from "dotenv";
import os from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { one, type RillEnv } from "@rill/core";
import { CONNECT_NAMES, type ConnectStore } from "./connect-store.js";

/** The repo root: server/src/config.ts -> ../.. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The One Connect redirect URI is registered once, so this port never floats. */
export const DEFAULT_PORT = 51789;
/** 55432 belongs to another app on a dev machine; Rill uses its own. */
export const DEFAULT_PG_PORT = 55439;

export interface ServerEnv extends RillEnv {
  PORT: number;
  HOME: string;
  DATABASE_URL?: string;
  PG_PORT: number;
}

function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return resolve(os.homedir(), value.slice(2));
  return value;
}

function str(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

let loaded = false;

/** Reads .env from the repo root once, then builds the env the core and the server share. */
export function loadEnv(overrides: Partial<ServerEnv> = {}): ServerEnv {
  if (!loaded) {
    loadDotenv({ path: resolve(ROOT, ".env") });
    loaded = true;
  }
  const home = resolve(expandHome(str("RILL_HOME") ?? "~/.rill"));
  const port = Number(str("RILL_PORT") ?? DEFAULT_PORT);
  const pgPort = Number(str("RILL_PG_PORT") ?? DEFAULT_PG_PORT);
  return {
    ONE_CLIENT_ID: str("ONE_CLIENT_ID"),
    ONE_CLIENT_SECRET: str("ONE_CLIENT_SECRET"),
    ONE_CONNECT_KEY: str("ONE_CONNECT_KEY"),
    ONE_REDIRECT_URI: str("ONE_REDIRECT_URI"),
    ONE_PERMISSION_SET: str("ONE_PERMISSION_SET"),
    AI_ENGINE: str("AI_ENGINE"),
    AI_PROVIDER: str("AI_PROVIDER"),
    AI_MODEL: str("AI_MODEL"),
    JEV_MODEL: str("JEV_MODEL"),
    RECORD: str("RECORD"),
    LOCAL: true,
    ROOT,
    PORT: Number.isFinite(port) && port > 0 ? port : DEFAULT_PORT,
    HOME: home,
    DATABASE_URL: str("DATABASE_URL"),
    PG_PORT: Number.isFinite(pgPort) && pgPort > 0 ? pgPort : DEFAULT_PG_PORT,
    ...overrides,
  };
}

/** The redirect URI local mode registers: the pinned port, never a floating one. */
export const localRedirectUri = (port: number) => `http://localhost:${port}/api/one/callback`;

/**
 * The Connect app from the setup screen's store (Keychain first), else from
 * the environment. One app is a unit: once the store holds a client id, every
 * Connect value comes from the store, so a new app's id never pairs with an
 * old app's secret left in .env.
 */
export async function applyStoredConnect(env: ServerEnv, store: ConnectStore): Promise<"store" | "env" | null> {
  const stored = await store.values();
  if (stored.ONE_CLIENT_ID) {
    for (const name of CONNECT_NAMES) env[name] = stored[name];
    env.ONE_REDIRECT_URI ??= localRedirectUri(env.PORT);
    return "store";
  }
  return connectConfigured(env) ? "env" : null;
}

/** Which Connect-related env vars are set, for the banner and GET /me. */
export function connectConfigured(env: RillEnv): boolean {
  return !!(env.ONE_CLIENT_ID && env.ONE_CLIENT_SECRET && env.ONE_CONNECT_KEY && env.ONE_REDIRECT_URI);
}
