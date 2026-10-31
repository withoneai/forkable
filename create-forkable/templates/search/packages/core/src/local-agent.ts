// The local engine: on the user's own computer the assistant and the New profile
// proposal run on the coding agent already installed there (Claude Code, else
// Codex), on the user's own subscription, so the grant needs no Anthropic. Hosted
// (SEARCH_HOSTED=1) there is no such agent and they run on Anthropic through One.
// Detection copies Rill (its packages/core/src/agents.ts): PATH, the well-known
// install dirs a Dock-launched process cannot see, then the login shell.
// Settings, Assistant, "AI engine" picks auto (Claude Code, else Codex, else One),
// claude-code, codex or one (models through One on the grant); SEARCH_LOCAL_ENGINE
// (off|auto|claude-code|codex|one) wins over the setting. Always
// tool-less and never a bypass-permissions flag: the model only reads the prompt
// and writes text, so an item that says "run this command" has nothing to run.

import { execFile, spawnSync } from "node:child_process";
import { accessSync, constants, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CallCtx } from "./ctx.js";
import { recordLedger } from "./ledger.js";

export type LocalCliId = "claude-code" | "codex";
export interface LocalEngine { id: LocalCliId; name: string; bin: string }

const CLIS: { id: LocalCliId; name: string; bin: string }[] = [
  { id: "claude-code", name: "Claude Code", bin: "claude" },
  { id: "codex", name: "Codex", bin: "codex" },
];

export const TIMEOUT_MS = 120_000;

export function isHosted(): boolean {
  return process.env.SEARCH_HOSTED === "1";
}

// ---------- finding the binary (from Rill) ----------

function wellKnownBinDirs(): string[] {
  const home = os.homedir();
  return [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(home, ".local", "bin"),
    path.join(home, ".npm-global", "bin"),
    path.join(home, "n", "bin"),
    path.join(home, ".bun", "bin"),
    path.join(home, ".volta", "bin"),
    path.join(home, ".codex", "bin"),
    ...nvmBinDirs(home),
  ];
}

function nvmBinDirs(home: string): string[] {
  const dir = path.join(home, ".nvm", "versions", "node");
  let versions: string[];
  try {
    versions = readdirSync(dir).filter((v) => /^v\d+\.\d+\.\d+/.test(v)).sort((a, b) => {
      const p = (v: string) => v.slice(1).split(".").map((n) => Number.parseInt(n, 10) || 0);
      const [a1 = 0, a2 = 0, a3 = 0] = p(a), [b1 = 0, b2 = 0, b3 = 0] = p(b);
      return b1 - a1 || b2 - a2 || b3 - a3;
    });
  } catch {
    return [];
  }
  let preferred: string | undefined;
  try {
    const want = readFileSync(path.join(home, ".nvm", "alias", "default"), "utf8").trim().replace(/^v/, "");
    preferred = versions.find((v) => v.slice(1) === want || v.slice(1).startsWith(`${want}.`));
  } catch { /* no default alias */ }
  const ordered = preferred ? [preferred, ...versions.filter((v) => v !== preferred)] : versions;
  return ordered.map((v) => path.join(dir, v, "bin"));
}

function isExecutableFile(p: string): boolean {
  try {
    accessSync(p, constants.X_OK);
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function discover(bin: string): string | null {
  try {
    const res = spawnSync(process.platform === "win32" ? "where" : "which", [bin], { encoding: "utf8", timeout: 5_000 });
    const first = res.status === 0 ? res.stdout.split(/\r?\n/)[0]?.trim() : "";
    if (first) return first;
  } catch { /* which missing: probe directly */ }
  if (process.platform === "win32") return null;
  for (const dir of wellKnownBinDirs()) {
    const cand = path.join(dir, bin);
    if (isExecutableFile(cand)) return cand;
  }
  // last resort: the user's login shell knows their PATH
  try {
    const res = spawnSync((process.env.SHELL ?? "").trim() || "/bin/zsh", ["-ilc", `command -v ${bin}`], { encoding: "utf8", timeout: 4_000, killSignal: "SIGKILL", stdio: ["ignore", "pipe", "ignore"] });
    const out = (res.stdout ?? "").trim().split(/\r?\n/).pop()?.trim() ?? "";
    if (res.status === 0 && path.isAbsolute(out) && isExecutableFile(out)) return out;
  } catch { /* shell missing or timed out */ }
  return null;
}

/** The CLIs never see Search's own secrets or database. */
function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^ONE_|^SEARCH_|^DATABASE_URL$|^PG/.test(k)) continue;
    env[k] = v;
  }
  return env;
}

