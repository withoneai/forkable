#!/usr/bin/env node
// Exports each template in templates/<id> into its own standalone repo,
// so builders that import whole repos (Replit, Bolt) and
// `gh repo create --template` can start from it.
//
//   node scripts/mirror-templates.mjs                  sync every mirror, one commit each when content changed
//   node scripts/mirror-templates.mjs --check          exit 1 if any mirror is stale (CI), write nothing
//   node scripts/mirror-templates.mjs --only rill      one template
//   node scripts/mirror-templates.mjs --out <dir>      where the mirrors live (default ~/projects/forkable-mirrors)
//   node scripts/mirror-templates.mjs --source <sha>   source commit named in the commit message (default: git HEAD)
//
// Each mirror is <out>/<repo> (forkable-rill, forkable-search,
// forkable-starter), its own git repo. The files are what `npm create forkable` would hand a fork
// (package.json and forkable.json renamed and given lineage,
// local/profile.md with {{FOR}} and {{IN}} left as placeholders), plus a
// mirror note at the top of the README, a .gitignore, an MIT LICENSE and
// per-builder config (.replit). Nothing is pushed: the workflow in
// scripts/mirror-templates.workflow.yml does that once it is enabled.
//
// The mirrors read the committed templates/ directory, not the source
// repos sync-template.mjs copies from, so this runs the same in CI.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");
const templatesRoot = join(packageRoot, "templates");
const SOURCE_REPO = "withoneai/forkable";
const MIRROR_OWNER = "withoneai";

// Same skip list as sync-template.mjs, so a mirror never carries more than
// the npm tarball does.
const SKIP = new Set(["node_modules", "package-lock.json", ".git", "dist", "tsconfig.tsbuildinfo", ".env", ".DS_Store"]);
const SKIP_PATHS = ["docs/qa", "site/docs/qa"];

const DEFAULT_GITIGNORE = ["node_modules", "dist", ".env", ".env.*", "!.env.example", "*.log", ".DS_Store", "tsconfig.tsbuildinfo"];

const MIT = (holder) => `MIT License

Copyright (c) 2026 ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

// Per-template mirror settings. A template without an entry still mirrors,
// with npm and no builder config.
const MIRRORS = {
  "forkable-starter": {
    repo: "forkable-starter",
    title: "forkable-starter",
    pm: "npm",
    replit: `# Replit config for the forkable-starter mirror.
# Import: https://replit.com/github.com/${MIRROR_OWNER}/forkable-starter
# The run button installs, runs the keyless demo (exits 0), then starts the
# Hono server. It listens on every interface on PORT (51890), mapped to 80.
# The server only has /api routes, so open /api/hello in the webview.
modules = ["nodejs-20"]
run = "npm install && npm start && npm run dev"

