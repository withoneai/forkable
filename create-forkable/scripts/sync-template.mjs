#!/usr/bin/env node
// Copies each template's source repo into templates/<id> so it ships
// inside this package's npm tarball. Run before `npm pack`/`npm publish`
// (wired as "prepack") and by hand after editing a source repo.
//
//   node scripts/sync-template.mjs              every template
//   node scripts/sync-template.mjs --only <id>  one template (repeatable), so
//                                               syncing Search never re-copies
//                                               Rill from whatever branch orez/
//                                               has checked out
//   node scripts/sync-template.mjs --only search --ref <ref>
//                                               export another git ref of the
//                                               git-sourced templates
//
// A template with a `ref` is exported from git (`git archive <ref>`), not
// copied from its working tree, so private untracked or uncommitted files
// in that repo never reach the package. Search defaults to its
// `public-ready` branch.
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");

const SKIP = new Set(["node_modules", "package-lock.json", ".git", "dist", "tsconfig.tsbuildinfo", ".env", ".DS_Store"]);
// Relative-path prefixes to drop even though their basename isn't generic:
// developer-only evidence (QA screenshots), not part of what a fork needs.
const SKIP_PATHS = ["docs/qa", "site/docs/qa"];

const TEMPLATES = [
  { id: "forkable-starter", src: join(here, "..", "..", "starter") },
  { id: "rill", src: join(homedir(), "projects", "connect-usecases", "orez") },
  { id: "search", src: join(homedir(), "projects", "connect-usecases", "search"), ref: "public-ready" },
];

const only = [];
let refOverride = null;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--only") {
    const id = argv[++i];
    if (!id) {
      console.error("sync-template: --only needs a template id");
      process.exit(2);
    }
    only.push(id);
  } else if (a.startsWith("--only=")) only.push(a.slice("--only=".length));
  else if (a === "--ref") {
    refOverride = argv[++i];
    if (!refOverride) {
      console.error("sync-template: --ref needs a git ref");
      process.exit(2);
    }
  } else if (a.startsWith("--ref=")) refOverride = a.slice("--ref=".length);
  else if (a === "-h" || a === "--help") {
    console.log(`Usage: node scripts/sync-template.mjs [--only <id>]... [--ref <git ref>]\nTemplates: ${TEMPLATES.map((t) => t.id).join(", ")}`);
    process.exit(0);
  } else {
    console.error(`sync-template: unknown argument "${a}"`);
    process.exit(2);
  }
}
const unknown = only.filter((id) => !TEMPLATES.some((t) => t.id === id));
if (unknown.length) {
  console.error(`sync-template: no template "${unknown.join('", "')}". Available: ${TEMPLATES.map((t) => t.id).join(", ")}`);
  process.exit(2);
}

const selected = only.length ? TEMPLATES.filter((t) => only.includes(t.id)) : TEMPLATES;
if (refOverride && !selected.some((t) => t.ref)) {
  console.error(`sync-template: --ref only applies to git-sourced templates (${TEMPLATES.filter((t) => t.ref).map((t) => t.id).join(", ")})`);
  process.exit(2);
}

// `git archive <ref>` of src into a fresh temp dir. Returns its path.
function exportRef(id, src, ref) {
  const verify = spawnSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { cwd: src, encoding: "utf8" });
  if (verify.status !== 0) throw new Error(`no git ref "${ref}" in ${src}`);
  const sha = verify.stdout.trim().slice(0, 7);
  const dir = mkdtempSync(join(tmpdir(), `forkable-sync-${id}-`));
  const archive = spawnSync("git", ["archive", "--format=tar", ref], { cwd: src, maxBuffer: 1024 * 1024 * 1024 });
  if (archive.status !== 0) throw new Error(`git archive ${ref} failed in ${src}: ${archive.stderr}`);
  const untar = spawnSync("tar", ["-x", "-C", dir], { input: archive.stdout });
  if (untar.status !== 0) throw new Error(`tar failed for ${id}: ${untar.stderr}`);
  return { dir, label: `${src}@${ref} (${sha})` };
}

for (const { id, src: repo, ref: defaultRef } of selected) {
  const dest = join(packageRoot, "templates", id);
  if (!existsSync(repo)) {
    console.error(`sync-template: no source for "${id}" at ${repo}`);
    process.exitCode = 1;
    continue;
  }
  const ref = defaultRef ? refOverride ?? defaultRef : null;
  let src = repo;
  let label = repo;
  let scratch = null;
  if (ref) {
    try {
      ({ dir: scratch, label } = exportRef(id, repo, ref));
      src = scratch;
    } catch (e) {
      console.error(`sync-template: ${e.message}`);
      process.exitCode = 1;
      continue;
    }
  }
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, {
    recursive: true,
    filter: (path) => {
      if (SKIP.has(path.split("/").pop() ?? "")) return false;
      const rel = relative(src, path).split(sep).join("/");
      return !SKIP_PATHS.some((p) => rel === p || rel.startsWith(`${p}/`));
    },
  });
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  console.log(`sync-template: copied ${label} -> ${dest}`);
}
