// Renders the generated-app template (docs/CONTRACT.md section 5).
//
// Two steps, so a new project costs a clone, not an install:
//   1. warmTemplate(cacheRoot, brand): once per template version, render the
//      brand tokens into cacheRoot/<version> and install node_modules there
//      (offline, from the pnpm store the workspace install filled).
//   2. Per project: `cp -cR cacheRoot/<version> projects/<slug>`, then
//      applyProjectVars(dir, vars), which rewrites only the few files that
//      carry __PROJECT_* tokens and removes the cache markers.
// renderTemplate() is the fallback (fresh copy without node_modules; the
// caller then runs `pnpm install --offline`).
//
// Node only. Must not import @builder/core: the brand values are passed in.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { chmod, copyFile, constants as fsConstants, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export interface BrandValues {
  name: string;
  slug: string;
  envPrefix: string;
  homeDir: string;
  projectDir: string;
}

export interface ProjectVars {
  name: string;
  slug: string;
  projectId: string;
  /** ISO time; defaults to now. */
  createdAt?: string;
}

export const TEMPLATE_ROOT = dirname(fileURLToPath(import.meta.url));

/** Marker files in a warm cache dir. applyProjectVars removes them from a project. */
export const READY_MARKER = ".template-ready";
export const FILES_MARKER = ".template-files.json";
export const NATIVES_MARKER = ".template-natives.json";

const EXCLUDE = new Set(["node_modules", "dist", ".wrangler", ".vercel", "render.ts", ".DS_Store", READY_MARKER, FILES_MARKER, NATIVES_MARKER]);
const EXCLUDE_SUFFIX = [".tsbuildinfo"];

/** Top-level names that are stored under another name so they do not act inside this workspace. */
function renameTop(name: string, brand: BrandValues): string {
  switch (name) {
    case "_gitignore":
      return ".gitignore";
    case "_AGENTS.md":
      return "AGENTS.md";
    case "_CLAUDE.md":
      return "CLAUDE.md";
    case "_claude":
      return ".claude";
    case "_agents":
      return ".agents";
    case "_project_dir_":
      return brand.projectDir;
    default:
      return name;
  }
}

/** Template source files, project-relative with "/" separators, sorted. */
export function templateSourceFiles(root = TEMPLATE_ROOT): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (EXCLUDE.has(entry.name) || EXCLUDE_SUFFIX.some((s) => entry.name.endsWith(s))) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) out.push(relative(root, abs).split(sep).join("/"));
    }
  };
  walk(root);
  return out.sort();
}

function computeVersion(): string {
  const h = createHash("sha1");
  for (const f of [...templateSourceFiles(), "render.ts"]) {
    h.update(f);
    h.update("\0");
    h.update(readFileSync(join(TEMPLATE_ROOT, f)));
    h.update("\0");
  }
  return `1-${h.digest("hex").slice(0, 8)}`;
}

/** "1-<content hash>". Recorded as templateVersion in each project. */
export const TEMPLATE_VERSION: string = computeVersion();

const TEXT_EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".jsonc", ".md", ".html", ".css", ".sql", ".txt", ".toml", ".yaml", ".yml", ""]);
const isText = (file: string) => TEXT_EXT.has(extname(file)) || file.endsWith("gitignore");

function escapeFor(file: string, value: string): string {
  const ext = extname(file);
  if (ext === ".html") return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  if ([".json", ".jsonc", ".ts", ".tsx", ".js", ".mjs", ".cjs"].includes(ext)) return JSON.stringify(value).slice(1, -1);
  return value;
}

function brandTokens(brand: BrandValues): [string, string][] {
  return [
    ["__BRAND_NAME__", brand.name],
    ["__BRAND_SLUG__", brand.slug],
    ["__ENV_PREFIX__", brand.envPrefix],
    ["__BRAND_PROJECT_DIR__", brand.projectDir],
    ["__BRAND_HOME_DIR__", brand.homeDir],
    ["__TEMPLATE_VERSION__", TEMPLATE_VERSION],
  ];
}

function projectTokens(vars: ProjectVars): [string, string][] {
  return [
    ["__PROJECT_NAME__", vars.name],
    ["__PROJECT_SLUG__", vars.slug],
    ["__PROJECT_ID__", vars.projectId],
    ["__PROJECT_CREATED_AT__", vars.createdAt ?? new Date().toISOString()],
  ];
}

function substitute(file: string, text: string, tokens: [string, string][]): string {
  let out = text;
  for (const [token, value] of tokens) out = out.split(token).join(escapeFor(file, value));
  return out;
}