function exec(bin: string, args: string[], stdin?: string, timeout = TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(bin, args, { timeout, maxBuffer: 8e6, cwd: os.tmpdir(), env: cleanEnv(), killSignal: "SIGKILL" }, (err, stdout, stderr) => {
      if (err) {
        const detail = String(stderr ?? "").trim().split(/\r?\n/).pop() ?? "";
        reject(new Error(`${err.message.split("\n")[0]}${detail ? `: ${detail}` : ""}`.slice(0, 400)));
        return;
      }
      resolve(String(stdout));
    });
    child.stdin?.end(stdin ?? "");
  });
}

// ---------- which engine ----------

/** The saved choice (Settings, Assistant, "AI engine"). */
export type EngineChoice = "auto" | "claude-code" | "codex" | "one";
export const ENGINE_CHOICES: EngineChoice[] = ["auto", "claude-code", "codex", "one"];

/** One local CLI as Settings shows it. signedIn is null when the CLI cannot say. */
export interface CliStatus {
  id: LocalCliId;
  name: string;
  installed: boolean;
  path: string | null;
  signedIn: boolean | null;
  /** Installed and not known to be signed out. */
  ready: boolean;
  /** Why it cannot run, in a few words, when it cannot. */
  reason: string | null;
  /** Models it can be asked for; "default" lets the CLI pick. */
  models: { value: string; label: string }[];
}

/** Settings, Assistant: the saved choice, what overrides it, and what actually runs. */
export interface EngineStatus {
  /** What runs: the local CLI or models through One on the grant. */
  engine: "local" | "one";
  /** The CLI when engine is local. */
  local: { id: LocalCliId; name: string; path: string } | null;
  hosted: boolean;
  /** The saved setting. */
  choice: EngineChoice;
  /** SEARCH_LOCAL_ENGINE when set (off reads as "one"); it wins over the saved choice. */
  override: EngineChoice | null;
  /** The choice after hosted and the env override. */
  effective: EngineChoice;
  /** Why the engine is One: hosted, turned off by env, chosen, nothing found, or the chosen CLI is not ready. */
  reason: "hosted" | "off" | "chosen" | "not_found" | "unavailable" | null;
  /** Each local CLI (empty when hosted). */
  clis: CliStatus[];
}

interface Detected { id: LocalCliId; name: string; bin: string | null; signedIn: boolean | null }

let detected: Promise<Detected[]> | undefined;

async function signedInOf(id: LocalCliId, bin: string): Promise<boolean | null> {
  if (id === "codex") {
    try { await exec(bin, ["login", "status"], undefined, 15_000); return true; } catch { return false; }
  }
  // `claude auth status` prints JSON with loggedIn; an older CLI without it is tried and falls back on failure
  try {
    const out = JSON.parse(await exec(bin, ["auth", "status"], undefined, 15_000)) as { loggedIn?: unknown };
    return typeof out.loggedIn === "boolean" ? out.loggedIn : null;
  } catch (e) {
    return /not logged in|loggedIn":\s*false/i.test(String((e as Error).message)) ? false : null;
  }
}

async function detectAll(): Promise<Detected[]> {
  return Promise.all(CLIS.map(async (c) => {
    const bin = discover(c.bin);
    return { id: c.id, name: c.name, bin, signedIn: bin ? await signedInOf(c.id, bin) : null };
  }));
}

function detectedClis(): Promise<Detected[]> {
  detected ??= detectAll();
  return detected;
}

/** SEARCH_LOCAL_ENGINE as a choice: off/0/false/no is "one"; unset or unknown is null. */
export function envOverride(raw = process.env.SEARCH_LOCAL_ENGINE): EngineChoice | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return null;
  if (/^(off|0|false|no)$/.test(v)) return "one";
  return (ENGINE_CHOICES as string[]).includes(v) ? (v as EngineChoice) : null;
}

/**
 * Which engine runs, from the saved choice, SEARCH_LOCAL_ENGINE, SEARCH_HOSTED and what is ready here.
 * Pure, so the rules are tested on their own: hosted forces One; the env wins over the setting; auto takes
 * Claude Code, else Codex, else One; an explicit CLI that is not ready runs on One.
 */