[[ports]]
localPort = 51890
externalPort = 80
`,
    builders: `- **Replit**: the \`.replit\` here installs, runs the demo, then starts the
  server on port 51890 (mapped to 80). Open \`/api/hello\` in the webview.
- **Bolt**: plain Node with a root \`package.json\`, so it opens as is. Run
  \`npm start\` in its terminal for the demo, \`npm run dev\` for the server.
- **Lovable** builds from a prompt, not a repo import. Point the prompt at
  this repo.`,
  },
  rill: {
    repo: "forkable-rill",
    title: "Rill",
    pm: "pnpm",
    // pnpm is pinned through npx so the run button works whether or not the
    // Replit Node module puts pnpm on PATH; npx adds it to PATH for the
    // scripts that call pnpm again. Vite only answers hosts it knows, so the
    // Replit preview domains are added for the dev server.
    replit: `# Replit config for the Rill mirror.
# Import: https://replit.com/github.com/${MIRROR_OWNER}/forkable-rill
# The run button installs with pnpm and starts \`pnpm dev\`: the API on
# 127.0.0.1:51789 (internal only) and the Vite UI on 0.0.0.0:5180, mapped
# to 80, on the Acme sample inbox. No keys needed.
# Database: embedded Postgres by default (a native Linux binary in
# node_modules, data in ~/.rill/db). If it will not start here, add
# Replit's PostgreSQL database; it sets DATABASE_URL, which Rill uses
# instead.
# Sign in with One needs a Connect app whose redirect URI matches this
# Repl's URL, which Rill does not support yet (it pins
# http://localhost:51789/api/one/callback), so on Replit it runs on the
# sample only. Publishing needs the server on 0.0.0.0 and one port, also
# not supported yet.
modules = ["nodejs-20"]
run = "export __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=.replit.dev && npx --yes pnpm@10.4.0 install && npx --yes pnpm@10.4.0 dev"

[[ports]]
localPort = 5180
externalPort = 80
`,
    builders: `- **Replit**: the \`.replit\` here installs with pnpm and starts \`pnpm dev\`,
  the UI on port 5180 (mapped to 80) over the Acme sample. If the embedded
  Postgres will not start, add Replit's PostgreSQL database; Rill uses its
  \`DATABASE_URL\`. Sign in with One does not work there yet (the callback is
  pinned to localhost).
- **Bolt** runs in a browser sandbox that cannot start Postgres or open a
  raw database connection, so Rill does not run there today.
- **Lovable** builds from a prompt, not a repo import. Point the prompt at
  this repo.`,
  },
  search: {
    repo: "forkable-search",
    title: "Search",
    pm: "pnpm",
    // Same shape as Rill: pnpm pinned through npx, Replit hosts allowed for
    // Vite. Search wants Node 22.12 or newer, hence nodejs-22.
    replit: `# Replit config for the Search mirror.
# Import: https://replit.com/github.com/${MIRROR_OWNER}/forkable-search
# The run button installs with pnpm and starts \`pnpm dev\`: the API on
# 127.0.0.1:52289 (internal only) and the Vite UI on 0.0.0.0:5680, mapped
# to 80. Click "Try the Acme sample" for the full app on sample data. No
# keys needed.
# Database: embedded Postgres with pgvector by default (native binaries in
# node_modules, data in ~/.search). If it will not start here, add
# Replit's PostgreSQL database and set SEARCH_DATABASE_URL to its URL.
# Sign in with One needs a Connect app whose redirect URI matches this
# Repl's URL, which Search does not support yet (it pins
# http://localhost:52289/api/one/callback), so on Replit it runs on the
# sample only.
modules = ["nodejs-22"]
run = "export __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=.replit.dev && npx --yes pnpm@10.4.0 install && npx --yes pnpm@10.4.0 dev"

[[ports]]
localPort = 5680
externalPort = 80
`,
    builders: `- **Replit**: the \`.replit\` here installs with pnpm and starts \`pnpm dev\`,
  the UI on port 5680 (mapped to 80). Click Try the Acme sample. If the
  embedded Postgres will not start, add Replit's PostgreSQL database and
  set \`SEARCH_DATABASE_URL\` (it needs the pgvector extension for
  semantic search; without it Search runs keyword-only). Sign in with One
  does not work there yet (the callback is pinned to localhost).
- **Bolt** runs in a browser sandbox that cannot start Postgres or open a
  raw database connection, so Search does not run there today.
- **Lovable** builds from a prompt, not a repo import. Point the prompt at
  this repo.`,
  },
};

function parseArgs(argv) {
  const out = { check: false, only: null, out: join(homedir(), "projects", "forkable-mirrors"), source: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--check") out.check = true;
    else if (a === "--only") out.only = argv[++i];
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--source") out.source = argv[++i];
    else if (a === "-h" || a === "--help") {
      console.log("Usage: node scripts/mirror-templates.mjs [--check] [--only <id>] [--out <dir>] [--source <sha>]");
      process.exit(0);
    } else {
      console.error(`mirror-templates: unknown argument "${a}"`);
      process.exit(2);
    }
  }
  return out;
}

function git(args, cwd, env) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: env ?? process.env });
  if (r.error) throw r.error;
  return r;
}

