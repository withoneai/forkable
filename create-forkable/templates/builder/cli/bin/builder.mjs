#!/usr/bin/env node
// Runs the TypeScript entry through tsx (dev install). A published build ships compiled JS.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const r = spawnSync(process.execPath, ["--import", "tsx", join(here, "..", "src", "index.ts"), ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(r.status ?? 1);