/** Output path for a template source file. */
export function outputPath(file: string, brand: BrandValues): string {
  const [top, ...rest] = file.split("/");
  return [renameTop(top!, brand), ...rest].join("/");
}

/** Output paths of the files that still carry __PROJECT_* tokens after the brand pass. */
export function projectTokenFiles(brand: BrandValues): string[] {
  const files = templateSourceFiles()
    .filter((f) => isText(f) && readFileSync(join(TEMPLATE_ROOT, f), "utf8").includes("__PROJECT_"))
    .map((f) => outputPath(f, brand));
  // package.json gets its name token in the brand pass (packageJsonForApp).
  return [...new Set(["package.json", ...files])].sort();
}

function packageJsonForApp(text: string): string {
  const pkg = JSON.parse(text) as Record<string, unknown>;
  pkg.name = "__PROJECT_SLUG__";
  delete pkg.exports;
  pkg.version = "0.0.0";
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

async function copyRendered(dest: string, brand: BrandValues, project: ProjectVars | null): Promise<void> {
  const tokens = [...brandTokens(brand), ...(project ? projectTokens(project) : [])];
  for (const file of templateSourceFiles()) {
    const src = join(TEMPLATE_ROOT, file);
    const out = join(dest, outputPath(file, brand));
    await mkdir(dirname(out), { recursive: true });
    if (!isText(file)) {
      await writeFile(out, await readFile(src));
      continue;
    }
    let text = await readFile(src, "utf8");
    if (file === "package.json") text = packageJsonForApp(text);
    await writeFile(out, substitute(file, text, tokens));
  }
}

/**
 * The platform's own One Connect files (do not edit), which per-project
 * Connect (2026-10-25) rewrote: an older project still calls the retired
 * preview relay through them. The platform renders these over an older
 * project once, as a version of its own.
 */
export const ONE_CONNECT_FILES = [
  "server/one/client.ts",
  "server/one/connect.ts",
  "server/one/index.ts",
  "server/one/session.ts",
  "src/lib/me.ts",
  "src/components/connect/ConnectButton.tsx",
  "src/components/connect/AccountMenu.tsx",
  "src/components/connect/Receipt.tsx",
  "tools/dev-tagger.ts",
  "_claude/skills/one/SKILL.md",
  "_claude/skills/one-connect/SKILL.md",
  "_agents/skills/one/SKILL.md",
  "_agents/skills/one-connect/SKILL.md",
];

/** Render some template files (brand tokens only) into a project, at their output paths. Returns the paths written. */
export async function renderFiles(dest: string, brand: BrandValues, files: string[]): Promise<string[]> {
  const tokens = brandTokens(brand);
  const out: string[] = [];
  for (const file of files) {
    const src = join(TEMPLATE_ROOT, file);
    if (!existsSync(src)) continue;
    const rel = outputPath(file, brand);
    const abs = join(dest, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, isText(file) ? substitute(file, await readFile(src, "utf8"), tokens) : await readFile(src));
    out.push(rel);
  }
  return out;
}

/** Fresh copy with every token rendered and no node_modules. The caller installs. */
export async function renderTemplate(dest: string, vars: ProjectVars & { brand: BrandValues }): Promise<void> {
  await mkdir(dest, { recursive: true });
  await copyRendered(dest, vars.brand, vars);
}

/** Rewrites the __PROJECT_* tokens in a cloned warm copy and drops the cache markers. */
export async function applyProjectVars(dir: string, vars: ProjectVars): Promise<void> {
  const listFile = join(dir, FILES_MARKER);
  let files: string[];
  if (existsSync(listFile)) files = JSON.parse(await readFile(listFile, "utf8")) as string[];
  else files = scanForProjectTokens(dir);
  const tokens = projectTokens(vars);
  for (const f of files) {
    const abs = join(dir, f);
    if (!existsSync(abs)) continue;
    const text = await readFile(abs, "utf8");
    if (text.includes("__PROJECT_")) await writeFile(abs, substitute(f, text, tokens));
  }
  await rm(listFile, { force: true });
  await rm(join(dir, READY_MARKER), { force: true });
  await rm(join(dir, NATIVES_MARKER), { force: true });
}

function scanForProjectTokens(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".git" || e.name === ".wrangler") continue;
      const abs = join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile() && isText(e.name) && statSync(abs).size < 512_000 && readFileSync(abs, "utf8").includes("__PROJECT_"))
        out.push(relative(dir, abs).split(sep).join("/"));
    }
  };
  walk(dir);
  return out;
}

function cleanInstallEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^npm_/i.test(k) || /^PNPM_SCRIPT/i.test(k)) continue;
    env[k] = v;
  }
  env.CI = "1";
  return env;
}

function run(cmd: string, args: string[], cwd: string, log: (line: string) => void): Promise<{ code: number; tail: string }> {
  return new Promise((done) => {
    const child = spawn(cmd, args, { cwd, env: cleanInstallEnv(), stdio: ["ignore", "pipe", "pipe"] });
    let tail = "";
    const take = (b: Buffer) => {
      tail = (tail + b.toString()).slice(-4000);
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("error", (err) => done({ code: 127, tail: String(err) }));
    child.on("close", (code) => {
      if (code !== 0) log(tail.trim().split("\n").slice(-5).join("\n"));
      done({ code: code ?? 1, tail });
    });
  });
}

/**
 * A warm cache dir is usable: the ready marker AND the files it promises. A
 * marker alone is not enough; an interrupted warm once left a dir holding only
 * the marker, and every project cloned from it came out empty.
 */
export function isWarm(dir: string): boolean {
  return existsSync(join(dir, READY_MARKER)) && existsSync(join(dir, "package.json")) && existsSync(join(dir, "node_modules"));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Makes cacheRoot/<TEMPLATE_VERSION> with node_modules, once. Idempotent:
 * returns at once when the dir is warm. Safe across processes: each warm
 * builds in its own tmp dir and claims the final name with one rename, which
 * fails while another warm's dir is there. A loser waits for the winner's
 * marker and never deletes a dir another process may still be priming.
 */
export async function warmTemplate(
  cacheRoot: string,
  brand: BrandValues,
  log: (line: string) => void = () => {},
  opts: { pnpm?: string; waitMs?: number } = {},
): Promise<string> {
  const dir = join(cacheRoot, TEMPLATE_VERSION);
  if (isWarm(dir)) return dir;
  await mkdir(cacheRoot, { recursive: true });
  const tmp = join(cacheRoot, `${TEMPLATE_VERSION}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    await copyRendered(tmp, brand, null);
    const pnpm = opts.pnpm ?? "pnpm";
    const base = ["install", "--ignore-workspace", "--config.confirmModulesPurge=false", "--reporter=silent"];
    log("Installing the template's packages (once)");
    let r = await run(pnpm, [...base, "--offline"], tmp, log);
    if (r.code !== 0) {
      log("Offline install missed some packages, trying the registry");
      r = await run(pnpm, [...base, "--prefer-offline"], tmp, log);
    }
    if (r.code !== 0) throw new Error(`Could not install the template's packages: ${r.tail.trim().split("\n").slice(-3).join(" ")}`);
    await writeFile(join(tmp, FILES_MARKER), `${JSON.stringify(scanForProjectTokens(tmp))}\n`);
    await writeFile(join(tmp, NATIVES_MARKER), `${JSON.stringify(findNatives(tmp))}\n`);

    const waitMs = opts.waitMs ?? 120_000;
    for (let attempt = 0; ; attempt++) {
      if (isWarm(dir)) return dir;
      if (existsSync(dir)) {
        // Another warm renamed its copy in and is priming natives; its marker
        // comes in seconds. A marker over missing files is a broken leftover.
        const broken = existsSync(join(dir, READY_MARKER));
        const until = Date.now() + (broken ? 0 : waitMs);
        while (!isWarm(dir) && existsSync(dir) && Date.now() < until) await sleep(250);
        if (isWarm(dir)) return dir;
        if (existsSync(dir)) {
          // Stale: move it aside in one step (a rename), then delete the copy.
          const stale = join(cacheRoot, `${TEMPLATE_VERSION}.stale-${process.pid}-${Date.now()}`);
          await rename(dir, stale).catch(() => {});
          await rm(stale, { recursive: true, force: true }).catch(() => {});
        }
      }
      try {
        await rename(tmp, dir);
        break;
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if ((code !== "ENOTEMPTY" && code !== "EEXIST") || attempt >= 3) throw e;
      }
    }
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
  await primeNatives(dir);
  await writeFile(join(dir, READY_MARKER), `${new Date().toISOString()}\n`);
  return dir;
}

// Native binaries (workerd, esbuild, *.node). macOS scans an executable the
// first time it runs from a new path, about 1 to 3 s each, which made a fresh
// project's first dev server start take 8 to 11 s. Projects therefore link
// these files to the warm cache's copies (symlinks: the scan is per path, so a
// hard link does not help), and the warm step runs each one once.

function findNatives(dir: string): string[] {
  const store = join(dir, "node_modules", ".pnpm");
  if (!existsSync(store)) return [];
  const out: string[] = [];
  const walk = (d: string, depth: number) => {
    if (depth > 8) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const abs = join(d, e.name);
      if (e.isDirectory()) walk(abs, depth + 1);
      else if (e.isFile() && (e.name.endsWith(".node") || (/[/\\]bin[/\\](workerd|esbuild)$/.test(abs) && !/[/\\]esbuild[/\\]bin[/\\]esbuild$/.test(abs))))
        out.push(relative(dir, abs).split(sep).join("/"));
    }
  };
  walk(store, 0);
  return out.sort();
}

async function primeNatives(dir: string): Promise<void> {
  const list = JSON.parse(await readFile(join(dir, NATIVES_MARKER), "utf8")) as string[];
  await Promise.all(
    list.map((f) => {
      const abs = join(dir, f);
      if (f.endsWith(".node")) {
        const code = `try{process.dlopen({exports:{}},${JSON.stringify(abs)})}catch{}`;
        return run(process.execPath, ["-e", code], dir, () => {});
      }
      return run(abs, ["--version"], dir, () => {});
    }),
  );
}

/**
 * Copies a warm cache dir to a new project: an APFS clone (`cp -cR`) where
 * possible, a plain copy otherwise, then links the native binaries back to
 * the cache (see findNatives). Follow with applyProjectVars.
 */
export async function cloneTemplate(cacheDir: string, dest: string): Promise<{ method: "clone" | "copy"; ms: number }> {
  const t = Date.now();
  await mkdir(dirname(dest), { recursive: true });
  let method: "clone" | "copy" = "clone";
  const args = process.platform === "darwin" ? ["-cR", cacheDir, dest] : ["-a", "--reflink=auto", cacheDir, dest];
  let r = await run("cp", args, dirname(dest), () => {});
  if (r.code !== 0) {
    await rm(dest, { recursive: true, force: true });
    method = "copy";
    r = await run("cp", ["-R", cacheDir, dest], dirname(dest), () => {});
    if (r.code !== 0) throw new Error(`Could not copy the template: ${r.tail.trim()}`);
  }
  const nativesFile = join(cacheDir, NATIVES_MARKER);
  if (existsSync(nativesFile)) {
    const list = JSON.parse(await readFile(nativesFile, "utf8")) as string[];
    for (const f of list) {
      const target = join(dest, f);
      await rm(target, { force: true });
      await symlink(join(cacheDir, f), target);
    }
  }
  return { method, ms: Date.now() - t };
}

// ---- pruning ---------------------------------------------------------------
//
// Every template change is a new version dir of about 550 MB, and old ones
// piled up (16 versions, 8.8 GB on one machine). Pruning keeps the current
// version and the newest other warm one (a process still running older code
// clones from it) and deletes the rest. It never runs while a warm is in
// progress: a warm's lock is its `<version>.tmp-<pid>-*` dir (the warm builds
// there and claims the version name with one rename), so a tmp dir whose pid
// is alive means hands off the whole cache. A version dir without the ready
// marker is skipped while it is young (another process renamed it in and is
// priming natives) and treated as a broken leftover once old.
//
// Projects link their native binaries back into the version they were cloned
// from (cloneTemplate). Before a version goes, each such link in the given
// project dirs is replaced by a copy (an APFS clone where possible), so an
// older project keeps running.

const WARM_TMP = /^(.+)\.(tmp|stale)-(\d+)-/;
/** A version dir without its marker younger than this may still be priming. */
const PRIMING_GRACE_MS = 10 * 60_000;

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export interface PruneResult {
  /** Version (and leftover tmp) dirs deleted. */
  removed: string[];
  /** Versions kept (current first). */
  kept: string[];
  /** Native links in projects turned into copies before their version went. */
  relinked: number;
  /** Why nothing was pruned, when nothing was. */
  skipped: string | null;
}

/** Live warms in this cache: tmp dirs whose process is still running. */
export function warmsInProgress(cacheRoot: string): string[] {
  if (!existsSync(cacheRoot)) return [];
  return readdirSync(cacheRoot).filter((n) => {
    const m = WARM_TMP.exec(n);
    return !!m && m[2] === "tmp" && pidAlive(Number(m[3]));
  });
}

/** Replace links from `projectDir` into `versionDir` (its natives) with copies. */
async function materializeNatives(versionDir: string, projectDir: string): Promise<number> {
  const nativesFile = join(versionDir, NATIVES_MARKER);
  if (!existsSync(nativesFile)) return 0;
  let list: string[];
  try {
    list = JSON.parse(readFileSync(nativesFile, "utf8")) as string[];
  } catch {
    return 0;
  }
  let real = versionDir;
  try {
    real = realpathSync(versionDir);
  } catch {
    /* gone */
  }
  let n = 0;
  for (const f of list) {
    const at = join(projectDir, f);
    try {
      if (!lstatSync(at).isSymbolicLink()) continue;
      const target = readlinkSync(at);
      // The link names the cache the project was cloned through (a scratch home's is a symlink).
      const ours = target.startsWith(`${versionDir}/`) || realpathSync(target).startsWith(`${real}/`);
      if (!ours) continue;
      const tmp = `${at}.prune-${process.pid}`;
      await copyFile(target, tmp, fsConstants.COPYFILE_FICLONE);
      await chmod(tmp, statSync(target).mode & 0o7777);
      await rename(tmp, at);
      n++;
    } catch {
      /* not there, or not ours */
    }
  }
  return n;
}

export async function pruneTemplateCache(
  cacheRoot: string,
  o: { current?: string; projectDirs?: string[]; log?: (line: string) => void; now?: number } = {},
): Promise<PruneResult> {
  const current = o.current ?? TEMPLATE_VERSION;
  const log = o.log ?? (() => {});
  const now = o.now ?? Date.now();
  const res: PruneResult = { removed: [], kept: [current], relinked: 0, skipped: null };
  if (!existsSync(cacheRoot)) return { ...res, skipped: "no cache yet" };
  const live = warmsInProgress(cacheRoot);
  if (live.length) return { ...res, skipped: `a warm is in progress (${live[0]})` };
  const names = readdirSync(cacheRoot);
  const doomed: string[] = [];
  const others: { name: string; at: number }[] = [];
  for (const name of names) {
    if (name === current || name.startsWith(".")) continue;
    const abs = join(cacheRoot, name);
    let st;
    try {
      st = lstatSync(abs);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    const m = WARM_TMP.exec(name);
    if (m) {
      // A dead warm's tmp, or a stale copy its mover died before deleting.
      if (!pidAlive(Number(m[3]))) doomed.push(name);
      continue;
    }
    if (isWarm(abs)) {
      const at = statSync(join(abs, READY_MARKER)).mtimeMs;
      others.push({ name, at });
    } else if (now - st.mtimeMs > PRIMING_GRACE_MS) doomed.push(name);
  }
  others.sort((a, b) => b.at - a.at);
  if (others[0]) res.kept.push(others[0].name);
  doomed.push(...others.slice(1).map((x) => x.name));
  for (const name of doomed) {
    // Check again right before each delete: a warm may have started since.
    if (warmsInProgress(cacheRoot).length) {
      res.skipped = "a warm started while pruning";
      break;
    }
    const abs = join(cacheRoot, name);
    for (const d of o.projectDirs ?? []) res.relinked += await materializeNatives(abs, d);
    // Move aside in one rename, then delete: a reader never sees a half-deleted version.
    const gone = join(cacheRoot, `.pruning-${name}-${process.pid}`);
    try {
      await rename(abs, gone);
    } catch {
      continue;
    }
    await rm(gone, { recursive: true, force: true }).catch(() => {});
    res.removed.push(name);
  }
  // A crashed prune's leftovers.
  for (const name of readdirSync(cacheRoot)) {
    const m = /^\.pruning-.+-(\d+)$/.exec(name);
    if (m && !pidAlive(Number(m[1]))) await rm(join(cacheRoot, name), { recursive: true, force: true }).catch(() => {});
  }
  if (res.removed.length) log(`Template cache: removed ${res.removed.length} old version${res.removed.length === 1 ? "" : "s"}, kept ${res.kept.join(" and ")}${res.relinked ? ` (${res.relinked} project links copied first)` : ""}`);
  return res;
}

/** Size of the template cache in bytes (`du`, which counts each clone in full, as Finder does). */
export function templateCacheSize(cacheRoot: string): Promise<{ bytes: number; versions: number }> {
  return new Promise((done) => {
    if (!existsSync(cacheRoot)) return done({ bytes: 0, versions: 0 });
    const versions = readdirSync(cacheRoot).filter((n) => !n.startsWith(".") && !WARM_TMP.test(n)).length;
    const child = spawn("du", ["-sk", cacheRoot], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("error", () => done({ bytes: 0, versions }));
    child.on("close", () => done({ bytes: (Number(out.trim().split(/\s+/)[0]) || 0) * 1024, versions }));
  });
}
