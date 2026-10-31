// Env for the server (CONTRACT 2), read once from the repo-root .env, then the
// process env. No secret ever lives in .env: `pnpm connect` writes ids only, and
// the client secret and Connect key come from the setup store (Keychain first).

import { config as loadDotenv, parse as parseDotenv } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CONNECT_NAMES, type ConnectName, type ConnectStore } from "./connect-store.js";

/** The repo root: server/src/config.ts -> ../.. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The One Connect redirect URI is registered once, so this port never floats. */
export const DEFAULT_PORT = 52289;
export const DEFAULT_PG_PORT = 55441;

export interface ServerEnv {
  ONE_CLIENT_ID?: string;
  ONE_CLIENT_SECRET?: string;
  ONE_CONNECT_KEY?: string;
  ONE_REDIRECT_URI?: string;
  ONE_PERMISSION_SET?: string;
  ROOT: string;
  PORT: number;
  HOME: string;
  PG_PORT: number;
  DATABASE_URL?: string;
  PUBLIC_URL: string;
  UI_URL?: string;
  FORCE_KEYWORD: boolean;
  SYNC_CONCURRENCY: number;
  /** Tests: never touch the Keychain. */
  SECRETS?: "keychain" | "file";
  /**
   * Where .env and .env.local live (SEARCH_ENV_DIR). Unset: the repo root plus
   * the shell's ONE_* values. Set: that directory's files only, shell ignored,
   * so a test sees its own Connect ids and never the developer's.
   */
  ENV_DIR?: string;
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

/** Connect values the shell itself set, read before .env is loaded into process.env. */
const SHELL_CONNECT: Partial<Record<ConnectName, string>> = Object.fromEntries(
  CONNECT_NAMES.map((n) => [n, process.env[n]?.trim()]).filter(([, v]) => v),
);

export function loadEnv(overrides: Partial<ServerEnv> = {}): ServerEnv {
  const envDir = overrides.ENV_DIR ?? str("SEARCH_ENV_DIR");
  if (!loaded) {
    loadDotenv({ path: resolve(envDir ? expandHome(envDir) : ROOT, ".env"), quiet: true } as Parameters<typeof loadDotenv>[0]);
    loaded = true;
  }
  const port = Number(overrides.PORT ?? str("SEARCH_PORT") ?? DEFAULT_PORT);
  const pgPort = Number(overrides.PG_PORT ?? str("SEARCH_PG_PORT") ?? DEFAULT_PG_PORT);
  const p = Number.isFinite(port) && port > 0 ? port : DEFAULT_PORT;
  const secrets = str("SEARCH_SECRETS");
  return {
    ONE_CLIENT_ID: str("ONE_CLIENT_ID"),
    ONE_CLIENT_SECRET: undefined,
    ONE_CONNECT_KEY: undefined,
    ONE_REDIRECT_URI: str("ONE_REDIRECT_URI"),
    ONE_PERMISSION_SET: str("ONE_PERMISSION_SET"),
    ROOT,
    PORT: p,
    HOME: resolve(expandHome(str("SEARCH_HOME") ?? "~/.search")),
    PG_PORT: Number.isFinite(pgPort) && pgPort > 0 ? pgPort : DEFAULT_PG_PORT,
    DATABASE_URL: str("SEARCH_DATABASE_URL"),
    PUBLIC_URL: (str("SEARCH_PUBLIC_URL") ?? `http://localhost:${p}`).replace(/\/$/, ""),
    UI_URL: str("SEARCH_UI_URL")?.replace(/\/$/, ""),
    FORCE_KEYWORD: str("SEARCH_FORCE_KEYWORD") === "1",
    SYNC_CONCURRENCY: Math.max(1, Number(str("SEARCH_SYNC_CONCURRENCY") ?? 4) || 4),
    SECRETS: secrets === "file" || secrets === "keychain" ? secrets : undefined,
    ...overrides,
    ENV_DIR: envDir ? resolve(expandHome(envDir)) : undefined,
  };
}

export const localRedirectUri = (port: number) => `http://localhost:${port}/api/one/callback`;

export type ConnectValues = Partial<Record<ConnectName, string>>;

/**
 * Connect values in the environment, read fresh: the shell first, then
 * .env.local, then .env (`one connect create` writes .env.local when it exists,
 * else .env). Empty strings count as unset.
 */
export function readConnectEnv(root: string = ROOT, shell: ConnectValues = SHELL_CONNECT): ConnectValues {
  const files: Record<string, string>[] = [];
  for (const name of [".env.local", ".env"]) {
    const path = resolve(root, name);
    if (!existsSync(path)) continue;
    try { files.push(parseDotenv(readFileSync(path, "utf8"))); } catch { /* unreadable */ }
  }
  const out: ConnectValues = {};
  for (const n of CONNECT_NAMES) {
    const v = [shell[n], ...files.map((f) => f[n])].map((x) => x?.trim()).find((x) => x);
    if (v) out[n] = v;
  }
  return out;
}

/** The Connect ids this server's environment names (ENV_DIR when set, else repo root + shell). */
/**
 * Where the extra Connect ask (connect.extra.json, SPEC D26) is read and written.
 * With SEARCH_ENV_DIR set (every smoke and test) it lives there, never in the repo.
 */
export function connectExtraFile(env: Pick<ServerEnv, "ROOT" | "ENV_DIR">): string {
  const file = resolve(env.ENV_DIR ?? env.ROOT, "connect.extra.json");
  assertNotRepoFileUnderTest(file);
  return file;
}

/**
 * Tests set SEARCH_SMOKE=1. Under it, the repo's own ask and env files are off limits,
 * so a smoke can never change the Connect app a real user approves.
 */
export function assertNotRepoFileUnderTest(file: string): void {
  if (process.env.SEARCH_SMOKE !== "1") return;
  const guarded = ["connect.extra.json", "connect.manifest.json", ".env", ".env.local"].map((f) => resolve(ROOT, f));
  if (guarded.includes(resolve(file))) throw new Error(`A test tried to use the repo's ${file}. Set SEARCH_ENV_DIR to a temp folder.`);
}

export function connectEnvOf(env: Pick<ServerEnv, "ROOT" | "ENV_DIR">): ConnectValues {
  return env.ENV_DIR ? readConnectEnv(env.ENV_DIR, {}) : readConnectEnv(env.ROOT);
}

export interface ConnectResolution {
  values: ConnectValues;
  source: "store" | "env" | null;
  shadowedClientId: string | null;
}

const SECRET_NAMES = ["ONE_CLIENT_SECRET", "ONE_CONNECT_KEY"] as const;

/**
 * One Connect app from two places (Rill's Connect-from-code rule):
 * - .env names a client id: it wins for the ids; each secret comes from the
 *   store only when the store holds the same client id. A different stored app
 *   is reported as shadowed, never used.
 * - Only the store names a client id: every value comes from the store.
 * - Neither: sign-in stays off.
 * Secrets in .env are ignored on purpose: they belong in the store.
 */
export function resolveConnect(env: ConnectValues, stored: ConnectValues, port: number): ConnectResolution {
  const local = localRedirectUri(port);
  if (env.ONE_CLIENT_ID) {
    const match = stored.ONE_CLIENT_ID === env.ONE_CLIENT_ID;
    const values: ConnectValues = {
      ONE_CLIENT_ID: env.ONE_CLIENT_ID,
      ONE_PERMISSION_SET: env.ONE_PERMISSION_SET ?? (match ? stored.ONE_PERMISSION_SET : undefined),
      ONE_REDIRECT_URI: env.ONE_REDIRECT_URI ?? (match ? stored.ONE_REDIRECT_URI : undefined) ?? local,
    };
    for (const n of SECRET_NAMES) values[n] = match ? stored[n] : undefined;
    return { values, source: "env", shadowedClientId: stored.ONE_CLIENT_ID && !match ? stored.ONE_CLIENT_ID : null };
  }
  if (stored.ONE_CLIENT_ID) {
    const values: ConnectValues = {};
    for (const n of CONNECT_NAMES) values[n] = stored[n];
    values.ONE_REDIRECT_URI ??= local;
    return { values, source: "store", shadowedClientId: null };
  }
  return { values: {}, source: null, shadowedClientId: null };
}

/** Re-reads .env and the store and writes the one app they agree on into `env`. */
export async function applyStoredConnect(env: ServerEnv, store: ConnectStore, fromEnv: ConnectValues = connectEnvOf(env)): Promise<ConnectResolution> {
  const r = resolveConnect(fromEnv, await store.values(), env.PORT);
  for (const name of CONNECT_NAMES) env[name] = r.values[name];
  return r;
}

export function connectConfigured(env: Pick<ServerEnv, "ONE_CLIENT_ID" | "ONE_CLIENT_SECRET" | "ONE_CONNECT_KEY" | "ONE_REDIRECT_URI">): boolean {
  return !!(env.ONE_CLIENT_ID && env.ONE_CLIENT_SECRET && env.ONE_CONNECT_KEY && env.ONE_REDIRECT_URI);
}
