#!/usr/bin/env node
// forkable: add Forkable blocks to a fork.
//
//   npx @withone/forkable add <block...>   copy blocks in, with what they require
//   npx @withone/forkable list             what the registry has
//
// A block is three things: its React UI, its Hono route, and the One actions
// it calls. `add` copies the files, rewrites their relative imports for where
// they land, merges the actions into connect.manifest.json, regenerates
// mountForkable() so one call mounts every route, wires the token fallbacks
// into your CSS, and installs any npm package your fork is missing.
// No dependencies; Node 20+.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, posix } from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_REGISTRY = "https://forkable.dev/blocks/r";
const UI_DEFAULT = "ui/src/components/forkable";
const SERVER_DEFAULT = "server/src/routes/forkable";
const NO_COLOR = !!process.env.NO_COLOR || !process.stdout.isTTY;
const c = (code) => (s) => (NO_COLOR ? s : `\x1b[${code}m${s}\x1b[0m`);
const dim = c(2), bold = c(1), green = c(32), yellow = c(33), red = c(31);

const NEEDS = {
  ui: ["react", "lucide-react", "clsx"],
  uiAuth: ["@withone/connect"],
  server: ["hono", "@withone/connect"],
  serverAuth: ["@hono/node-server"],
};

function parseArgs(argv) {
  const out = { _: [], registry: process.env.FORKABLE_REGISTRY || DEFAULT_REGISTRY, cwd: process.cwd(), install: true, overwrite: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--registry") out.registry = argv[++i];
    else if (a === "--cwd" || a === "--to") out.cwd = resolve(argv[++i]);
    else if (a === "--no-install") out.install = false;
    else if (a === "--overwrite" || a === "-o") out.overwrite = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--with-ui") out.withUi = true;
    else if (a === "-h" || a === "--help") out.help = true;
    else out._.push(a);
  }
  return out;
}

const HELP = `${bold("forkable")} adds Forkable blocks to your fork.

  ${bold("npx @withone/forkable add")} <block...>   UI, route and access, in one go
  ${bold("npx @withone/forkable list")}             every block in the registry

Options
  --cwd <dir>        the fork (default: this directory)
  --registry <url>   where blocks come from (default: ${DEFAULT_REGISTRY})
                     a folder path works too
  --overwrite        replace files you already have
  --no-install       do not install missing npm packages
  --with-ui          add the React components even if the fork has no React
  --dry-run          show what would change, write nothing

Browse them at https://forkable.dev/blocks`;

// ---- registry ---------------------------------------------------------------

async function fetchJson(registry, file) {
  if (/^https?:/.test(registry)) {
    const res = await fetch(`${registry.replace(/\/$/, "")}/${file}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${registry}/${file} answered ${res.status}`);
    return res.json();
  }
  const p = join(resolve(registry), file);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}

async function resolveBlocks(registry, names) {
  const got = new Map();
  const order = [];
  async function visit(name, chain) {
    if (got.has(name)) return;
    const item = await fetchJson(registry, `${name}.json`);
    if (!item) {
      const index = (await fetchJson(registry, "index.json")) ?? [];
      const known = index.filter((b) => b.kind !== "lib").map((b) => b.name);
      throw new Error(`No block named "${name}"${chain.length ? ` (needed by ${chain.at(-1)})` : ""}.${known.length ? `\nTry one of: ${known.join(", ")}` : ""}`);
    }
    got.set(name, item);
    for (const r of item.requires ?? []) await visit(r, [...chain, name]);
    order.push(item);
  }
  for (const n of names) await visit(n, []);
  return order;
}

// ---- the fork ---------------------------------------------------------------

function findRoot(start) {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, "forkable.json")) || existsSync(join(dir, "connect.manifest.json"))) return dir;
    const up = dirname(dir);
    if (up === dir) return start;
    dir = up;
  }
}

