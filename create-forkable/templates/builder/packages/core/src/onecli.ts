// The One CLI, the way Builder knows One. Found like
// the coding agents are (PATH, the well-known install dirs, the interactive
// shell), checked with `one --version` and `one --agent whoami`, and driven
// by shelling out. Builder never reads the CLI's credential files: every
// answer comes from a `one --agent ...` process.
//
// What goes through it:
//   - catalog reads for the coding agent's one_* tools: `actions find`,
//     `actions load`, `platforms` (read-only);
//   - the action schemas typed codegen needs. The CLI has no schema verb
//     (2.9.2), so after `actions load` Builder reads the action's row from
//     the CLI's knowledge cache (~/.one/cache/knowledge/<id>.json): docs the
//     CLI just fetched, never a credential;
//   - publish calls (GitHub, Vercel) the builder starts from the Publish
//     dialog, on their own One account: `one flow execute` over a one-step
//     flow file in a private temp dir, so no body or value is ever on a
//     command line another process could read.
//
// The coding agent never reaches any of this directly: its `one` shim
// refuses, and `actions execute` is never offered to a turn.

import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { env } from "./brand.js";
import { fileForAction, type KnowledgeRow } from "./fixtures.js";
import type { CatalogPlatform, OneCliStatus } from "./types.js";

export type { OneCliStatus };

/** Runs `one` with these arguments. Tests inject a fake. */
export type OneRunner = (bin: string, args: string[], o: { timeoutMs: number; cwd?: string; env: NodeJS.ProcessEnv }) => Promise<{ code: number; stdout: string; stderr: string }>;

export const runOne: OneRunner = (bin, args, o) =>
  new Promise((resolve) => {
    const child = spawn(bin, args, { cwd: o.cwd, env: o.env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), o.timeoutMs);
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout: "", stderr: e.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout: out, stderr: err });
    });
  });

/** A private Node for the One CLI, used when present and the system Node is one the CLI refuses. */
export const ONE_NODE_DIR = join(homedir(), ".local", "share", "node22-dl", "node-v22.23.4-darwin-arm64", "bin");

export const ONE_INSTALL_HINT = "npm install -g @withone/cli";


export class OneCliError extends Error {
  constructor(
    message: string,
    readonly code: "not_installed" | "signed_out" | "failed" | "not_found" | "refused",
  ) {
    super(message);
  }
}

/** A catalog pick as `actions find` answers it. */
export interface CliPick {
  actionId: string;
  title: string;
  method: string;
  path: string;
  knowledge?: string;
}

/** What a run answered, in @withone/connect's RunActionResult shape. */
export interface CliRunResult {
  status: number;
  ok: boolean;
  blockedByGrant: boolean;
  data: unknown;
}

