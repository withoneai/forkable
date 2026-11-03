// `pnpm build:vercel`: the Vercel build, in the Build Output API layout
// (.vercel/output), so nothing depends on Vercel guessing the framework:
//   1. libSQL migrations, when DATABASE_URL is set (tools/migrate-libsql.mjs)
//   2. the React app: vite build --mode vercel -> dist/client -> static/
//   3. the API: api/index.ts with a Node wrapper (tools/vercel-node.mjs),
//      bundled by esbuild into one Node.js Vercel Function
//   4. routes: /api/* to the function, files, then the SPA fallback
// Reads no secret itself; the migration step gets the database token from
// the Vercel build environment, where the builder set it.

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, ".vercel", "output");
const run = (args) => {
  const r = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

if (process.env.DATABASE_URL) run([join(root, "tools", "migrate-libsql.mjs")]);
else console.log("build:vercel: no DATABASE_URL, skipping migrations");

run([join(root, "node_modules", "vite", "bin", "vite.js"), "build", "--mode", "vercel"]);

rmSync(out, { recursive: true, force: true });
cpSync(join(root, "dist", "client"), join(out, "static"), { recursive: true });

const fn = join(out, "functions", "api.func");
mkdirSync(fn, { recursive: true });
await build({
  entryPoints: [join(root, "tools", "vercel-node.mjs")],
  outfile: join(fn, "index.mjs"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  alias: { "@": join(root, "src") },
  // Some dependencies still call require(); give the ESM bundle one.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "warning",
});
writeFileSync(join(fn, ".vc-config.json"), JSON.stringify({ runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs", shouldAddHelpers: false }, null, 2));
writeFileSync(
  join(out, "config.json"),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: "^/api(?:/.*)?$", dest: "/api" },
        { handle: "filesystem" },
        { src: "^/(.*)$", dest: "/index.html" },
      ],
    },
    null,
    2,
  ),
);
console.log("build:vercel: wrote .vercel/output (static, functions/api.func, config.json)");
