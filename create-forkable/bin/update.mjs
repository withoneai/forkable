// npm create forkable@latest update   (run inside a fork)
//
// Brings a fork up to the template in this version of create-forkable,
// keeping the owner's own changes. It is a real three-way git merge:
//
//   base    the template as the fork last got it: the newest "Forkable update:"
//           commit in the fork's history, else its first commit ("Forked from
//           <id>@<version>", which create-forkable makes before installing, or
//           the first commit of a repo made from a template mirror on GitHub)
//   theirs  the template in this package, made into one commit on top of base
//           in a scratch worktree, with the fork's own name, forkable.json name
//           and local/profile.md kept, so those never show up as changes
//   ours    the fork's HEAD
//
// Then `git merge` does the rest: files only the template changed update,
// files only the owner changed stay, and a file both changed is a normal git
// conflict to resolve (or `git merge --abort`). Nothing runs on a dirty tree,
// and .env, local data and untracked files are never touched.
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const UPDATE_PREFIX = "Forkable update: ";
const FORKED_PREFIX = "Forked from ";

function git(cwd, args, env) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: env ?? process.env });
  if (r.error) throw r.error;
  return { status: r.status ?? 1, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** The template commit the fork last took in: newest "Forkable update:" commit, else the "Forked from" root. */
export function findBase(dir) {
  const upd = git(dir, ["log", "-1", "--format=%H", `--grep=^${UPDATE_PREFIX}`, "HEAD"]);
  if (upd.status === 0 && upd.out) return { sha: upd.out, kind: "update" };
  const roots = git(dir, ["rev-list", "--max-parents=0", "HEAD"]);
  const list = roots.out.split("\n").filter(Boolean);
  for (const sha of list) {
    const msg = git(dir, ["log", "-1", "--format=%s", sha]).out;
    if (msg.startsWith(FORKED_PREFIX)) return { sha, kind: "fork" };
  }
  // a repo made from a template mirror on GitHub ("Use this template") starts
  // with "Initial commit": its first commit still holds forkable.json with forkedFrom
  for (const sha of list) {
    const fj = git(dir, ["show", `${sha}:forkable.json`]);
    try {
      if (fj.status === 0 && typeof JSON.parse(fj.out).forkedFrom === "string") return { sha, kind: "mirror" };
    } catch { /* not JSON */ }
  }
  return null;
}

export async function update(args, state, h) {
  const { say, CliError, packageRoot, cliVersion, bundledTemplateIds, findPnpm, run, PNPM_FIX, npmCmd } = h;
  const dir = resolve(args.dir ?? process.cwd());
  state.dir = dir;
  state.mode = "update";

  // 1. a fork, with git, nothing uncommitted
  const fj = readJson(join(dir, "forkable.json"));
  const from = typeof fj?.forkedFrom === "string" ? fj.forkedFrom : null;
  if (!from) {
    throw new CliError("NOT_A_FORK", `${dir} is not a fork: its forkable.json has no "forkedFrom".`, {
      fix: "Run this inside a folder made by `npm create forkable@latest <id>`, or pass --dir <that folder>.",
    });
  }
  const id = from.slice(0, from.lastIndexOf("@") > 0 ? from.lastIndexOf("@") : from.length);
  const fromVersion = from.includes("@") ? from.slice(from.lastIndexOf("@") + 1) : null;
  state.template = id;
  state.fromVersion = fromVersion;
  if (!bundledTemplateIds().includes(id)) {
    throw new CliError("TEMPLATE_NOT_BUNDLED", `create-forkable ${cliVersion} has no "${id}" template to update from.`, {
      fix: "Run the latest version: npm create forkable@latest update",
    });
  }
  const top = git(dir, ["rev-parse", "--show-toplevel"]);
  if (top.status !== 0) {
    throw new CliError("NO_GIT", `${dir} has no git history, so there is nothing to merge into.`, {
      fix: "Forks get git history when they are made. Run `git init && git add -A && git commit -m \"Forked from <id>@<version>\"` only if you know which version it came from.",
    });
  }
  if (resolve(top.out) !== dir) {
    throw new CliError("NOT_A_FORK", `${dir} is inside another git repo (${top.out}). Update runs at the fork's own root.`, { fix: `Run it in ${top.out}, or pass --dir.` });
  }
  if (existsSync(join(dir, ".git", "MERGE_HEAD"))) {
    throw new CliError("MERGE_IN_PROGRESS", "a merge is already in progress here.", { fix: "Finish it (`git commit`) or undo it (`git merge --abort`), then run update again." });
  }
  const dirty = git(dir, ["status", "--porcelain", "--untracked-files=no"]).out;
  if (dirty) {
    throw new CliError("DIRTY", "this fork has changes that are not committed. Update only runs on a clean tree, so nothing of yours is ever lost.", {
      fix: "Commit them first (`git add -A && git commit -m \"my changes\"`), then run update again.",
      extra: { changed: dirty.split("\n").map((l) => l.slice(3)) },
    });
  }
  const base = findBase(dir);
  if (!base) {
    throw new CliError("NO_BASE", "could not find the commit this fork started from (\"Forked from ...\").", {
      fix: "Forks made by create-forkable have it as their first commit. Without it, copy the changes by hand from https://forkable.dev.",
    });
  }
  state.base = base.sha;

  // 2. theirs: the new template, as one commit on top of base, in a scratch worktree
  const templateDir = join(packageRoot, "templates", id);
  const newFj = readJson(join(templateDir, "forkable.json")) ?? {};
  const toVersion = newFj.starter ?? cliVersion;
  state.toVersion = toVersion;
  const scratch = mkdtempSync(join(tmpdir(), "forkable-update-"));
  rmSync(scratch, { recursive: true, force: true });
  const identity = {
    ...process.env,
    GIT_AUTHOR_NAME: "Forkable",
    GIT_AUTHOR_EMAIL: "noreply@forkable.dev",
    GIT_COMMITTER_NAME: "Forkable",
    GIT_COMMITTER_EMAIL: "noreply@forkable.dev",
  };
  let theirs = null;
  try {
    const add = git(dir, ["worktree", "add", "--detach", "-q", scratch, base.sha]);
    if (add.status !== 0) throw new CliError("INTERNAL", `could not make a scratch worktree: ${add.err}`);
    git(scratch, ["rm", "-r", "-q", "--ignore-unmatch", "."]);
    cpSync(templateDir, scratch, { recursive: true });
    // what the fork filled in at fork time stays as the fork had it
    const show = (path) => {
      const r = spawnSync("git", ["show", `${base.sha}:${path}`], { cwd: dir, encoding: "utf8" });
      return r.status === 0 ? r.stdout : null;
    };
    const basePkg = (() => { try { return JSON.parse(show("package.json") ?? "null"); } catch { return null; } })();
    const pkgPath = join(scratch, "package.json");
    if (basePkg?.name && existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      pkg.name = basePkg.name;
      writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    }
    const baseFj = (() => { try { return JSON.parse(show("forkable.json") ?? "null"); } catch { return null; } })();
    const fjPath = join(scratch, "forkable.json");
    if (existsSync(fjPath)) {
      const j = JSON.parse(readFileSync(fjPath, "utf8"));
      if (baseFj?.name) j.name = baseFj.name;
      j.forkedFrom = `${id}@${toVersion}`;
      writeFileSync(fjPath, `${JSON.stringify(j, null, 2)}\n`);
    }
    const profile = show("local/profile.md");
    if (profile !== null && existsSync(join(scratch, "local", "profile.md"))) writeFileSync(join(scratch, "local", "profile.md"), profile);
    git(scratch, ["add", "-A"]);
    if (git(scratch, ["diff", "--cached", "--quiet"]).status === 0) {
      state.ok = true;
      state.upToDate = true;
      state.changed = [];
      say(`This fork already has the newest ${id} (create-forkable ${cliVersion}). Nothing to update.`);
      return;
    }
    state.changed = git(scratch, ["diff", "--cached", "--name-only"]).out.split("\n").filter(Boolean);
    const c = git(scratch, ["commit", "-q", "-m", `${UPDATE_PREFIX}${id}@${toVersion} (create-forkable ${cliVersion})`], identity);
    if (c.status !== 0) throw new CliError("INTERNAL", `could not commit the new template: ${c.err}`);
    theirs = git(scratch, ["rev-parse", "HEAD"]).out;
  } finally {
    git(dir, ["worktree", "remove", "--force", scratch]);
    rmSync(scratch, { recursive: true, force: true });
    git(dir, ["worktree", "prune"]);
  }
  state.upstream = theirs;
  say(`Updating ${id} to the newest template (create-forkable ${cliVersion}): ${state.changed.length} file${state.changed.length === 1 ? "" : "s"} changed in the template.`);

  if (args.dryRun) {
    state.ok = true;
    state.dryRun = true;
    for (const f of state.changed) say(`  ${f}`);
    say("\nDry run: nothing was merged. Run it again without --dry-run to update.");
    return;
  }

  // 3. merge it into the fork; the owner's git identity if they have one
  const mine = git(dir, ["config", "user.email"]).out ? process.env : identity;
  const m = git(dir, ["merge", "--no-ff", "--no-edit", "-m", `Update ${id} with create-forkable ${cliVersion}`, theirs], mine);
  const conflicts = git(dir, ["diff", "--name-only", "--diff-filter=U"]).out.split("\n").filter(Boolean);
  state.conflicts = conflicts;
  if (m.status !== 0) {
    if (conflicts.length) {
      say(`\n${conflicts.length} file${conflicts.length === 1 ? "" : "s"} changed both here and in the template:`);
      for (const f of conflicts) say(`  ${f}`);
      throw new CliError("CONFLICTS", `the update is merged except ${conflicts.length} file${conflicts.length === 1 ? "" : "s"} you also changed.`, {
        fix: "Open each file, keep what you want between the <<<<<<< and >>>>>>> marks, then `git add -A && git commit`. To undo the whole update: `git merge --abort`. Then run your install.",
        extra: { conflicts },
      });
    }
    throw new CliError("MERGE_FAILED", `git could not merge the update: ${m.err || m.out}`, {
      fix: "Untracked files in the way? Move them, then run update again. Nothing was changed.",
    });
  }
  state.merged = true;

  // 4. install what changed
  if (args.install) {
    const usesPnpm = existsSync(join(dir, "pnpm-workspace.yaml"));
    const pm = usesPnpm ? (findPnpm() ?? null) : { cmd: npmCmd, pre: [], label: "npm" };
    if (!pm) {
      state.warnings.push(`pnpm was not found, so dependencies were not installed. ${PNPM_FIX}`);
    } else {
      state.packageManagerCommand = pm.label;
      say(`\nInstalling dependencies with ${pm.label}...\n`);
      const s = run(pm.cmd, [...pm.pre, "install"], { cwd: dir, env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" } });
      state.installed = s === 0;
      if (s !== 0) state.warnings.push(`${pm.label} install exited ${s}. The update is merged; fix the install, then run it again.`);
    }
  }
  state.ok = true;
  say(`\n${id} is updated. Your own changes are kept. To undo it: git reset --hard HEAD~1`);
}
