// The app database in preview: after a turn changes
// server/db/schema.ts the platform runs drizzle-kit generate, and whenever
// server/db/migrations changed (or before a dev server starts) it applies
// them to the local D1 with wrangler. The agent never runs either: wrangler
// is denied to it and the platform owns the database.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BRAND, env } from "./brand.js";

export interface StepResult {
  ok: boolean;
  ran: boolean;
  output: string;
}

function run(cwd: string, args: string[], timeoutMs: number): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const e = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false", NO_COLOR: "1", FORCE_COLOR: "0" } as Record<string, string>;
    delete e[env("AGENT")];
    for (const k of Object.keys(e)) if (k.startsWith("ONE_") || k.startsWith("CLOUDFLARE_")) delete e[k];
    const child = spawn(process.execPath, args, { cwd, env: e, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const take = (d: Buffer) => {
      out += d.toString();
      if (out.length > 100_000) out = out.slice(-50_000);
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    const t = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ code, out });
    });
    child.on("error", (err) => {
      clearTimeout(t);
      resolve({ code: 1, out: String(err) });
    });
  });
}

const tail = (s: string, n = 12) => s.split("\n").map((l) => l.trimEnd()).filter(Boolean).slice(-n).join("\n");

/** drizzle-kit generate, when the schema changed. */
export async function generateMigrations(cwd: string): Promise<StepResult> {
  const bin = join(cwd, "node_modules", "drizzle-kit", "bin.cjs");
  if (!existsSync(bin) || !existsSync(join(cwd, "drizzle.config.ts"))) return { ok: true, ran: false, output: "" };
  const r = await run(cwd, [bin, "generate"], 60_000);
  return { ok: r.code === 0, ran: true, output: tail(r.out) };
}

function migrationsHash(dir: string): string | null {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  if (!files.length) return null;
  const h = createHash("sha1");
  for (const f of files) h.update(f).update(readFileSync(join(dir, f)));
  return h.digest("hex");
}

/** wrangler d1 migrations apply DB --local, skipped when nothing changed since the last apply. */
export async function applyMigrations(cwd: string, force = false): Promise<StepResult> {
  const dir = join(cwd, "server", "db", "migrations");
  const hash = migrationsHash(dir);
  const bin = join(cwd, "node_modules", "wrangler", "bin", "wrangler.js");
  if (!hash || !existsSync(bin)) return { ok: true, ran: false, output: "" };
  const marker = join(cwd, ".wrangler", `${BRAND.slug}-migrations`);
  if (!force && existsSync(marker) && readFileSync(marker, "utf8").trim() === hash) return { ok: true, ran: false, output: "" };
  const r = await run(cwd, [bin, "d1", "migrations", "apply", "DB", "--local"], 90_000);
  const ok = r.code === 0;
  if (ok) {
    mkdirSync(join(cwd, ".wrangler"), { recursive: true });
    writeFileSync(marker, hash);
  }
  return { ok, ran: true, output: tail(r.out) };
}
