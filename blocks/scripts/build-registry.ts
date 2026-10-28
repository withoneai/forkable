import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

// registry/<block>/block.json -> gallery/public/r/<block>.json, with every
// file's source inlined, plus r/index.json. This is what
// `npx @withone/forkable add` fetches from forkable.dev/blocks/r/.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY = join(ROOT, "registry");
const OUT = join(ROOT, "gallery/public/r");

interface FileSpec { from: string; to: string; alsoTo?: string }
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const index: unknown[] = [];
for (const dir of readdirSync(REGISTRY).sort()) {
  const metaPath = join(REGISTRY, dir, "block.json");
  if (!existsSync(metaPath)) continue;
  const meta = JSON.parse(readFileSync(metaPath, "utf8"));
  const files = [...(meta.files as FileSpec[]), ...((meta.fixtures as FileSpec[] | undefined) ?? [])].map((f) => ({
    // registry-relative, normalized ("../fixtures/x.json" from gmail/ is "fixtures/x.json" at the root)
    from: posix.normalize(f.from),
    to: f.to,
    ...(f.alsoTo ? { alsoTo: f.alsoTo } : {}),
    content: readFileSync(join(REGISTRY, f.from), "utf8"),
  }));
  const { fixtures: _f, ...rest } = meta;
  writeFileSync(join(OUT, `${meta.name}.json`), JSON.stringify({ ...rest, files }, null, 2));
  index.push({ name: meta.name, title: meta.title, description: meta.description, kind: meta.kind, group: meta.group ?? null, requires: meta.requires });
}
writeFileSync(join(OUT, "index.json"), JSON.stringify(index, null, 2));
console.log(`registry: ${index.length} items in gallery/public/r`);
