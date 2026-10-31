// Smokes and tests must never change the files that decide what a real user's
// Connect app asks for. Import this first in every smoke: it sets SEARCH_SMOKE=1
// (the server then refuses to read or write the repo's connect.extra.json and
// .env, see server/src/config.ts) and, on exit, fails the run if any of these
// files changed while it ran, naming the file and putting it back.

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const GUARDED_FILES = ["connect.extra.json", "connect.manifest.json", ".env", ".env.local", "one.connect.ts"];

process.env.SEARCH_SMOKE = "1";

const before = new Map(GUARDED_FILES.map((f) => {
  const p = resolve(REPO_ROOT, f);
  return [p, existsSync(p) ? readFileSync(p, "utf8") : null] as const;
}));

/** Repo files this run changed, each put back to how it was. */
export function changedRepoFiles(): string[] {
  const changed: string[] = [];
  for (const [p, was] of before) {
    const now = existsSync(p) ? readFileSync(p, "utf8") : null;
    if (now === was) continue;
    changed.push(p);
    if (was === null) rmSync(p, { force: true }); else writeFileSync(p, was);
  }
  return changed;
}

const realExit = process.exit.bind(process);
process.exit = ((code?: number | string | null) => {
  const changed = changedRepoFiles();
  if (changed.length) {
    for (const p of changed) console.log(`FAIL this run changed the repo's ${p} (restored). Tests must use SEARCH_ENV_DIR.`);
    return realExit(1);
  }
  return realExit(code ?? undefined);
}) as typeof process.exit;

// Runs that end on their own (node --test files) are checked here too.
process.on("exit", () => {
  const changed = changedRepoFiles();
  if (!changed.length) return;
  for (const p of changed) console.log(`FAIL this run changed the repo's ${p} (restored). Tests must use SEARCH_ENV_DIR.`);
  process.exitCode = 1;
});
