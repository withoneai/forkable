// Pre-publish checks and the security scan. Runs on a clean
// tree of the checkpoint being published. Findings say where and what
// kind, never the value: a secret found is named by its shape ("a Stripe
// live key"), a value from BUILDER_HOME/.env by its variable name.
//
// Block: build or typecheck fails; a secret in committed files or the
// client bundle; a value from BUILDER_HOME/.env anywhere in the upload or
// the bundle; .dev.vars or .env* in the upload set; more than 2,000 files;
// the manifest derived now differs from the committed scopes.json, or any
// BLD001..BLD004; ONE_* read from src/** (client code).
// Warn: BLD005; routes that read or write the app database without
// requireUser(c); CORS * with credentials; sql.raw with interpolation;
// pnpm audit --prod high or critical; the ask widened since the last
// publish; files over 10 MB left out.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { CheckState, ScanFinding, ScanResult } from "../api-types.js";
import { BRAND } from "../brand.js";
import type { KnowledgeRow } from "../fixtures.js";
import { diffManifests, serializeManifest } from "../scopes/ask.js";
import { extractManifest, readInstalled } from "../scopes/extract.js";
import type { Manifest, ManifestAction, VisitorGrant } from "../types.js";
import { VISITORS_OFF, visitorEnvValue, visitorSplit } from "../visitors.js";
import { isBinary, MAX_FILES, type UploadSet } from "./files.js";

// ---- secrets ---------------------------------------------------------------

/** Known credential shapes. The label is what a finding says instead of the value. */
export const SECRET_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\bsk_live_[A-Za-z0-9]{8,}/, label: "a Stripe live secret key (sk_live_)" },
  { re: /\bsk_test_[A-Za-z0-9]{8,}/, label: "a Stripe test secret key (sk_test_)" },
  { re: /\brk_(?:live|test)_[A-Za-z0-9]{8,}/, label: "a Stripe restricted key (rk_)" },
  { re: /\bone_secret_[A-Za-z0-9_-]{8,}/, label: "a One secret (one_secret_)" },
  { re: /\bghp_[A-Za-z0-9]{20,}/, label: "a GitHub token (ghp_)" },
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,}/, label: "a GitHub token (github_pat_)" },
  { re: /\bAKIA[0-9A-Z]{16}\b/, label: "an AWS access key (AKIA)" },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: "a private key block" },
  { re: /\bxox[bp]-[A-Za-z0-9-]{10,}/, label: "a Slack token (xoxb- or xoxp-)" },
];

/** A string assigned to a name like apiKey, secret or token. */
const ASSIGNED = /\b([A-Za-z_$][\w$]*(?:key|secret|token|password)[\w$]*)["']?\s*[:=]\s*["'`]([^"'`\s]{20,200})["'`]/gi;