export function resolveEngine(o: { choice: EngineChoice | undefined; override: EngineChoice | null; hosted: boolean; ready: LocalCliId[] }): { effective: EngineChoice; run: LocalCliId | null; reason: EngineStatus["reason"] } {
  if (o.hosted) return { effective: "one", run: null, reason: "hosted" };
  const effective: EngineChoice = o.override ?? (o.choice && ENGINE_CHOICES.includes(o.choice) ? o.choice : "auto");
  if (effective === "one") return { effective, run: null, reason: o.override === "one" ? "off" : "chosen" };
  if (effective === "auto") {
    const run = CLIS.map((c) => c.id).find((id) => o.ready.includes(id)) ?? null;
    return { effective, run, reason: run ? null : "not_found" };
  }
  return o.ready.includes(effective) ? { effective, run: effective, reason: null } : { effective, run: null, reason: "unavailable" };
}

const isReady = (d: Detected) => !!d.bin && d.signedIn !== false;

/** The local engine plus the models to ask it for, from the user's settings. */
export interface PickedEngine extends LocalEngine { chatModel: string; proposalModel: string }
export interface EngineSettings { engine?: EngineChoice; localChatModel?: string; localProposalModel?: string }

/** The local CLI to run on for these settings, or null: models through One on the grant. */
export async function localEngine(s: EngineSettings = {}): Promise<PickedEngine | null> {
  if (isHosted()) return null;
  const override = envOverride();
  if (override === "one" || (!override && s.engine === "one")) return null;
  const clis = await detectedClis();
  const { run } = resolveEngine({ choice: s.engine, override, hosted: false, ready: clis.filter(isReady).map((d) => d.id) });
  const d = clis.find((x) => x.id === run);
  if (!d?.bin) return null;
  // Claude Code takes the model from Settings; Codex picks its own
  const pick = (m: string | undefined) => (d.id === "claude-code" && m && m !== "default" ? m : "default");
  return { id: d.id, name: d.name, bin: d.bin, chatModel: pick(s.localChatModel), proposalModel: pick(s.localProposalModel) };
}

/** Looks again (after an install or a sign-in). */
export function redetectLocalEngine(): void {
  detected = undefined;
}

const tilde = (p: string) => { const home = os.homedir(); return p.startsWith(home) ? `~${p.slice(home.length)}` : p; };

export async function engineStatus(s: EngineSettings = {}): Promise<EngineStatus> {
  const hosted = isHosted();
  const override = hosted ? null : envOverride();
  const clis = hosted ? [] : await detectedClis();
  const r = resolveEngine({ choice: s.engine, override, hosted, ready: clis.filter(isReady).map((d) => d.id) });
  const d = clis.find((x) => x.id === r.run);
  return {
    engine: d?.bin ? "local" : "one",
    local: d?.bin ? { id: d.id, name: d.name, path: tilde(d.bin) } : null,
    hosted,
    choice: s.engine && ENGINE_CHOICES.includes(s.engine) ? s.engine : "auto",
    override,
    effective: r.effective,
    reason: r.reason,
    clis: clis.map((c) => ({
      id: c.id, name: c.name, installed: !!c.bin, path: c.bin ? tilde(c.bin) : null, signedIn: c.signedIn, ready: isReady(c),
      reason: !c.bin ? "Not installed" : c.signedIn === false ? `Not signed in (run ${c.id === "codex" ? "codex login" : "claude"})` : null,
      models: c.id === "claude-code" ? [{ value: "default", label: "Claude Code default" }, ...claudeModels(c.bin)] : [{ value: "default", label: "Codex default" }],
    })),
  };
}

// ---------- Claude models (from Rill, its packages/core/src/writer/models.ts) ----------
// Claude Code carries Anthropic's catalog in its bundle; there is no `claude models`
// command, so the list is read out of the installed binary the way its /model picker
// does, newest per family, and re-read when the binary changes. Static tiers otherwise.

