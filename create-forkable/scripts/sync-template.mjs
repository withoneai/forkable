#!/usr/bin/env node
// Copies each template's source repo into templates/<id> so it ships
// inside this package's npm tarball. Run before `npm pack`/`npm publish`
// (wired as "prepack") and by hand after editing a source repo.
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");

const SKIP = new Set(["node_modules", "package-lock.json", ".git", "dist", "tsconfig.tsbuildinfo", ".env", ".DS_Store"]);
// Relative-path prefixes to drop even though their basename isn't generic:
// developer-only evidence (QA screenshots), not part of what a fork needs.
const SKIP_PATHS = ["docs/qa"];

const TEMPLATES = [
  { id: "forkable-starter", src: join(here, "..", "..", "starter") },
  { id: "rill", src: join(homedir(), "projects", "connect-usecases", "orez") },
];

for (const { id, src } of TEMPLATES) {
  const dest = join(packageRoot, "templates", id);
  if (!existsSync(src)) {
    console.error(`sync-template: no source for "${id}" at ${src}`);
    process.exitCode = 1;
    continue;
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
  console.log(`sync-template: copied ${src} -> ${dest}`);
}
