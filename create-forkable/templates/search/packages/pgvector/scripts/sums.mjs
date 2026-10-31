// Rewrites SHA256SUMS over every file in prebuilt/. `node scripts/sums.mjs --check` verifies instead.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pre = join(root, "prebuilt");
const files = [];
const walk = (d) => { for (const n of readdirSync(d).sort()) { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : files.push(p); } };
if (existsSync(pre)) walk(pre);
const lines = files.map((f) => `${createHash("sha256").update(readFileSync(f)).digest("hex")}  ${relative(root, f)}`);
if (process.argv.includes("--check")) {
  const want = readFileSync(join(root, "SHA256SUMS"), "utf8").trim().split("\n").sort();
  const got = lines.sort();
  if (JSON.stringify(want) !== JSON.stringify(got)) { console.error("SHA256SUMS mismatch"); process.exit(1); }
  console.log(`ok, ${got.length} files`);
} else {
  writeFileSync(join(root, "SHA256SUMS"), lines.join("\n") + "\n");
  console.log(`SHA256SUMS: ${lines.length} files`);
}