function sourceCommit(explicit) {
  if (explicit) return explicit;
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  const r = git(["rev-parse", "--short", "HEAD"], packageRoot);
  if (r.status !== 0) return "unknown";
  const sha = r.stdout.trim();
  const dirty = git(["status", "--porcelain", "--", "."], templatesRoot).stdout.trim();
  return dirty ? `${sha}+dirty` : sha;
}

function templateIds() {
  return readdirSync(templatesRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

function mirrorConfig(id) {
  return MIRRORS[id] ?? { repo: id.startsWith("forkable-") ? id : `forkable-${id}`, title: id, pm: "npm", replit: null, builders: null };
}

// The files a fork would receive, plus the mirror's own files, written into
// `dir`. Mirrors what bin/create-forkable.mjs does to a fresh copy, with the
// template id as the name and no --for / --in values.
function exportTemplate(id, dir) {
  const src = join(templatesRoot, id);
  const cfg = mirrorConfig(id);
  cpSync(src, dir, {
    recursive: true,
    filter: (path) => {
      if (SKIP.has(path.split("/").pop() ?? "")) return false;
      const rel = relative(src, path).split(sep).join("/");
      return !SKIP_PATHS.some((p) => rel === p || rel.startsWith(`${p}/`));
    },
  });

  const pkgPath = join(dir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.name = id;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

  const forkableJsonPath = join(dir, "forkable.json");
  let version = "0.0.0";
  if (existsSync(forkableJsonPath)) {
    const fj = JSON.parse(readFileSync(forkableJsonPath, "utf8"));
    version = fj.starter ?? version;
    fj.name = id;
    fj.forkedFrom = `${id}@${version}`;
    writeFileSync(forkableJsonPath, `${JSON.stringify(fj, null, 2)}\n`);
  }
  // local/profile.md: create-forkable fills only the fields it was given.
  // A mirror is given none, so {{FOR}} and {{IN}} stay for the owner.

  // .gitignore: keep the template's, add the defaults it lacks.
  const giPath = join(dir, ".gitignore");
  const existing = existsSync(giPath) ? readFileSync(giPath, "utf8").split("\n").map((l) => l.trimEnd()) : [];
  const lines = existing.filter((l, i) => l || i < existing.length - 1);
  for (const l of DEFAULT_GITIGNORE) if (!lines.includes(l)) lines.push(l);
  writeFileSync(giPath, `${lines.join("\n")}\n`);

  // LICENSE: the template's if it is MIT, else a fresh MIT one.
  const licPath = join(dir, "LICENSE");
  if (!existsSync(licPath) || !readFileSync(licPath, "utf8").startsWith("MIT License")) {
    writeFileSync(licPath, MIT("One Systems, Inc."));
  }

  if (cfg.replit) writeFileSync(join(dir, ".replit"), cfg.replit);

  const readmePath = join(dir, "README.md");
  const readme = existsSync(readmePath) ? readFileSync(readmePath, "utf8") : `# ${cfg.title}\n`;
  writeFileSync(readmePath, withMirrorNote(readme, id, cfg));
}

function withMirrorNote(readme, id, cfg) {
  const run = cfg.pm === "pnpm" ? "pnpm install\npnpm start" : "npm install\nnpm start";
  const note = `> [!NOTE]
> This repo is a mirror of the \`${id}\` template in
> [${SOURCE_REPO}](https://github.com/${SOURCE_REPO}/tree/main/create-forkable/templates/${id}).
> It exists so Replit, Bolt and \`gh repo create --template\` can start from
> a whole repo. It is rewritten on every sync, so send changes to the
> source repo, not here.

The preferred way to start is the Forkable CLI. It names your fork, fills
in \`local/profile.md\` with who it is for and where, and starts a fresh git
history:

\`\`\`
npm create forkable@latest my-${id === "forkable-starter" ? "business" : id} -- --template ${id}
\`\`\`

Starting from this repo instead (Use this template, or a builder import):

\`\`\`
${run}
\`\`\`

Then fill in \`{{FOR}}\` and \`{{IN}}\` in \`local/profile.md\` and rename the
project in \`package.json\` and \`forkable.json\`.
${cfg.builders ? `\n${cfg.builders}\n` : ""}
---
`;
  // Keep the template's own title first, then the note.
  const m = readme.match(/^# .*\n/);
  if (!m) return `${note}\n${readme}`;
  return `${m[0]}\n${note}\n${readme.slice(m[0].length).replace(/^\n+/, "")}`;
}

// Every file under dir except .git, as relpath -> sha256 of mode + content.
function snapshot(dir) {
  const out = new Map();
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === ".git") continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        const mode = statSync(p).mode & 0o111 ? "x" : "-";
        out.set(relative(dir, p).split(sep).join("/"), createHash("sha256").update(mode).update(readFileSync(p)).digest("hex"));
      }
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

function diffSnapshots(want, have) {
  const changes = [];
  for (const [p, h] of want) if (!have.has(p)) changes.push(`+ ${p}`);
  else if (have.get(p) !== h) changes.push(`~ ${p}`);
  for (const p of have.keys()) if (!want.has(p)) changes.push(`- ${p}`);
  return changes.sort((a, b) => a.slice(2).localeCompare(b.slice(2)));
}

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME ?? "Forkable",
  GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL ?? "noreply@forkable.dev",
  GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME ?? "Forkable",
  GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL ?? "noreply@forkable.dev",
};

function syncMirror(id, staged, dest, source) {
  if (!existsSync(join(dest, ".git"))) {
    mkdirSync(dest, { recursive: true });
    const r = git(["init", "-q", "-b", "main"], dest);
    if (r.status !== 0) throw new Error(`git init failed in ${dest}: ${r.stderr}`);
  }
  // Replace the working tree with the export, keeping .git.
  for (const e of readdirSync(dest)) if (e !== ".git") rmSync(join(dest, e), { recursive: true, force: true });
  cpSync(staged, dest, { recursive: true });
  git(["add", "-A"], dest);
  const status = git(["status", "--porcelain"], dest).stdout.trim();
  if (!status) return null;
  const msg = `Sync from ${SOURCE_REPO}@${source}\n\nMirror of create-forkable/templates/${id} at ${SOURCE_REPO}@${source}.\nDo not edit here; changes go to the source repo.`;
  const c = git(["commit", "-q", "-m", msg], dest, gitEnv);
  if (c.status !== 0) throw new Error(`git commit failed in ${dest}: ${c.stderr}`);
  return git(["rev-parse", "--short", "HEAD"], dest).stdout.trim();
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const ids = templateIds();
  if (args.only && !ids.includes(args.only)) {
    console.error(`mirror-templates: no template "${args.only}". Available: ${ids.join(", ")}`);
    process.exit(2);
  }
  const source = sourceCommit(args.source);
  const scratch = mkdtempSync(join(tmpdir(), "forkable-mirror-"));
  let stale = 0;
  try {
    for (const id of args.only ? [args.only] : ids) {
      const cfg = mirrorConfig(id);
      const staged = join(scratch, cfg.repo);
      mkdirSync(staged);
      exportTemplate(id, staged);
      const dest = join(args.out, cfg.repo);
      if (args.check) {
        const changes = diffSnapshots(snapshot(staged), snapshot(dest));
        if (changes.length) {
          stale++;
          console.error(`mirror-templates: ${cfg.repo} is stale (${changes.length} file${changes.length === 1 ? "" : "s"})`);
          for (const c of changes.slice(0, 40)) console.error(`  ${c}`);
          if (changes.length > 40) console.error(`  ... and ${changes.length - 40} more`);
        } else {
          console.log(`mirror-templates: ${cfg.repo} is up to date`);
        }
        continue;
      }
      const sha = syncMirror(id, staged, dest, source);
      console.log(sha ? `mirror-templates: ${cfg.repo} -> ${sha} (from ${source})` : `mirror-templates: ${cfg.repo} unchanged`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  if (stale) {
    console.error(`\nmirror-templates: ${stale} mirror${stale === 1 ? "" : "s"} stale. Run node scripts/mirror-templates.mjs to sync.`);
    process.exit(1);
  }
}

main();