export function entropy(s: string): number {
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** A long random-looking value, not a path, URL, id from the catalog, or a placeholder. */
function looksRandom(v: string): boolean {
  if (/conn_mod_def::|conn_def::|^https?:|^\/|^\.{0,2}\/|__[A-Z_]+__|[<>{}]|^\$\{/.test(v)) return false;
  if (/^(x+|\*+|0+|your[-_]|replace[-_]|example|changeme|placeholder)/i.test(v)) return false;
  if (!/[0-9]/.test(v) || !/[A-Za-z]/.test(v)) return false;
  return entropy(v) >= 3.5;
}

export interface TextHit {
  line: number;
  label: string;
}

/** Secret-shaped strings in one text. `assigned` also checks high-entropy values assigned to key/secret/token names. */
export function findSecrets(text: string, assigned = true): TextHit[] {
  const hits: TextHit[] = [];
  const lines = text.split("\n");
  lines.forEach((l, i) => {
    const known = SECRET_PATTERNS.filter((p) => p.re.test(l));
    for (const p of known) hits.push({ line: i + 1, label: p.label });
    // One finding per line: a known shape already says what it is.
    if (known.length || !assigned || l.length > 2000) return;
    for (const m of l.matchAll(ASSIGNED)) {
      if (looksRandom(m[2]!)) hits.push({ line: i + 1, label: `a high-entropy value assigned to ${m[1]}` });
    }
  });
  return hits;
}

/** Values from BUILDER_HOME/.env (the builder's Connect app). Only the names ever leave this function's callers. */
export function readEnvValues(file: string): { name: string; value: string }[] {
  if (!existsSync(file)) return [];
  const out: { name: string; value: string }[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const v = m[2]!.trim().replace(/^(['"])(.*)\1$/, "$2");
    // Short values (a mode word, a port) would match everywhere and are not secrets.
    if (v.length >= 8) out.push({ name: m[1]!, value: v });
  }
  return out;
}

const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;

// ---- route checks ----------------------------------------------------------

/** `<any Hono app or sub-router>.get("/path", handler)`; the path and a second argument rule out Map.get("key"). */
const ROUTE = /\b[A-Za-z_$][\w$]*\.(get|post|put|patch|delete|all)\(\s*(["'`])(\/[^"'`]*)\2\s*,/g;

/**
 * Hono routes outside server/one/ whose handler touches the app database
 * (`db(c)`) without `requireUser(c)`: anyone on the internet can read or
 * write that data once it is published.
 */
export function unauthedDbRoutes(file: string, text: string): ScanFinding[] {
  const out: ScanFinding[] = [];
  const starts = [...text.matchAll(ROUTE)];
  starts.forEach((m, i) => {
    const end = i + 1 < starts.length ? starts[i + 1]!.index! : text.length;
    const body = text.slice(m.index!, end);
    if (!/\bdb\(\s*c\s*\)/.test(body)) return;
    if (/\brequireUser\(/.test(body)) return;
    const method = m[1]!.toUpperCase();
    const writes = /\.(insert|update|delete)\(/.test(body);
    out.push({
      code: "unauthed_db_route",
      level: "warn",
      title: `${method} ${m[3]} ${writes ? "writes" : "reads"} the app database without requireUser(c)`,
      detail: "Once published, anyone can call it. Start the handler with requireUser(c), or keep it public on purpose.",
      file,
      line: lineOf(text, m.index!),
    });
  });
  return out;
}

// ---- the file pass ---------------------------------------------------------

export interface FileScanInput {
  set: UploadSet;
  /** Values from BUILDER_HOME/.env. */
  envValues: { name: string; value: string }[];
  /** Files of the built client bundle, relative to the scan dir (dist/client/**). */
  bundle?: { path: string; content: Buffer }[];
}

/** Every check that reads files only (no build, no manifest). Pure, so tests run it on fixtures. */
export function scanFiles(i: FileScanInput): ScanFinding[] {
  const out: ScanFinding[] = [];
  const envHit = (path: string, text: string) => {
    for (const e of i.envValues) {
      const at = text.indexOf(e.value);
      if (at >= 0) {
        out.push({ code: "env_value", level: "block", title: `A value from ${BRAND.homeDir}/.env (${e.name}) is in ${path}`, detail: "That is your Connect app's own setting. Remove it from the app; published apps read their own variables from the host.", file: path, line: lineOf(text, at) });
      }
    }
  };
  if (i.set.files.length > MAX_FILES) {
    out.push({ code: "too_many_files", level: "block", title: `${i.set.files.length} files tracked, the limit is ${MAX_FILES}`, detail: "Check that build output or data files are not committed." });
  }
  for (const s of i.set.skipped) {
    out.push({ code: "large_file", level: "warn", title: `${s.path} is over 10 MB and is left out`, file: s.path });
  }
  for (const f of i.set.files) {
    const base = f.path.split("/").pop()!;
    if (base === ".dev.vars" || /^\.env(\..*)?$/.test(base)) {
      out.push({ code: "dev_vars", level: "block", title: `${f.path} is in the files to upload`, detail: "Local variable files never ship. Remove it from git (it belongs in .gitignore).", file: f.path });
    }
    if (isBinary(f.content)) continue;
    const text = f.content.toString("utf8");
    const lock = /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/.test(f.path);
    for (const h of findSecrets(text, !lock)) {
      out.push({ code: "secret", level: "block", title: `Holds ${h.label}`, detail: "Secrets never go in code. Remove it, rotate it with the provider, and read it from a grant instead.", file: f.path, line: h.line });
    }
    envHit(f.path, text);
    if (f.path.startsWith("src/")) {
      const m = /\bONE_[A-Z][A-Z_]*\b/.exec(text);
      if (m) out.push({ code: "one_env_client", level: "block", title: `Client code reads ${m[0]} (${f.path})`, detail: "ONE_* settings belong to the server. The browser must never see them.", file: f.path, line: lineOf(text, m.index) });
    }
    if (/\.(ts|tsx|js|mjs)$/.test(f.path)) {
      if (f.path.startsWith("server/") && !f.path.startsWith("server/one/")) out.push(...unauthedDbRoutes(f.path, text));
      const cors = /\bcors\(\s*\{[^}]*origin\s*:\s*["'`]\*["'`][^}]*credentials\s*:\s*true/s.exec(text) ?? /\bcors\(\s*\{[^}]*credentials\s*:\s*true[^}]*origin\s*:\s*["'`]\*["'`]/s.exec(text);
      const corsHeader = /Access-Control-Allow-Origin["'`]\s*,\s*["'`]\*["'`]/.exec(text);
      if (cors || (corsHeader && /Access-Control-Allow-Credentials/.test(text))) {
        const at = (cors ?? corsHeader)!.index;
        out.push({ code: "cors", level: "warn", title: `CORS allows any origin with credentials (${f.path})`, detail: "Any site could call this API as a signed-in user. Name the origins instead of *.", file: f.path, line: lineOf(text, at) });
      }
      const raw = /\bsql\.raw\(\s*`[^`]*\$\{/.exec(text);
      if (raw) out.push({ code: "sql_raw", level: "warn", title: `sql.raw with an interpolated value (${f.path})`, detail: "That is how SQL injection happens. Use the sql`` template or the query builder, which bind values.", file: f.path, line: lineOf(text, raw.index) });
    }
  }
  for (const b of i.bundle ?? []) {
    if (isBinary(b.content)) continue;
    const text = b.content.toString("utf8");
    // Minified code: known shapes only; entropy on a bundle is noise.
    for (const h of findSecrets(text, false)) {
      out.push({ code: "secret", level: "block", title: `The client bundle (${b.path}) holds ${h.label}`, detail: "Everything in the bundle is public. Remove it from client code.", file: b.path, line: h.line });
    }
    envHit(b.path, text);
  }
  return out;
}

// ---- manifest --------------------------------------------------------------

export interface ManifestCheck {
  findings: ScanFinding[];
  manifest: Manifest;
  hash: string;
  matches: boolean;
  widened: string[];
}

export const manifestHash = (m: Manifest): string => createHash("sha256").update(serializeManifest(m)).digest("hex");

/** Derive the manifest from the clean tree and compare it with the scopes.json committed at that sha. */
export function checkManifest(o: {
  dir: string;
  knowledge: (actionId: string) => KnowledgeRow | null;
  connDef: (platform: string) => string | null;
  lastPublished: Manifest | null;
  describe?: (a: ManifestAction) => string;
}): ManifestCheck {
  const installed = readInstalled(o.dir, BRAND.projectDir);
  const r = extractManifest({ dir: o.dir, installed, knowledge: o.knowledge, connDef: o.connDef });
  const findings: ScanFinding[] = [];
  for (const i of r.issues) {
    findings.push({ code: i.code, level: i.code === "BLD005" ? "warn" : "block", title: `${i.code} ${i.message}`, file: i.file, line: i.line });
  }
  const scopesFile = join(o.dir, BRAND.projectDir, "scopes.json");
  const committedText = existsSync(scopesFile) ? readFileSync(scopesFile, "utf8") : null;
  const derived = serializeManifest(r.manifest);
  let matches = committedText !== null && normalize(committedText) === normalize(derived);
  if (committedText === null && r.manifest.actions.length === 0) matches = true;
  if (!matches) {
    findings.push({
      code: "manifest_drift",
      level: "block",
      title: committedText === null ? `${BRAND.projectDir}/scopes.json is missing at this version` : `The code calls something ${BRAND.projectDir}/scopes.json does not list, or the other way round`,
      detail: "The consent screen would not match the code. Ask the agent to refresh the manifest (any turn rewrites it), then publish again.",
      file: `${BRAND.projectDir}/scopes.json`,
    });
  }
  const describe = o.describe ?? ((a: ManifestAction) => `${a.platform} · ${a.title} (${a.level})`);
  const widened = o.lastPublished ? diffManifests(o.lastPublished, r.manifest, describe).lines : [];
  if (widened.length) {
    findings.push({ code: "widened", level: "warn", title: "This version asks for more than the last publish", detail: widened.join(", ") });
  }
  return { findings, manifest: r.manifest, hash: manifestHash(r.manifest), matches, widened };
}

/**
 * Visitors on the owner's grant: an owner-run action the builder has not
 * allowed blocks (published, it would refuse every visitor); allowed
 * owner-run writes are a warning that names them.
 */
export function visitorFindings(manifest: Manifest, v: VisitorGrant, describe: (a: ManifestAction) => string = (a) => `${a.platform} · ${a.title} (${a.level})`): ScanFinding[] {
  const { allowed, notAllowed } = visitorSplit(manifest, v);
  const out: ScanFinding[] = [];
  for (const a of notAllowed) {
    out.push({
      code: "visitor_not_allowed",
      level: "block",
      title: `Visitors would trigger ${describe(a)} on your grant, and you haven't allowed it`,
      detail: v.enabled
        ? "Tick it in Access, under Runs on your grant for visitors, or ask the agent to put it behind sign-in."
        : "Visitor actions are off for this app. Turn them on for this action in Access, under Runs on your grant for visitors, or ask the agent to put it behind sign-in.",
    });
  }
  const writes = allowed.filter((a) => a.level !== "read");
  if (writes.length) {
    out.push({
      code: "visitor_writes",
      level: "warn",
      title: `Anyone who opens the app can trigger ${writes.length === 1 ? "this write" : "these writes"} on your grant`,
      detail: writes.map(describe).join(", "),
    });
  }
  return out;
}

/** One calls in the code and no One Connect for the app: published, every call would fail and nobody could sign in. */
export function connectOffFinding(manifest: Manifest): ScanFinding {
  const platforms = [...new Set(manifest.actions.map((a) => a.platform))];
  return {
    code: "connect_off",
    level: "block",
    title: `This app calls ${platforms.join(", ")} through One, and One Connect is off for it`,
    detail: "Turn on One Connect in this project's Settings: a new Connect app, a template, or another project's. Or ask the agent to take the One calls out.",
  };
}

const normalize = (s: string) => {
  try {
    const m = JSON.parse(s) as Manifest;
    return serializeManifest({ version: 1, actions: m.actions ?? [], unused: m.unused ?? [] });
  } catch {
    return s.trim();
  }
};

// ---- build, typecheck, audit -----------------------------------------------

interface Ran {
  ok: boolean;
  out: string;
  timedOut: boolean;
}

/** A child with the platform's own variables stripped (no BUILDER_*, no ONE_*), so a build sees what a host would. */
function runNode(cwd: string, args: string[], timeoutMs: number, bin = process.execPath): Promise<Ran> {
  return new Promise((resolve) => {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v === undefined || k.startsWith(BRAND.envPrefix) || k.startsWith("ONE_") || k === "NODE_OPTIONS" || k === "DATABASE_URL" || k === "DATABASE_AUTH_TOKEN") continue;
      env[k] = v;
    }
    env.CI = "1";
    env.NO_COLOR = "1";
    const child = spawn(bin, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let out = "";
    const take = (c: Buffer) => {
      out += c.toString();
      if (out.length > 200_000) out = out.slice(-100_000);
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    let timedOut = false;
    const t = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(t);
      resolve({ ok: false, out: String(e), timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ ok: code === 0 && !timedOut, out, timedOut });
    });
  });
}

const tail = (s: string, n = 6) =>
  s
    .replace(/\u001b\[[0-9;]*m/g, "")
    .trim()
    .split("\n")
    .filter((l) => l.trim())
    .slice(-n)
    .join("\n");

function walk(dir: string, root = dir): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) out.push(...walk(abs, root));
    else if (st.size < 20 * 1024 * 1024) out.push(relative(root, abs));
  }
  return out;
}

export interface ScanOptions {
  /** The clean tree (materialize() output). */
  dir: string;
  set: UploadSet;
  subject: string | null;
  envFile: string;
  knowledge: (actionId: string) => KnowledgeRow | null;
  connDef: (platform: string) => string | null;
  lastPublished: Manifest | null;
  describe?: (a: ManifestAction) => string;
  /** The builder's visitor setting (off when absent). */
  visitors?: VisitorGrant;
  /** One Connect is on for this app (per-project Connect). Off with One calls in the code blocks. */
  oneConnect?: boolean;
  /** Values that must appear in no uploaded file: the app's Connect app secrets and its Environment values. */
  secretValues?: { name: string; value: string }[];
  /** Run vite build and tsc (default true). */
  build?: boolean;
  /** Run pnpm audit --prod; needs the network (default false). */
  audit?: boolean;
  pnpm?: string | null;
  progress?: (step: string, status: "running" | "done" | "failed" | "skipped", detail?: string) => void;
}

export async function runScan(o: ScanOptions): Promise<ScanResult> {
  const t0 = Date.now();
  const p = o.progress ?? (() => {});
  const findings: ScanFinding[] = [];
  const notes: string[] = [];
  let build: CheckState = "skipped";
  let typecheck: CheckState = "skipped";
  let audit: CheckState = "skipped";
  const hasModules = existsSync(join(o.dir, "node_modules"));

  if (o.build !== false && hasModules) {
    p("typecheck", "running");
    const tsc = join(o.dir, "node_modules", "typescript", "bin", "tsc");
    const tc = await runNode(o.dir, [tsc, "--noEmit", "-p", ".", "--pretty", "false"], 120_000);
    typecheck = tc.ok ? "ok" : "failed";
    if (!tc.ok) {
      const first = tc.out.split("\n").find((l) => /error TS\d+/.test(l)) ?? tail(tc.out, 1);
      const m = /^(.+?)\((\d+),\d+\)/.exec(first);
      findings.push({ code: "typecheck", level: "block", title: tc.timedOut ? "pnpm typecheck timed out" : "pnpm typecheck fails", detail: tail(tc.out), file: m?.[1] ?? null, line: m ? Number(m[2]) : null });
    }
    p("typecheck", tc.ok ? "done" : "failed");

    p("build", "running");
    const vite = join(o.dir, "node_modules", "vite", "bin", "vite.js");
    const b = await runNode(o.dir, [vite, "build", "--logLevel", "warn"], 180_000);
    build = b.ok ? "ok" : "failed";
    if (!b.ok) findings.push({ code: "build", level: "block", title: b.timedOut ? "pnpm build timed out" : "pnpm build fails", detail: tail(b.out) });
    p("build", b.ok ? "done" : "failed");
  } else if (o.build !== false) {
    notes.push("Build and typecheck were not run: the project has no node_modules.");
  }

  p("secrets", "running");
  const clientDir = existsSync(join(o.dir, "dist", "client")) ? join(o.dir, "dist", "client") : join(o.dir, "dist");
  const bundle = build === "ok" ? walk(clientDir).map((r) => ({ path: relative(o.dir, join(clientDir, r)), content: readFileSync(join(clientDir, r)) })) : [];
  findings.push(...scanFiles({ set: o.set, envValues: [...readEnvValues(o.envFile), ...(o.secretValues ?? []).filter((v) => v.value.length >= 8)], bundle }));
  const secretCount = findings.filter((f) => f.code === "secret" || f.code === "env_value").length;
  p("secrets", secretCount ? "failed" : "done");

  p("manifest", "running");
  const m = checkManifest({ dir: o.dir, knowledge: o.knowledge, connDef: o.connDef, lastPublished: o.lastPublished, describe: o.describe });
  findings.push(...m.findings);
  const visitors = o.visitors ?? VISITORS_OFF;
  findings.push(...visitorFindings(m.manifest, visitors, o.describe));
  if (o.oneConnect === false && m.manifest.actions.length) findings.push(connectOffFinding(m.manifest));
  p("manifest", m.matches ? "done" : "failed");

  if (o.audit && hasModules && o.pnpm) {
    p("audit", "running");
    const a = await runNode(o.dir, ["audit", "--prod", "--json"], 25_000, o.pnpm);
    try {
      const j = JSON.parse(a.out.slice(a.out.indexOf("{"))) as { metadata?: { vulnerabilities?: Record<string, number> } };
      const v = j.metadata?.vulnerabilities ?? {};
      const bad = (v.high ?? 0) + (v.critical ?? 0);
      audit = "ok";
      if (bad) findings.push({ code: "audit", level: "warn", title: `pnpm audit --prod: ${v.critical ?? 0} critical, ${v.high ?? 0} high`, detail: "Update the packages it names before you publish, or publish knowing it." });
      p("audit", "done");
    } catch {
      notes.push(a.timedOut ? "pnpm audit did not answer in time." : "pnpm audit could not run (it needs the network).");
      p("audit", "skipped");
    }
  } else {
    notes.push("pnpm audit not run.");
  }

  const blocks = findings.filter((f) => f.level === "block");
  const warns = findings.filter((f) => f.level === "warn");
  return {
    sha: o.set.sha,
    shortSha: o.set.sha.slice(0, 7),
    subject: o.subject,
    ok: blocks.length === 0,
    blocks,
    warns,
    checks: { build, typecheck, secrets: secretCount, manifest: m.matches ? "matches" : "drift", audit },
    notes,
    files: o.set.files.length,
    bytes: o.set.bytes,
    manifestHash: m.hash,
    widened: m.widened,
    visitorActions: visitorEnvValue(m.manifest, visitors),
    ms: Date.now() - t0,
    at: new Date().toISOString(),
  };
}

/** "build ok, typecheck ok, no secrets, manifest matches code" */
export function scanLine(r: ScanResult): string {
  const parts = [
    `build ${r.checks.build === "ok" ? "ok" : r.checks.build}`,
    `typecheck ${r.checks.typecheck === "ok" ? "ok" : r.checks.typecheck}`,
    r.checks.secrets ? `${r.checks.secrets} secret${r.checks.secrets === 1 ? "" : "s"} found` : "no secrets",
    r.checks.manifest === "matches" ? "manifest matches code" : "manifest drifts from code",
  ];
  return parts.join(", ");
}
