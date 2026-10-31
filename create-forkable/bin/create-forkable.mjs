#!/usr/bin/env node
// npm create forkable@latest <name> [--for "<who>"] [--in "<where>"] [--template <id>]
//
// Copies a template (the forkable-starter by default), fills in
// local/profile.md, makes a fresh git history, installs, and runs the
// keyless demo. No account and no keys needed for any of that.
//
// Agent mode: --list [--json] prints the catalog, --json prints one result
// object on stdout (everything else goes to stderr). It never prompts.
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");
const isWin = process.platform === "win32";
const npmCmd = isWin ? "npm.cmd" : "npm";
const pnpmCmd = isWin ? "pnpm.cmd" : "pnpm";
const corepackCmd = isWin ? "corepack.cmd" : "corepack";
const CATALOG_URL = "https://forkable.dev/templates.json";
const CATALOG_TIMEOUT_MS = 6000;
const DEFAULT_TEMPLATE = "forkable-starter";

const cliVersion = (() => {
  try {
    return JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

// ---- output ---------------------------------------------------------------

// In JSON mode stdout carries exactly one JSON object; every human line goes
// to stderr. Decided once, before anything prints.
let jsonMode = false;
// A closed pipe (`| head`) is not a failure; keep going and finish the fork.
for (const stream of [process.stdout, process.stderr]) stream.on("error", () => {});
const say = (line = "") => (jsonMode ? process.stderr : process.stdout).write(`${line}\n`);
const warn = (line = "") => process.stderr.write(`${line}\n`);

class CliError extends Error {
  constructor(code, message, { exitCode = 1, fix = null, extra = {} } = {}) {
    super(message);
    this.code = code;
    this.exitCode = exitCode;
    this.fix = fix;
    this.extra = extra;
  }
}

function emitJson(obj) {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
}

// JSON mode is on with --json, off with --no-json. Otherwise it turns on by
// itself only when nobody is at a keyboard: stdin is not a TTY AND (CI is set
// or stdout is not a TTY). A person piping output to a log still has a TTY on
// stdin, so they keep the human output.
function detectJsonMode(argv) {
  if (argv.includes("--no-json")) return false;
  if (argv.includes("--json")) return true;
  const ci = Boolean(process.env.CI) && process.env.CI !== "false" && process.env.CI !== "0";
  return !process.stdin.isTTY && (ci || !process.stdout.isTTY);
}

// ---- catalog --------------------------------------------------------------

function bundledTemplateIds() {
  try {
    return readdirSync(join(packageRoot, "templates"), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

function readBundledCatalog() {
  try {
    return JSON.parse(readFileSync(join(packageRoot, "catalog.json"), "utf8"));
  } catch {
    return { version: 1, templates: [] };
  }
}

function isCatalog(value) {
  return value && typeof value === "object" && Array.isArray(value.templates) && value.templates.every((t) => t && typeof t.id === "string");
}

// The live list at forkable.dev first (short timeout), the copy bundled in
// this package when offline or when the site has no list yet.
async function loadCatalog() {
  if (typeof fetch === "function" && !process.env.FORKABLE_OFFLINE) {
    try {
      const res = await fetch(process.env.FORKABLE_CATALOG_URL || CATALOG_URL, {
        signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
        headers: { accept: "application/json", "user-agent": `create-forkable/${cliVersion}` },
      });
      if (res.ok) {
        const body = await res.json();
        if (isCatalog(body)) return { catalog: body, source: "remote" };
      }
    } catch {
      // Offline, timed out or not JSON: use the bundled copy.
    }
  }
  return { catalog: readBundledCatalog(), source: "bundled" };
}

function availableIds(catalog) {
  const bundled = new Set(bundledTemplateIds());
  const listed = catalog.templates.filter((t) => t.status === "available" && bundled.has(t.id)).map((t) => t.id);
  // A bundled template the catalog forgot about can still be forked.
  const unlisted = [...bundled].filter((id) => !catalog.templates.some((t) => t.id === id));
  return [...listed, ...unlisted];
}

function printCatalogTable(catalog, source) {
  const bundled = new Set(bundledTemplateIds());
  const rows = catalog.templates.map((t) => [
    t.id,
    t.name ?? t.id,
    t.status === "available" && !bundled.has(t.id) ? "needs a newer create-forkable" : t.status ?? "",
    t.kind ?? "",
    t.packageManager ?? "",
  ]);
  const head = ["ID", "NAME", "STATUS", "KIND", "PM"];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (cells) => `  ${cells.map((c, i) => String(c).padEnd(widths[i])).join("   ")}`.trimEnd();
  say(line(head));
  rows.forEach((r) => say(line(r)));
  say("");
  say(`  Fork one:  npm create forkable@latest <dir> -- --template <id>`);
  say(`  Catalog:   ${source === "remote" ? process.env.FORKABLE_CATALOG_URL || CATALOG_URL : "bundled with create-forkable " + cliVersion + " (no live list from forkable.dev)"}`);
}

// ---- help -----------------------------------------------------------------

function printHelp() {
  say(`Usage: npm create forkable@latest <name> [options]
       npm create forkable@latest -- --list [--json]

  <name>              Directory and project name for the new fork.

Options:
  --for <who>         Who this fork is for, e.g. "real estate agents".
  --in <where>        Where, e.g. "Los Angeles". Written into local/profile.md.
  --template <id>     Template to copy. Default: forkable-starter.
                      A name that matches a template id (rill, search) picks it.
  --list              Print the template catalog and exit.
  --json              Machine output: one JSON object on stdout, all other
                      output on stderr. Errors are JSON too (ok: false, code).
  --no-json           Force human output.
  --no-install        Copy and commit only. Skips install and the demo.
  --no-demo           Install, but do not run the keyless demo.
  -y, --yes           Never prompt. create-forkable has no prompts, so this
                      is accepted for scripts and agents and changes nothing.
  -v, --version       Print the create-forkable version.
  -h, --help          Show this help.

JSON mode turns on by itself when stdin is not a TTY and either CI is set
or stdout is not a TTY. A person piping to a log keeps human output.

Error codes (JSON "code", exit status 1 unless noted): USAGE (2),
NAME_MISSING (2), DIR_EXISTS, UNKNOWN_TEMPLATE, TEMPLATE_COMING_SOON,
TEMPLATE_NOT_BUNDLED, PNPM_MISSING, INSTALL_FAILED, DEMO_FAILED (the
demo's own status), INTERNAL. An existing target directory is never
overwritten.

Templates in this package: ${bundledTemplateIds().join(", ")}

Examples:
  npm create forkable@latest rill -- --for "real estate agents" --in "Los Angeles"
  npm create forkable@latest my-inbox -- --template rill --json --yes`);
}

// ---- args -----------------------------------------------------------------

function slugify(input) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "forkable-app";
}

function parseArgs(argv) {
  const out = {
    name: null,
    for: null,
    in: null,
    template: DEFAULT_TEMPLATE,
    templateExplicit: false,
    list: false,
    help: false,
    version: false,
    install: true,
    demo: true,
  };
  const value = (i, flag) => {
    const v = argv[i];
    if (v === undefined || v.startsWith("--")) throw new CliError("USAGE", `${flag} needs a value.`, { exitCode: 2 });
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    // npx and pnpm create pass a bare "--" through; npm create strips it.
    if (a === "--") continue;
    if (a === "-h" || a === "--help") out.help = true;
    else if (a === "-v" || a === "--version") out.version = true;
    else if (a === "--for") out.for = value(++i, a);
    else if (a === "--in") out.in = value(++i, a);
    else if (a === "--template" || a === "-t") {
      out.template = value(++i, a);
      out.templateExplicit = true;
    } else if (a === "--list") out.list = true;
    else if (a === "--json" || a === "--no-json" || a === "--yes" || a === "-y") {
      // --json/--no-json were read before parsing; --yes is a no-op.
    } else if (a === "--no-install") out.install = false;
    else if (a === "--no-demo") out.demo = false;
    else if (!a.startsWith("-") && !out.name) out.name = a;
    else throw new CliError("USAGE", `unknown argument "${a}". Run with --help for the options.`, { exitCode: 2 });
  }
  if (!out.install) out.demo = false;
  return out;
}

// ---- processes ------------------------------------------------------------

// Children inherit the terminal in human mode. In JSON mode their stdout
// goes to our stderr, so stdout stays a single JSON object.
function run(command, args, options = {}) {
  const stdio = jsonMode ? ["ignore", 2, 2] : "inherit";
  const result = spawnSync(command, args, { stdio, ...options });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function works(command, args) {
  const result = spawnSync(command, args, {
    stdio: "ignore",
    timeout: 60_000,
    env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" },
  });
  return !result.error && result.status === 0;
}

// pnpm on PATH, else corepack's pnpm, else null.
function findPnpm() {
  if (works(pnpmCmd, ["--version"])) return { cmd: pnpmCmd, pre: [], label: "pnpm" };
  if (works(corepackCmd, ["--version"]) && works(corepackCmd, ["pnpm", "--version"])) {
    return { cmd: corepackCmd, pre: ["pnpm"], label: "corepack pnpm" };
  }
  return null;
}

// Template scripts call `pnpm` by name (Rill's start runs `pnpm --filter`).
// When only corepack's pnpm exists, put a tiny `pnpm` shim that forwards to
// it on PATH for the child processes, so those nested calls work too.
function corepackShimDir() {
  const dir = mkdtempSync(join(tmpdir(), "create-forkable-pnpm-"));
  if (isWin) {
    writeFileSync(join(dir, "pnpm.cmd"), "@corepack pnpm %*\r\n");
  } else {
    const shim = join(dir, "pnpm");
    writeFileSync(shim, '#!/bin/sh\nexec corepack pnpm "$@"\n');
    chmodSync(shim, 0o755);
  }
  return dir;
}

const PNPM_FIX = "Install pnpm, then rerun: `npm install -g pnpm` (or `corepack enable pnpm`). See https://pnpm.io/installation";

function fillPlaceholders(content, values) {
  let out = content;
  for (const [key, value] of Object.entries(values)) {
    out = out.replaceAll(`{{${key}}}`, value);
  }
  return out;
}

function readWelcome(targetDir) {
  try {
    const { welcome } = JSON.parse(readFileSync(join(targetDir, "forkable.json"), "utf8"));
    if (typeof welcome !== "string") return null;
    const file = resolve(targetDir, welcome);
    return file.startsWith(targetDir) && existsSync(file) ? file : null;
  } catch {
    return null;
  }
}

// ---- fork -----------------------------------------------------------------

async function fork(args, state) {
  const slug = slugify(args.name);
  const targetDir = resolve(process.cwd(), slug);
  state.dir = targetDir;

  const catalog = readBundledCatalog();
  const bundled = bundledTemplateIds();

  // No --template given, but the name matches a real template id (e.g.
  // `npm create forkable rill`): fork that business instead of the base
  // starter. An explicit --template always wins.
  if (!args.templateExplicit && bundled.includes(slug) && availableIds(catalog).includes(slug)) {
    args.template = slug;
  }
  state.template = args.template;

  const entry = catalog.templates.find((t) => t.id === args.template);
  if (entry && entry.status !== "available") {
    throw new CliError("TEMPLATE_COMING_SOON", `"${args.template}" (${entry.name ?? args.template}) is ${entry.status ?? "not available"}, so it cannot be forked yet. Available: ${availableIds(catalog).join(", ")}.`, {
      fix: "Pick an available template (npm create forkable@latest -- --list), or watch https://forkable.dev.",
    });
  }
  if (!bundled.includes(args.template)) {
    if (entry) {
      throw new CliError("TEMPLATE_NOT_BUNDLED", `"${args.template}" is listed but not in create-forkable ${cliVersion}.`, {
        fix: "Run the latest version: npm create forkable@latest ...",
      });
    }
    throw new CliError("UNKNOWN_TEMPLATE", `no template named "${args.template}". Available: ${availableIds(catalog).join(", ")}.`, {
      fix: "List them with: npm create forkable@latest -- --list",
    });
  }

  if (existsSync(targetDir)) {
    throw new CliError("DIR_EXISTS", `${targetDir} already exists. Pick a different name or remove it first.`, {
      fix: "Use a new <name>. create-forkable never overwrites a directory.",
    });
  }

  const templateDir = join(packageRoot, "templates", args.template);
  const usesPnpmWorkspace = existsSync(join(templateDir, "pnpm-workspace.yaml"));
  state.packageManager = usesPnpmWorkspace ? "pnpm" : "npm";

  // A pnpm workspace template cannot be installed with npm (no
  // pnpm-workspace.yaml support, no workspace:* protocol). Find pnpm, or
  // corepack's, before copying anything, so a missing pnpm leaves no
  // half-made fork behind.
  let pm = { cmd: npmCmd, pre: [], label: "npm" };
  if (usesPnpmWorkspace) {
    const found = findPnpm();
    if (found) pm = found;
    else if (args.install) {
      throw new CliError("PNPM_MISSING", `the "${args.template}" template needs pnpm. pnpm was not found and \`corepack pnpm\` did not work either.`, { fix: PNPM_FIX });
    } else {
      pm = { cmd: pnpmCmd, pre: [], label: "pnpm" };
      state.warnings.push(`pnpm was not found. ${PNPM_FIX}`);
    }
  }
  state.packageManagerCommand = pm.label;

  say(`Forking ${args.template} into ./${slug}\n`);
  mkdirSync(targetDir, { recursive: true });
  cpSync(templateDir, targetDir, { recursive: true });
  const agentsMd = join(targetDir, "AGENTS.md");
  state.agentsMd = existsSync(agentsMd) ? agentsMd : null;
  state.envNeededToGoLive = Array.isArray(entry?.envToGoLive) ? entry.envToGoLive : [];

  // package.json: rename.
  const pkgPath = join(targetDir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.name = slug;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

  // forkable.json: rename, and record lineage.
  const forkableJsonPath = join(targetDir, "forkable.json");
  let starterVersion = "0.0.0";
  if (existsSync(forkableJsonPath)) {
    const forkableJson = JSON.parse(readFileSync(forkableJsonPath, "utf8"));
    starterVersion = forkableJson.starter ?? starterVersion;
    forkableJson.name = slug;
    forkableJson.forkedFrom = `${args.template}@${starterVersion}`;
    writeFileSync(forkableJsonPath, `${JSON.stringify(forkableJson, null, 2)}\n`);
  }
  state.version = starterVersion;

  // local/profile.md: fill in who this fork is for, and where.
  const profilePath = join(targetDir, "local", "profile.md");
  if (existsSync(profilePath)) {
    // Fill only what was given. An unset field keeps its {{FOR}} / {{IN}}
    // placeholder for the owner, a coding agent or a GTM skill to fill later.
    const values = {};
    if (args.for) values.FOR = args.for;
    if (args.in) values.IN = args.in;
    writeFileSync(profilePath, fillPlaceholders(readFileSync(profilePath, "utf8"), values));
  }

  // A fresh git history, so a fork never carries the starter's own commits.
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME ?? "Forkable",
    GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL ?? "noreply@forkable.dev",
    GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME ?? "Forkable",
    GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL ?? "noreply@forkable.dev",
  };
  try {
    const ok =
      run("git", ["init", "-q"], { cwd: targetDir }) === 0 &&
      run("git", ["add", "-A"], { cwd: targetDir }) === 0 &&
      run("git", ["commit", "-q", "-m", `Forked from ${args.template}@${starterVersion}`], { cwd: targetDir, env: gitEnv }) === 0;
    state.git = ok;
    if (!ok) state.warnings.push("git could not make the first commit. The files are all there.");
  } catch {
    state.git = false;
    state.warnings.push("git was not found, so the fork has no git history yet. Run `git init` in it later.");
  }

  const childEnv = { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" };
  if (pm.label === "corepack pnpm") {
    childEnv.PATH = `${corepackShimDir()}${delimiter}${process.env.PATH ?? ""}`;
    state.warnings.push("pnpm is not on PATH, so this used `corepack pnpm`. Run `corepack enable pnpm` (or `npm install -g pnpm`) so the fork's own scripts find pnpm.");
  }
  const pmRun = (args2, options) => run(pm.cmd, [...pm.pre, ...args2], { cwd: targetDir, ...options, env: { ...childEnv, ...(options?.env ?? {}) } });

  if (args.install) {
    say(`\nInstalling dependencies with ${pm.label}...\n`);
    let installStatus;
    try {
      installStatus = pmRun(["install"]);
    } catch (e) {
      if (e && e.code === "ENOENT") {
        throw new CliError(usesPnpmWorkspace ? "PNPM_MISSING" : "INSTALL_FAILED", `${pm.label} was not found. The fork is at ${targetDir}.`, {
          fix: usesPnpmWorkspace ? PNPM_FIX : "Install Node.js with npm, then run `npm install` in the fork.",
        });
      }
      throw e;
    }
    if (installStatus !== 0) {
      throw new CliError("INSTALL_FAILED", `${pm.label} install exited ${installStatus}. The fork is still at ${targetDir}.`, {
        exitCode: installStatus,
        fix: `Fix the install error above, then run \`${pm.label} install && ${pm.label} start\` in ${targetDir}.`,
      });
    }
    state.installed = true;
  }

  if (args.demo) {
    say("\nRunning the keyless demo...\n");
    const demoStatus = pmRun(["start"], { env: { FORKABLE_CREATE: "1" } });
    state.demoExitCode = demoStatus;
    if (demoStatus !== 0) {
      throw new CliError("DEMO_FAILED", `the demo exited ${demoStatus}. The fork is still at ${targetDir}; see its README.`, {
        exitCode: demoStatus,
        fix: `Run \`${pm.label} start\` in ${targetDir} to see the failure.`,
      });
    }
  }

  // Each template prints its own next steps (forkable.json "welcome": a
  // dependency-free Node script). Templates without one get the generic
  // list. In JSON mode the welcome still prints, but to stderr.
  const welcome = readWelcome(targetDir);
  if (welcome) state.welcome = welcome;
  let welcomed = false;
  if (welcome) {
    try {
      welcomed = run(process.execPath, [welcome, "--dir", slug, "--pm", pm.label], { cwd: targetDir, env: childEnv }) === 0;
    } catch {
      welcomed = false;
    }
  }
  if (!welcomed) printNextSteps(slug, pm.label, args);
  else if (!args.install) say(`  Skipped by --no-install. Run \`cd ${slug} && ${pm.label} install\` first.\n`);

  state.nextSteps = nextSteps(targetDir, pm.label, args, state);
  if (state.agentsMd) {
    state.next = `Read ${state.agentsMd} now, before you change, run or answer anything else. It holds this fork's rules: where secrets go, what needs the human's OK, how going live works.`;
    say(`Coding agent? Read ./${slug}/AGENTS.md before anything else.\n`);
  }
  state.ok = true;
}

function nextSteps(dir, pm, args, state) {
  const steps = [];
  if (state.agentsMd) steps.push({ read: state.agentsMd, why: "The rules this repo runs on. Read before changing code." });
  if (pm === "corepack pnpm") steps.push({ run: "corepack enable pnpm", why: "Put pnpm on PATH. The fork's scripts call pnpm by name. If that needs admin rights, use `npm install -g pnpm`." });
  if (!args.install) steps.push({ run: `cd ${dir} && ${pm} install`, why: "Install dependencies (skipped by --no-install)." });
  if (!args.demo) steps.push({ run: `cd ${dir} && ${pm} start`, why: "Run the keyless Acme Inc demo. Success is exit code 0." });
  else steps.push({ run: `cd ${dir} && ${pm} start`, why: "Run the keyless demo again. It exits 0 with no account and no keys." });
  if (existsSync(join(dir, "local", "profile.md"))) steps.push({ edit: join(dir, "local", "profile.md"), why: "Who this fork is for, and where." });
  steps.push({ read: join(dir, "README.md"), why: "Going live needs one Connect app made in the One dashboard by a person. Ask them; never ask for, copy or write a secret yourself." });
  return steps;
}

function printNextSteps(slug, pm, args) {
  const rows = [];
  if (!args.install) rows.push([`cd ${slug} && ${pm} install`, "install dependencies"]);
  rows.push([`cd ${slug} && ${pm} start`, args.demo ? "run the keyless demo again" : "run the keyless demo"]);
  rows.push(["local/profile.md", "who this fork is for, and where"]);
  rows.push(["AGENTS.md", "point your coding agent here before changing code"]);
  rows.push(["README.md", "make a Connect app, then turn on Sign in with One"]);
  const width = Math.max(...rows.map(([a]) => a.length)) + 2;
  say(`\n./${slug} is ready.\n`);
  rows.forEach(([a, b], i) => say(`  ${i + 1}  ${a.padEnd(width)}${b}`));
  say("");
}

// ---- main -----------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  jsonMode = detectJsonMode(argv);

  const state = {
    ok: false,
    next: null,
    dir: null,
    template: null,
    version: null,
    cliVersion,
    packageManager: null,
    packageManagerCommand: null,
    installed: false,
    demoExitCode: null,
    git: null,
    nextSteps: [],
    envNeededToGoLive: [],
    agentsMd: null,
    warnings: [],
  };

  let args;
  try {
    args = parseArgs(argv);
    if (args.help) {
      printHelp();
      return 0;
    }
    if (args.version) {
      if (jsonMode) emitJson({ ok: true, cliVersion });
      else say(cliVersion);
      return 0;
    }
    if (args.list) {
      const { catalog, source } = await loadCatalog();
      if (jsonMode) emitJson({ ...catalog, source, forkable: availableIds(catalog) });
      else printCatalogTable(catalog, source);
      return 0;
    }
    if (!args.name) {
      if (!jsonMode) printHelp();
      throw new CliError("NAME_MISSING", "give the fork a name: npm create forkable@latest <name>", { exitCode: 2, fix: "npm create forkable@latest my-business" });
    }
    await fork(args, state);
    for (const w of state.warnings) warn(`create-forkable: ${w}`);
    if (jsonMode) emitJson(state);
    return 0;
  } catch (e) {
    const err = e instanceof CliError ? e : new CliError("INTERNAL", e?.message ?? String(e));
    for (const w of state.warnings) warn(`create-forkable: ${w}`);
    warn(`\ncreate-forkable: ${err.message}`);
    if (err.fix) warn(`  ${err.fix}`);
    if (jsonMode) {
      emitJson({ ...state, ok: false, code: err.code, error: { code: err.code, message: err.message, fix: err.fix } });
    }
    return err.exitCode || 1;
  }
}

process.exitCode = await main();
