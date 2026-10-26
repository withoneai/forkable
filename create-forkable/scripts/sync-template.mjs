#!/usr/bin/env node
// Copies ../../starter into templates/forkable-starter so it ships inside
// this package's npm tarball. Run before `npm pack`/`npm publish`
// (wired as "prepack") and by hand after editing the starter.
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..", "starter");
const dest = join(here, "..", "templates", "forkable-starter");

const SKIP = new Set(["node_modules", "package-lock.json", ".git", "dist", "tsconfig.tsbuildinfo"]);

if (!existsSync(src)) {
  console.error(`sync-template: no starter at ${src}`);
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, {
  recursive: true,
  filter: (path) => !SKIP.has(path.split("/").pop() ?? ""),
});

console.log(`sync-template: copied ${src} -> ${dest}`);