const FAMILY_ORDER = ["fable", "opus", "sonnet", "haiku"];
const FAMILY_NAME: Record<string, string> = { fable: "Most capable", opus: "Powerful", sonnet: "Balanced", haiku: "Fastest" };
export const STATIC_CLAUDE_MODELS = [
  { value: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
  { value: "claude-opus-5-5", label: "Claude Opus 5.5" },
  { value: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
];
let claudeCache: { stamp: string; models: { value: string; label: string }[] } | null = null;

export function parseClaudeCatalog(text: string): { value: string; label: string }[] {
  const latest = /latest_per_family:\{([^}]*)\}/.exec(text)?.[1] ?? "";
  const byFamily = new Map<string, string>();
  for (const m of latest.matchAll(/([a-z0-9_]+):"([^"]+)"/g)) byFamily.set(m[1]!, m[2]!);
  const names = new Map<string, string>();
  for (const m of text.matchAll(/\{id:"(claude-[^"]+)",family:"[^"]+",display_name:"([^"]+)"/g)) names.set(m[1]!, m[2]!);
  const fams = [...byFamily.keys()].sort((a, b) => ((FAMILY_ORDER.indexOf(a) + 1 || 99) - (FAMILY_ORDER.indexOf(b) + 1 || 99)) || a.localeCompare(b));
  const out: { value: string; label: string }[] = [];
  for (const f of fams) {
    const id = byFamily.get(f)!;
    const name = names.get(id);
    if (name) out.push({ value: id, label: `Claude ${name}${FAMILY_NAME[f] ? `, ${FAMILY_NAME[f]!.toLowerCase()}` : ""}` });
  }
  return out;
}

export function claudeModels(bin: string | null): { value: string; label: string }[] {
  try {
    if (!bin) throw new Error("no claude");
    const real = realpathSync(bin);
    const st = statSync(real);
    const stamp = `${real}:${st.size}:${st.mtimeMs}`;
    if (claudeCache?.stamp === stamp) return claudeCache.models;
    if (st.size > 512 * 1024 * 1024) throw new Error("too large");
    const bytes = readFileSync(real);
    const at = bytes.indexOf("latest_per_family:{");
    if (at < 0) throw new Error("no catalog");
    const models = parseClaudeCatalog(bytes.subarray(Math.max(0, at - 128 * 1024), Math.min(bytes.length, at + 4096)).toString("latin1"));
    if (!models.length) throw new Error("no models");
    claudeCache = { stamp, models };
    return models;
  } catch {
    return STATIC_CLAUDE_MODELS;
  }
}

// ---------- running it ----------

/** Claude ids from Settings go straight through; Codex picks its own model. */
function modelArgs(e: LocalEngine, model: string): string[] {
  if (e.id === "claude-code") return /^claude-|^(opus|sonnet|haiku|fable)$/.test(model) ? ["--model", model] : [];
  return [];
}

async function runOnce(e: LocalEngine, model: string, system: string, user: string): Promise<string> {
  if (e.id === "claude-code") {
    const out = JSON.parse(await exec(e.bin, ["-p", ...modelArgs(e, model), "--tools", "", "--output-format", "json", "--system-prompt", system], user)) as { result?: string; is_error?: boolean };
    if (out.is_error) throw new Error(`Claude Code answered with an error: ${String(out.result ?? "").slice(0, 200)}`);
    return out.result ?? "";
  }
  const stdout = await exec(e.bin, ["exec", "--json", "--sandbox", "read-only", "--skip-git-repo-check", ...modelArgs(e, model), `${system}\n\n---\n\n${user}`]);
  let last: string | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const ev = JSON.parse(line) as { type?: string; item?: { type?: string; text?: string }; msg?: { type?: string; message?: string } };
      if (ev.type === "item.completed" && ev.item?.type === "agent_message" && typeof ev.item.text === "string") last = ev.item.text;
      else if (ev.msg?.type === "agent_message" && typeof ev.msg.message === "string") last = ev.msg.message;
    } catch { /* not JSON */ }
  }
  if (last === null) throw new Error("Codex produced no answer");
  return last;
}

/** One tool-less completion on the local CLI, with one Activity row (platform claude-code or codex). */
export async function runLocal(call: CallCtx, e: LocalEngine, o: { model: string; system: string; user: string; summary: string }): Promise<string> {
  const started = Date.now();
  let text: string | null = null;
  let error: unknown = null;
  try { text = await runOnce(e, o.model, o.system, o.user); } catch (err) { error = err; }
  const row = await recordLedger(call.db, {
    userId: call.userId, sourceId: null, actor: call.actor, clientId: call.clientId ?? null,
    platform: e.id, action: "complete", actionId: `local::${e.id}`, method: "EXEC", path: e.bin,
    mode: call.mode, level: "read", status: error ? 0 : 200, ok: !error, blockedByGrant: false, refusal: null,
    ms: Date.now() - started, summary: `${o.summary} (on this computer)`, note: error ? String((error as Error).message ?? error).slice(0, 300) : null,
  });
  try { call.emit?.({ type: "ledger", row }); } catch { /* listener errors never fail a call */ }
  if (error || text === null) throw error ?? new Error(`${e.name} failed`);
  return text;
}

/** First JSON object in a model's text (fenced or bare). */
export function jsonFrom(text: string): unknown {
  // a fenced block, the whole answer, then first { to last }: the first that parses wins
  const tries = [...text.matchAll(/```(?:json)?\s*\n?([\s\S]*?)```/g)].map((m) => m[1]!);
  tries.push(text.trim(), text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  for (const t of tries) { try { return JSON.parse(t); } catch { /* next */ } }
  throw new SyntaxError("no JSON object in the answer");
}
