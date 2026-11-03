import { existsSync, mkdirSync, readFileSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { BRAND, env } from "./brand.js";
import type { Settings } from "./types.js";
import { EnvStore } from "./envstore.js";

/** BUILDER_HOME layout. */
export interface Home {
  root: string;
  envFile: string;
  config: string;
  db: string;
  shims: string;
  cacheCatalog: string;
  cacheTemplate: string;
  state: string;
  projects: string;
  stateFor(projectId: string): string;
}

export function resolveHome(root?: string): Home {
  const r = resolve(root ?? process.env[env("HOME")] ?? join(homedir(), BRAND.homeDir));
  const h: Home = {
    root: r,
    envFile: join(r, ".env"),
    config: join(r, "config.json"),
    db: join(r, "db"),
    shims: join(r, "shims"),
    cacheCatalog: join(r, "cache", "catalog"),
    cacheTemplate: join(r, "cache", "template"),
    state: join(r, "state"),
    projects: join(r, "projects"),
    stateFor: (id) => join(r, "state", id),
  };
  for (const d of [h.root, h.shims, h.cacheCatalog, h.cacheTemplate, h.state, h.projects]) mkdirSync(d, { recursive: true });
  return h;
}

/**
 * The warm template cache for tests, smokes and the keyless
 * demo: BUILDER_TEST_TEMPLATE_CACHE, else <tmpdir>/builder-template-cache.
 * Never the user's BUILDER_HOME, whose cache a running platform is reading.
 */
export function scratchTemplateCache(): string {
  const dir = resolve(process.env[env("TEST_TEMPLATE_CACHE")] ?? join(tmpdir(), `${BRAND.slug}-template-cache`));
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Points scratch/cache/template at scratchTemplateCache(), so a scratch home warms the template once across runs. */
export function linkScratchTemplateCache(scratch: string): string {
  const shared = scratchTemplateCache();
  mkdirSync(join(scratch, "cache"), { recursive: true });
  symlinkSync(shared, join(scratch, "cache", "template"));
  return shared;
}

export const DEFAULT_SETTINGS: Settings = {
  defaultHarness: null,
  defaultModel: null,
  defaultPermission: "build",
  autoFix: true,
  theme: "system",
  size: "default",
  pendingPrompt: null,
};

export function readSettings(home: Home): Settings {
  if (!existsSync(home.config)) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(readFileSync(home.config, "utf8")) as Partial<Settings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeSettings(home: Home, patch: Partial<Settings>): Settings {
  const next = { ...readSettings(home), ...patch };
  const tmp = `${home.config}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(tmp, home.config);
  return next;
}

/** Names of the builder's Connect app vars and whether each is set. Never values. */
export const CONNECT_VARS = ["ONE_CLIENT_ID", "ONE_CLIENT_SECRET", "ONE_CONNECT_KEY", "ONE_REDIRECT_URI", "ONE_PERMISSION_SET"] as const;

/** Present or missing per name, wherever it is stored (the Keychain or BUILDER_HOME/.env). */
export function connectVarStatus(home: Home): Record<string, "present" | "missing"> {
  const found = new Set(new EnvStore(home).status("builder").map((s) => s.name));
  return Object.fromEntries(CONNECT_VARS.map((k) => [k, found.has(k) ? "present" : "missing"]));
}