function layout(root) {
  const cfg = existsSync(join(root, "forkable.json")) ? JSON.parse(readFileSync(join(root, "forkable.json"), "utf8")) : {};
  const ui = cfg.blocks?.ui ?? (existsSync(join(root, "ui/src")) ? UI_DEFAULT : existsSync(join(root, "src")) ? "src/components/forkable" : UI_DEFAULT);
  const server = cfg.blocks?.server ?? (existsSync(join(root, "server/src")) ? SERVER_DEFAULT : existsSync(join(root, "src")) ? "src/routes/forkable" : SERVER_DEFAULT);
  return { ui, server };
}

/** registry target path -> this fork's path */
function place(to, lay) {
  if (to.startsWith(UI_DEFAULT)) return lay.ui + to.slice(UI_DEFAULT.length);
  if (to.startsWith(SERVER_DEFAULT)) return lay.server + to.slice(SERVER_DEFAULT.length);
  return to;
}

const isUi = (p, lay) => p.startsWith(lay.ui);
const stripExt = (p) => p.replace(/\.(tsx?|jsx?|mjs)$/, "");

/** Rewrites "./x" and "../y" imports from where a file sat in the registry to where it lands. */
function rewriteImports(code, fromRegistry, landedAt, placed, lay) {
  return code.replace(/(from\s+|import\(\s*)(["'])(\.{1,2}\/[^"']+)\2/g, (whole, lead, q, spec) => {
    const target = posix.normalize(posix.join(posix.dirname(fromRegistry), spec));
    const key = target.endsWith(".json") || target.endsWith(".css") ? target : stripExt(target);
    const hit = placed.get(key);
    if (!hit) return whole;
    const dest = (isUi(landedAt, lay) ? hit.ui : hit.server) ?? hit.ui ?? hit.server;
    let rel = posix.relative(posix.dirname(landedAt), dest);
    if (!rel.startsWith(".")) rel = `./${rel}`;
    // keep the import's own extension style: ".js" stays, none stays none
    const ext = spec.match(/\.(js|json|css)$/)?.[0] ?? "";
    rel = ext === ".json" || ext === ".css" ? rel : stripExt(rel) + ext;
    return `${lead}${q}${rel}${q}`;
  });
}

function pkgDirFor(root, rel) {
  let dir = dirname(join(root, rel));
  while (dir.startsWith(root)) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return root;
}

function hasDep(dir, name) {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    return !!(pkg.dependencies?.[name] || pkg.devDependencies?.[name] || pkg.peerDependencies?.[name]);
  } catch {
    return false;
  }
}

function packageManager(root) {
  let dir = root;
  for (;;) {
    if (existsSync(join(dir, "pnpm-lock.yaml")) || existsSync(join(dir, "pnpm-workspace.yaml"))) return "pnpm";
    if (existsSync(join(dir, "bun.lockb")) || existsSync(join(dir, "bun.lock"))) return "bun";
    if (existsSync(join(dir, "yarn.lock"))) return "yarn";
    if (existsSync(join(dir, "package-lock.json"))) return "npm";
    const up = dirname(dir);
    if (up === dir) return "npm";
    dir = up;
  }
}

function findTailwindCss(root, uiDir) {
  const base = join(root, uiDir.split("/components/")[0] ?? "src");
  const stack = existsSync(base) ? [base] : [];
  while (stack.length) {
    const d = stack.pop();
    for (const f of readdirSync(d)) {
      if (f === "node_modules" || f.startsWith(".")) continue;
      const p = join(d, f);
      if (statSync(p).isDirectory()) stack.push(p);
      else if (f.endsWith(".css") && /@import\s+["']tailwindcss["']/.test(readFileSync(p, "utf8"))) return p;
    }
  }
  return null;
}

// ---- add --------------------------------------------------------------------

async function add(args) {
  const names = args._.slice(1);
  if (!names.length) {
    console.log(`Which block? ${dim("npx @withone/forkable list")} shows them all.`);
    process.exit(1);
  }
  const root = findRoot(args.cwd);
  const lay = layout(root);
  const blocks = await resolveBlocks(args.registry, names);
  const write = (p, s) => {
    if (args.dryRun) return;
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, s);
  };

  // Where every registry file lands, so imports between them can be rewritten.
  const placed = new Map();
  for (const b of blocks)
    for (const f of b.files) {
      const key = f.from.endsWith(".json") || f.from.endsWith(".css") ? f.from : stripExt(f.from);
      const entry = placed.get(key) ?? {};
      for (const to of [f.to, f.alsoTo].filter(Boolean)) {
        const landed = place(to, lay);
        entry[isUi(landed, lay) ? "ui" : "server"] = landed;
      }
      placed.set(key, entry);
    }

  // A fork with no React (the plain starter is server-only) gets the routes and
  // the access, not the components. --with-ui overrides.
  const uiPkgDir = pkgDirFor(root, lay.ui + "/x");
  const withUi = args.withUi || hasDep(uiPkgDir, "react") || existsSync(join(root, "ui"));
  console.log(`${bold("forkable add")} ${dim(`into ${relative(process.cwd(), root) || "."}`)}\n`);
  let wrote = 0, kept = 0;
  for (const b of blocks) {
    const notes = [];
    for (const f of b.files) {
      for (const to of [f.to, f.alsoTo].filter(Boolean)) {
        const landed = place(to, lay);
        if (!withUi && isUi(landed, lay)) continue;
        const abs = join(root, landed);
        const content = /\.(tsx?|jsx?)$/.test(f.from) ? rewriteImports(f.content, f.from, landed, placed, lay) : f.content;
        if (existsSync(abs)) {
          const same = readFileSync(abs, "utf8") === content;
          if (same || (!args.overwrite && b.kind === "lib")) { kept++; continue; }
          if (!args.overwrite) { notes.push(yellow(`kept your ${landed}, use --overwrite to replace`)); kept++; continue; }
        }
        write(abs, content);
        wrote++;
      }
    }
    const what = b.kind === "lib" ? b.title : !withUi ? (b.routes?.length ? "route" : dim("ui only, skipped")) : b.files.filter((f) => /\.tsx$/.test(f.from)).map((f) => f.from.split("/").pop()).join(", ");
    const routes = (b.routes ?? []).map((r) => `${r.method} ${r.path}`).join(", ");
    console.log(`${green("✓")} ${b.name.padEnd(28)} ${what}${routes ? dim(`  ${routes}`) : ""}`);
    for (const n of notes) console.log(`  ${n}`);
  }

  // connect.manifest.json
  const manifestPath = join(root, "connect.manifest.json");
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { $schema: "https://forkable.dev/schema/connect.manifest.v1.json", actions: [] };
  manifest.actions ??= [];
  const newActions = [];
  for (const b of blocks)
    for (const a of b.actions ?? []) {
      if (manifest.actions.some((x) => x.actionId === a.actionId) || newActions.some((x) => x.actionId === a.actionId)) continue;
      newActions.push({ platform: a.platform, actionId: a.actionId, access: a.access, usedBy: `blocks/${b.name}`, reason: a.reason, ...(a.optional ? { optional: true } : {}) });
    }
  if (newActions.length) write(manifestPath, existsSync(manifestPath) ? appendActions(readFileSync(manifestPath, "utf8"), newActions) : JSON.stringify({ ...manifest, actions: newActions }, null, 2) + "\n");

  // the lock, then mountForkable() from it
  const lockPath = join(root, lay.server, "blocks.lock.json");
  const lock = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, "utf8")) : { blocks: {} };
  for (const b of blocks) {
    const routeFile = b.files.find((f) => /\/route\.ts$/.test(f.from));
    lock.blocks[b.name] = { kind: b.kind, ...(b.route && routeFile ? { route: b.route, file: posix.relative(lay.server, place(routeFile.to, lay)) } : {}) };
  }
  write(lockPath, JSON.stringify(lock, null, 2) + "\n");
  const indexPath = join(root, lay.server, "index.ts");
  const firstMount = !existsSync(indexPath);
  write(indexPath, mountIndex(lock));

  // CSS: the token fallbacks, imported right after tailwindcss
  let cssNote = null;
  const css = findTailwindCss(root, lay.ui);
  const blocksCss = join(root, lay.ui, "blocks.css");
  if (css && (existsSync(blocksCss) || args.dryRun)) {
    const src = readFileSync(css, "utf8");
    let rel = posix.relative(posix.dirname(relative(root, css)), posix.join(lay.ui, "blocks.css"));
    if (!rel.startsWith(".")) rel = `./${rel}`;
    if (!src.includes(rel)) {
      write(css, src.replace(/(@import\s+["']tailwindcss["'];?\s*\n)/, `$1@import "${rel}";\n`));
      cssNote = `${relative(root, css)} imports ${rel}`;
    }
  }

  // npm packages
  const hasAuth = blocks.some((b) => b.name === "sign-in-with-one") || !!lock.blocks["sign-in-with-one"];
  const uiPkg = pkgDirFor(root, lay.ui + "/x");
  const serverPkg = pkgDirFor(root, lay.server + "/x");
  const want = new Map();
  const need = (dir, list) => list.forEach((d) => !hasDep(dir, d) && want.set(dir, [...(want.get(dir) ?? []), d]));
  if (withUi) need(uiPkg, [...NEEDS.ui, ...(hasAuth ? NEEDS.uiAuth : [])]);
  need(serverPkg, [...NEEDS.server, ...(hasAuth ? NEEDS.serverAuth : [])]);
  const pm = packageManager(root);
  const installed = [];
  for (const [dir, deps] of want) {
    const uniq = [...new Set(deps)];
    const cmd = pm === "npm" ? ["install", ...uniq] : ["add", ...uniq];
    if (!args.install || args.dryRun) { console.log(`\n${yellow("!")} missing in ${relative(root, dir) || "."}: ${uniq.join(" ")}  ${dim(`(${pm} ${cmd.join(" ")})`)}`); continue; }
    const r = spawnSync(pm, cmd, { cwd: dir, stdio: "inherit" });
    if (r.status !== 0) throw new Error(`${pm} ${cmd.join(" ")} failed in ${dir}`);
    installed.push(`${relative(root, dir) || "."}: ${uniq.join(" ")}`);
  }

  const platforms = [...new Set(newActions.map((a) => a.platform))];
  console.log("");
  console.log(`${dim("files")}       ${wrote} written${kept ? `, ${kept} already there` : ""}${args.dryRun ? dim(" (dry run)") : ""}`);
  console.log(`${dim("access")}      connect.manifest.json ${newActions.length ? `+${newActions.length} actions (${platforms.join(", ")})` : "unchanged"}`);
  console.log(`${dim("routes")}      ${posix.join(lay.server, "index.ts")} mounts ${Object.values(lock.blocks).filter((b) => b.route).length}`);
  if (cssNote) console.log(`${dim("styles")}      ${cssNote}`);
  if (!withUi) console.log(`${dim("ui")}          skipped, this fork has no React yet ${dim("(--with-ui adds the components anyway)")}`);
  for (const i of installed) console.log(`${dim("installed")}   ${i}`);

  const serverSrc = join(root, lay.server.split("/routes/")[0]);
  const wired = existsSync(serverSrc) && grepDir(serverSrc, "mountForkable(", join(root, lay.server));
  if (firstMount || !wired) {
    const fromApp = "./" + posix.relative(lay.server.split("/routes/")[0], lay.server) + "/index.js";
    console.log(`\n${bold("One step left.")} Mount the routes once, in your server's app:\n`);
    console.log(dim(`  import { mountForkable } from "${fromApp}";\n`));
    console.log(dim(`  mountForkable(app, {`));
    console.log(dim(`    connect: () => oneConnect,           // your Connect client, null before setup`));
    console.log(dim(`    userId: (c) => yourSession(c).id,    // who is calling`));
    console.log(dim(`  });`));
  }
  console.log(`\nUntil you sign in with One, every block answers from the Acme sample.`);
}

/** Appends to the "actions" array in place, one action per line, leaving the rest of the file as the fork wrote it. */
function appendActions(text, actions) {
  const start = text.search(/"actions"\s*:\s*\[/);
  if (start < 0) {
    const m = JSON.parse(text);
    return JSON.stringify({ ...m, actions }, null, 2) + "\n";
  }
  let i = text.indexOf("[", start), depth = 0, inStr = false;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (inStr) { if (ch === "\\") i++; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") { depth--; if (depth === 0) break; }
  }
  const before = text.slice(0, i).replace(/\s*$/, "");
  const empty = before.endsWith("[");
  const lines = actions.map((a) => `    ${JSON.stringify(a).replace(/","/g, '", "').replace(/":"/g, '": "').replace(/^\{/, "{ ").replace(/\}$/, " }")}`);
  return `${before}${empty ? "" : ","}\n${lines.join(",\n")}\n  ${text.slice(i)}`;
}

function grepDir(dir, needle, skip) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (p === skip || f === "node_modules") continue;
    if (statSync(p).isDirectory()) { if (grepDir(p, needle, skip)) return true; }
    else if (/\.(ts|tsx|js|mjs)$/.test(f) && readFileSync(p, "utf8").includes(needle)) return true;
  }
  return false;
}

function mountIndex(lock) {
  const routes = Object.entries(lock.blocks).filter(([n, b]) => b.route && n !== "sign-in-with-one");
  const auth = lock.blocks["sign-in-with-one"]?.route;
  const imp = (file) => `./${file.replace(/\.ts$/, ".js")}`;
  return `// Written by \`forkable add\` from blocks.lock.json. It is rewritten on
// every add, so keep your own routes elsewhere.
import type { Context, Hono } from "hono";
import type { IncomingMessage } from "node:http";
import type { OneConnectClient } from "@withone/connect/server";
import { createOneServer } from "./lib/one-server.js";
${auth ? `import { signInWithOneRoute } from "${imp(lock.blocks["sign-in-with-one"].file)}";\n` : ""}${routes.map(([, b]) => `import { ${b.route} } from "${imp(b.file)}";`).join("\n")}

export interface ForkableOptions {
  /** Your Connect client, or null until a Connect app is set up. */
  connect: OneConnectClient | null | (() => OneConnectClient | null);
  /** Who is calling: your session lookup. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  userId: (c: Context<any>) => string | Promise<string>;
  /** Only if this fork has no sign-in of its own: mounts Sign in with One's routes. */
  identifyUser?: (req: IncomingMessage) => string | null | Promise<string | null>;
  /** "never" in production, so a signed-out user never sees made-up data. */
  sample?: "until-connected" | "never";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mountForkable(app: Hono<any>, opts: ForkableOptions): void {
  const one = createOneServer({ connect: opts.connect, userId: opts.userId, sample: opts.sample });
${auth ? `  if (opts.identifyUser) app.route("/", signInWithOneRoute({ connect: opts.connect, userId: opts.userId, identifyUser: opts.identifyUser }));\n` : ""}${routes.map(([, b]) => `  app.route("/", ${b.route}(one));`).join("\n")}${routes.length ? "" : "\n  void one;"}
}
`;
}

async function list(args) {
  const index = await fetchJson(args.registry, "index.json");
  if (!index) throw new Error(`No registry at ${args.registry}`);
  const groups = new Map();
  for (const b of index.filter((b) => b.kind !== "lib")) groups.set(b.group ?? "Other", [...(groups.get(b.group ?? "Other") ?? []), b]);
  for (const [g, bs] of groups) {
    console.log(bold(g));
    for (const b of bs) console.log(`  ${b.name.padEnd(30)} ${dim(b.description)}`);
    console.log("");
  }
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
try {
  if (args.help || !cmd) console.log(HELP);
  else if (cmd === "add") await add(args);
  else if (cmd === "list" || cmd === "ls") await list(args);
  else {
    console.log(`Unknown command "${cmd}".\n\n${HELP}`);
    process.exit(1);
  }
} catch (e) {
  console.error(red(`\n${e.message}`));
  process.exit(1);
}
