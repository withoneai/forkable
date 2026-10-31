// Resolves the committed pgvector build for this platform and copies it into the
// app's data home, so the path stays stable across reinstalls and npx cache moves.
// Postgres then loads it with two flags (see postgresFlags below), no node_modules writes.

import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PGVECTOR_VERSION = "0.8.7";
export const PG_MAJOR = 18;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function platformTarget(platform = process.platform, arch = process.arch): string | null {
  if (platform === "darwin") return "darwin-universal";
  if (platform === "linux" && (arch === "x64" || arch === "arm64")) return `linux-${arch}`;
  return null;
}

function expectedSums(): Map<string, string> {
  const m = new Map<string, string>();
  const f = join(ROOT, "SHA256SUMS");
  if (!existsSync(f)) return m;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    const [sum, rel] = line.trim().split(/\s+/);
    if (sum && rel) m.set(rel, sum);
  }
  return m;
}

/**
 * Returns the extension root to pass to postgres (it holds `lib/` and
 * `share/extension/`), or null when this platform has no build (keyword-only).
 */
export function resolvePgvector(home: string, log: (line: string) => void = () => {}): string | null {
  const target = platformTarget();
  if (!target) {
    log(`Semantic search is off: no pgvector build for ${process.platform}-${process.arch}`);
    return null;
  }
  const dest = join(home, "pg-ext", `vector-${PGVECTOR_VERSION}-pg${PG_MAJOR}`);
  const libName = target.startsWith("darwin") ? "vector.dylib" : "vector.so";
  if (existsSync(join(dest, "share/extension/vector.control")) && existsSync(join(dest, "lib", libName))) return dest;
  const src = join(ROOT, "prebuilt", target);
  const lib = join(src, "lib", libName);
  if (!existsSync(lib)) {
    log(`Semantic search is off: ${target} build missing from @search/pgvector`);
    return null;
  }
  const want = expectedSums().get(`prebuilt/${target}/lib/${libName}`);
  const got = createHash("sha256").update(readFileSync(lib)).digest("hex");
  if (want && want !== got) {
    log(`Semantic search is off: ${libName} checksum mismatch`);
    return null;
  }
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp-${process.pid}`;
  rmSync(tmp, { recursive: true, force: true });
  cpSync(src, tmp, { recursive: true });
  try {
    renameSync(tmp, dest);
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    if (!existsSync(join(dest, "share/extension/vector.control"))) throw e;
  }
  return dest;
}

/** The postgres flags that load the extension from `extRoot` (PG 18+). */
export function postgresFlags(extRoot: string | null): string[] {
  if (!extRoot) return [];
  return ["-c", `extension_control_path=$system:${extRoot}/share`, "-c", `dynamic_library_path=$libdir:${extRoot}/lib`];
}