export interface CliRunInput {
  platform: string;
  actionId: string;
  title?: string;
  pathParams?: Record<string, string | number | boolean>;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface OneCliOptions {
  /** Where flow files for publish calls are made (a private dir under BUILDER_HOME/state). */
  tmpRoot: string;
  runner?: OneRunner;
  /** Resolves the binary. Default: BUILDER_ONE_BIN, else @builder/harness resolveBin("one"). */
  resolve?: () => Promise<string | null>;
  /** The CLI's knowledge cache. Default BUILDER_ONE_CACHE_DIR, else ~/.one/cache/knowledge. */
  cacheDir?: string;
  log?: (line: string) => void;
}

const STATUS_TTL = 60_000;

function parseJson<T>(text: string): T | null {
  const t = text.trim();
  if (!t) return null;
  try {
    return JSON.parse(t) as T;
  } catch {
    // Some versions print a line before the JSON; take the last JSON object.
    const i = t.lastIndexOf("\n{");
    if (i >= 0) {
      try {
        return JSON.parse(t.slice(i + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

const firstLine = (s: string): string => s.trim().split("\n").find((l) => l.trim())?.trim().slice(0, 300) ?? "";

export class OneCli {
  private cached: OneCliStatus | null = null;
  private login: ChildProcess | null = null;
  private platformsCache: { at: number; list: CatalogPlatform[] } | null = null;

  constructor(private o: OneCliOptions) {}

  private runner(): OneRunner {
    return this.o.runner ?? runOne;
  }

  private async bin(): Promise<string | null> {
    const forced = process.env[env("ONE_BIN")];
    if (forced) return existsSync(forced) ? forced : null;
    if (this.o.resolve) return this.o.resolve();
    const { resolveBin } = await import("@builder/harness");
    return resolveBin("one");
  }

  /** The CLI's env: the user's own, with the Node it needs first on PATH. Nothing of Builder's. */
  private childEnv(): { env: NodeJS.ProcessEnv; node: string | null } {
    const e: NodeJS.ProcessEnv = { ...process.env };
    for (const k of Object.keys(e)) if (k.startsWith(env(""))) delete e[k];
    const node = existsSync(ONE_NODE_DIR) ? ONE_NODE_DIR : null;
    const dirs = [node, dirname(process.execPath), e.PATH ?? ""].filter(Boolean);
    e.PATH = [...new Set(dirs.join(":").split(":"))].join(":");
    return { env: e, node };
  }

  private async run(args: string[], o: { timeoutMs?: number; cwd?: string } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
    const bin = await this.bin();
    if (!bin) throw new OneCliError(`The One CLI is not installed. Install it with ${ONE_INSTALL_HINT}, then sign in.`, "not_installed");
    const { env: e } = this.childEnv();
    return this.runner()(bin, args, { timeoutMs: o.timeoutMs ?? 45_000, cwd: o.cwd, env: e });
  }

  /** Path, version and the signed-in account, cached a minute. */
  async status(force = false): Promise<OneCliStatus> {
    if (!force && this.cached && Date.now() - Date.parse(this.cached.checkedAt) < STATUS_TTL) return { ...this.cached, loginRunning: Boolean(this.login) };
    const base: OneCliStatus = { installed: false, path: null, version: null, node: this.childEnv().node, signedIn: false, account: null, mode: "cli", error: null, checkedAt: new Date().toISOString(), loginRunning: Boolean(this.login), installHint: ONE_INSTALL_HINT };
    const bin = await this.bin().catch(() => null);
    if (!bin) {
      this.cached = { ...base, error: `The One CLI is not installed. Install it with ${ONE_INSTALL_HINT}.` };
      return this.cached;
    }
    const v = await this.run(["--version"], { timeoutMs: 15_000 }).catch(() => null);
    const version = v && v.code === 0 ? (/\d+\.\d+\.\d+[\w.-]*/.exec(v.stdout)?.[0] ?? null) : null;
    if (!version) {
      this.cached = { ...base, installed: true, path: bin, error: `The One CLI at ${bin} did not start${v?.stderr ? `: ${firstLine(v.stderr)}` : ""}.` };
      return this.cached;
    }
    const w = await this.run(["--agent", "whoami"], { timeoutMs: 20_000 }).catch(() => null);
    const who = w ? parseJson<{ user?: { name?: string | null; email?: string | null } | null; error?: string }>(w.stdout) : null;
    const signedIn = Boolean(w && w.code === 0 && who?.user);
    this.cached = {
      ...base,
      installed: true,
      path: bin,
      version,
      signedIn,
      account: signedIn ? { name: who!.user!.name?.trim() || null, email: who!.user!.email?.trim().toLowerCase() || null } : null,
      error: signedIn ? null : "The One CLI is not signed in. Sign in to give Builder One's catalog and your connections.",
    };
    return this.cached;
  }

  /** `one login`: opens One's consent in the browser. The status turns signed in once it finishes. */
  async startLogin(): Promise<OneCliStatus> {
    if (this.login) return this.status();
    const bin = await this.bin();
    if (!bin) throw new OneCliError(`The One CLI is not installed. Install it with ${ONE_INSTALL_HINT}.`, "not_installed");
    const { env: e } = this.childEnv();
    const child = spawn(bin, ["login"], { env: e, stdio: "ignore", detached: false });
    this.login = child;
    const done = () => {
      this.login = null;
      this.cached = null;
    };
    child.on("close", done);
    child.on("error", done);
    setTimeout(() => {
      if (this.login === child) child.kill("SIGTERM");
    }, 10 * 60_000).unref();
    this.o.log?.("one cli: login started in the browser");
    return { ...(await this.status(true)), loginRunning: true };
  }

  private async needSignedIn(): Promise<void> {
    const s = await this.status();
    if (!s.installed) throw new OneCliError(s.error ?? "The One CLI is not installed.", "not_installed");
    if (!s.signedIn) throw new OneCliError("The One CLI is not signed in. The builder can sign in from Settings, One CLI.", "signed_out");
  }

  private async agentJson<T>(args: string[], timeoutMs?: number): Promise<T> {
    await this.needSignedIn();
    const r = await this.run(["--agent", ...args], { timeoutMs });
    const j = parseJson<T & { error?: unknown }>(r.stdout);
    if (r.code !== 0 || !j) {
      const msg = (j && typeof j.error === "string" ? j.error : "") || firstLine(r.stderr) || firstLine(r.stdout) || `exit ${r.code}`;
      throw new OneCliError(`The One CLI answered: ${msg}`, /not found|no action/i.test(msg) ? "not_found" : "failed");
    }
    return j;
  }

  /** `actions find <platform> <intent> --type knowledge`: picks first, alternatives after. */
  async find(platform: string, intent: string, task?: string): Promise<{ picks: CliPick[] }> {
    const j = await this.agentJson<{ answers?: { selected?: CliPick[]; alsoSelected?: CliPick[]; alternatives?: CliPick[] }[] }>(
      ["actions", "find", platform, intent, "--task", task || intent, "--type", "knowledge"],
      90_000,
    );
    const a = j.answers?.[0];
    const seen = new Set<string>();
    const picks: CliPick[] = [];
    for (const p of [...(a?.selected ?? []), ...(a?.alsoSelected ?? []), ...(a?.alternatives ?? [])]) {
      if (!p?.actionId || seen.has(p.actionId)) continue;
      seen.add(p.actionId);
      picks.push({ actionId: p.actionId, title: String(p.title ?? ""), method: String(p.method ?? "").toUpperCase(), path: String(p.path ?? ""), ...(p.knowledge ? { knowledge: p.knowledge } : {}) });
    }
    return { picks };
  }

  /** `actions load <id> --full`, plus the schema and tags from the CLI's knowledge cache. */
  async knowledge(actionId: string, platformHint?: string): Promise<KnowledgeRow> {
    const j = await this.agentJson<{ loaded?: { actionId: string; title?: string; method?: string; path?: string; knowledge?: string }[] }>(["actions", "load", actionId, "--full"], 60_000);
    const row = j.loaded?.find((x) => x.actionId === actionId) ?? j.loaded?.[0];
    if (!row?.knowledge) throw new OneCliError(`One's catalog has no action with the id ${actionId}. Use an id from one_find_actions.`, "not_found");
    const cache = this.cacheRow(actionId);
    return {
      _id: actionId,
      connectionPlatform: cache?.connectionPlatform || platformHint || "",
      title: String(row.title ?? cache?.title ?? actionId),
      method: String(row.method ?? cache?.method ?? "GET").toUpperCase(),
      path: String(row.path ?? cache?.path ?? ""),
      tags: cache?.tags ?? [],
      knowledge: row.knowledge,
      ioSchema: cache?.ioSchema ?? null,
    };
  }

  /** The CLI's cached knowledge row for an action (docs it fetched; no credential lives here). */
  cacheRow(actionId: string): Partial<KnowledgeRow> | null {
    const dir = this.o.cacheDir ?? process.env[env("ONE_CACHE_DIR")] ?? join(homedir(), ".one", "cache", "knowledge");
    const p = join(dir, fileForAction(actionId));
    if (!existsSync(p)) return null;
    try {
      const j = JSON.parse(readFileSync(p, "utf8")) as { data?: Partial<KnowledgeRow> & { _id?: string } };
      const d = j.data;
      if (!d || (d._id && d._id !== actionId)) return null;
      return {
        connectionPlatform: typeof d.connectionPlatform === "string" ? d.connectionPlatform : undefined,
        title: typeof d.title === "string" ? d.title : undefined,
        method: typeof d.method === "string" ? d.method : undefined,
        path: typeof d.path === "string" ? d.path : undefined,
        tags: Array.isArray(d.tags) ? d.tags.map(String) : [],
        ioSchema: d.ioSchema && typeof d.ioSchema === "object" ? d.ioSchema : null,
      };
    } catch {
      return null;
    }
  }

  /** `platforms`: every catalog platform with its conn_def id and logo, cached a day. */
  async platforms(): Promise<CatalogPlatform[]> {
    if (this.platformsCache && Date.now() - this.platformsCache.at < 24 * 3_600_000) return this.platformsCache.list;
    const j = await this.agentJson<{ platforms?: Record<string, unknown>[] }>(["platforms"], 60_000);
    const list = (j.platforms ?? [])
      .map((r) => ({
        platform: String(r.platform ?? ""),
        name: String(r.name ?? r.title ?? r.platform ?? ""),
        connDefId: typeof r.id === "string" ? r.id : null,
        image: typeof r.image === "string" ? r.image : null,
        category: typeof r.category === "string" ? r.category : null,
      }))
      .filter((p) => p.platform);
    if (list.length) this.platformsCache = { at: Date.now(), list };
    return list;
  }

  /** `list`: the builder's own connections. Keys stay in this process (publish only). */
  async connections(): Promise<{ platform: string; key: string; state: string | null; access: string | null }[]> {
    const j = await this.agentJson<{ connections?: { platform?: string; key?: string; state?: string; access?: { policy?: string } }[] }>(["list", "--limit", "200"], 30_000);
    return (j.connections ?? []).filter((c) => c.platform && c.key).map((c) => ({ platform: c.platform!, key: c.key!, state: c.state ?? null, access: c.access?.policy ?? null }));
  }

  /**
   * One action on the builder's own One account, for publish. The call goes
   * in a one-step flow file (mode 0600, in a 0700 dir that is removed right
   * after), never on a command line. Text with "{{" is refused: the flow
   * runner would read it as a template.
   */
  async execute(i: CliRunInput): Promise<CliRunResult> {
    await this.needSignedIn();
    const step: Record<string, unknown> = { platform: i.platform, actionId: i.actionId, connection: { platform: i.platform } };
    if (i.body !== undefined) step.data = i.body;
    if (i.pathParams && Object.keys(i.pathParams).length) step.pathVars = i.pathParams;
    if (i.query && Object.keys(i.query).length) step.queryParams = i.query;
    if (i.headers && Object.keys(i.headers).length) step.headers = i.headers;
    const flow = { key: "builder-publish-call", name: i.title || "Publish call", description: "One call Builder's Publish dialog started. Made and removed by Builder.", version: "1", inputs: {}, steps: [{ id: "call", name: i.title || "Call", type: "action", action: step }] };
    const text = JSON.stringify(flow);
    if (text.includes("{{")) throw new OneCliError("This call carries text with {{ in it, which One's flow runner reads as a template, so it was not sent.", "refused");
    mkdirSync(this.o.tmpRoot, { recursive: true, mode: 0o700 });
    const dir = mkdtempSync(join(this.o.tmpRoot, "call-"));
    chmodSync(dir, 0o700);
    try {
      const file = join(dir, "flow.json");
      const out = join(dir, "out.json");
      writeFileSync(file, text, { mode: 0o600 });
      const r = await this.run(["--agent", "flow", "execute", file, "--output-file", out], { timeoutMs: 180_000, cwd: dir });
      const raw = existsSync(out) ? readFileSync(out, "utf8") : r.stdout;
      return readFlowResult(parseJson<Record<string, unknown>>(raw), r.code, firstLine(r.stderr));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/**
 * A flow run's answer for its one step, read loosely: the CLI's result
 * shape is not documented field by field, so status and data are looked for
 * where it puts them (`steps.call.response`, `results[0]`). Unverified on a
 * live run (no publish was made while building this).
 */
export function readFlowResult(j: Record<string, unknown> | null, code: number, stderr: string): CliRunResult {
  const steps = obj(j?.steps);
  const call = obj(steps.call ?? (Array.isArray(j?.results) ? (j!.results as unknown[])[0] : undefined));
  const res = obj(call.response ?? call.output ?? call.result);
  const statusRaw = res.status ?? res.statusCode ?? call.status ?? call.statusCode;
  const err = obj(call.error ?? j?.error);
  const text = `${String(err.message ?? j?.error ?? "")} ${stderr}`;
  const status = typeof statusRaw === "number" ? statusRaw : /\b403\b/.test(text) ? 403 : code === 0 ? 200 : Number(/\b([45]\d\d)\b/.exec(text)?.[1] ?? 502);
  const data = "data" in res ? res.data : "body" in res ? res.body : Object.keys(res).length ? res : (call.output ?? j);
  const blockedByGrant = status === 403 && /not allowed|outside|grant|permission/i.test(`${text} ${JSON.stringify(data ?? "").slice(0, 400)}`);
  return { status, ok: status >= 200 && status < 300 && code === 0, blockedByGrant, data };
}
