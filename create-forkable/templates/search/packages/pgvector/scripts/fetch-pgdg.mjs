// Fetches PGDG's postgresql-18-pgvector 0.8.7 .debs (Ubuntu 22.04 builds, vector.so
// needs only GLIBC_2.14), verifies the pinned sha256, and extracts vector.so plus the
// control and SQL files into prebuilt/linux-x64 and prebuilt/linux-arm64.
// Needs `ar` and `tar` with xz support on PATH (macOS and most Linux have both).
// Usage: node scripts/fetch-pgdg.mjs [--from DIR]   (DIR holds already downloaded .debs)
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = "0.8.7";
const DEBS = {
  "linux-x64": { arch: "amd64", sha256: "9279890b5616c53dd67cf32ef300f1ae3f08cc5cbbfcc0405990d3fa3d8253d9" },
  "linux-arm64": { arch: "arm64", sha256: "5b7e51a9ba0ab24ea28e9f72ff4971203531b2e5c4c6673c7109c661a0561181" },
};
const fromIdx = process.argv.indexOf("--from");
const from = fromIdx > 0 ? process.argv[fromIdx + 1] : null;

for (const [target, { arch, sha256 }] of Object.entries(DEBS)) {
  const name = `postgresql-18-pgvector_${VERSION}-1.pgdg22.04+1_${arch}.deb`;
  let buf;
  const local = from ? readdirSync(from).find((f) => f.endsWith(`_${arch}.deb`) || f === `pgv-${arch}.deb`) : null;
  if (local) buf = readFileSync(join(from, local));
  else {
    const url = `https://apt.postgresql.org/pub/repos/apt/pool/main/p/pgvector/${encodeURIComponent(name)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
  }
  const got = createHash("sha256").update(buf).digest("hex");
  if (got !== sha256) throw new Error(`${name}: sha256 ${got}, expected ${sha256}`);
  const work = mkdtempSync(join(tmpdir(), "search-pgdg-"));
  writeFileSync(join(work, "p.deb"), buf);
  execFileSync("ar", ["x", "p.deb"], { cwd: work });
  const data = readdirSync(work).find((f) => f.startsWith("data.tar"));
  if (!data) throw new Error(`${name}: no data.tar in the .deb`);
  mkdirSync(join(work, "root"));
  execFileSync("tar", ["-xf", join(work, data), "-C", join(work, "root")]);
  const lib = join(work, "root/usr/lib/postgresql/18/lib/vector.so");
  const ext = join(work, "root/usr/share/postgresql/18/extension");
  if (!existsSync(lib)) throw new Error(`${name}: vector.so missing`);
  const out = join(root, "prebuilt", target);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, "lib"), { recursive: true });
  mkdirSync(join(out, "share/extension"), { recursive: true });
  cpSync(lib, join(out, "lib/vector.so"));
  for (const f of readdirSync(ext)) if (f.startsWith("vector")) cpSync(join(ext, f), join(out, "share/extension", f));
  rmSync(work, { recursive: true, force: true });
  console.log(`${target}: ok (${name})`);
}
execFileSync(process.execPath, [join(root, "scripts/sums.mjs")], { stdio: "inherit" });
