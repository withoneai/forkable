// The turn engine (CONTRACT 10):
// queued -> running -> settling -> verifying -> (fixing n) -> done | failed | cancelled.
// Owns harness dispatch, the event log (turn_events is the ring buffer a
// late SSE client replays), checkpoints per turn and the auto-fix loop.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";
import type { Harness, HarnessEvent, HarnessId, Turn as HarnessTurn, TurnInput, TurnResult } from "@builder/harness/types";
import { ZERO_USAGE } from "@builder/harness/types";
import { isResumeFailure } from "@builder/harness";
import * as autofix from "./autofix.js";
import { BRAND, env, previewUrl, SERVER_ORIGIN } from "./brand.js";
import type { Bus } from "./bus.js";
import type { Checkpoints } from "./checkpoints.js";
import type { Db } from "./db/client.js";
import { turnEvents, turns } from "./db/schema.js";
import { installPackages, type DevServers } from "./devserver.js";
import { applyMigrations, generateMigrations } from "./d1.js";
import { parseTsc, type ErrorStore } from "./errors.js";
import * as git from "./git.js";
import { visitorSplit } from "./visitors.js";
import type { Home } from "./home.js";
import { newId, newToken, uuid } from "./ids.js";
import { stopAgentProcesses } from "./processes.js";
import { handoff, planPrompt, systemAppend, userPrompt } from "./prompts.js";
import type { ShimPaths } from "./shims.js";
import type { CatalogService } from "./catalog/service.js";
import type { ScopeService } from "./scopes/service.js";
import type { EnvService } from "./envservice.js";
import { ACTIVE_STATUSES, type Checkpoint, type FeedEvent, type ProjectError, type Selection, type Turn, type TurnKind, type TurnStatus } from "./types.js";
import type { ProjectRow, Workspace } from "./workspace.js";

type TurnRow = typeof turns.$inferSelect;

export function toTurn(r: TurnRow): Turn {
  return {
    id: r.id,
    projectId: r.projectId,
    kind: r.kind as TurnKind,
    parentTurnId: r.parentTurnId,
    fixAttempt: r.fixAttempt,
    prompt: r.prompt,
    selections: r.selections ?? [],
    harness: r.harness as HarnessId,
    model: r.model,
    sessionId: r.sessionId,
    status: r.status as TurnStatus,
    exit: (r.exit as Turn["exit"]) ?? null,
    error: r.error,
    usage: r.usage ?? ZERO_USAGE,
    costUsd: r.costUsd,
    startedAt: r.startedAt?.toISOString() ?? null,
    endedAt: r.endedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    checkpointSha: r.checkpointSha,
    text: r.text,
  };
}

export interface EngineOptions {
  db: Db;
  bus: Bus;
  home: Home;
  workspace: Workspace;
  checkpoints: Checkpoints;
  errors: ErrorStore;
  shims: ShimPaths;
  harness: (id: HarnessId) => Harness;
  /** fixtures/replay, for the replay harness (model = scenario name). */
  replayDir: string;
  devservers?: DevServers | null;
  /** One built in: the manifest after each turn, and the facts the agent gets. */
  scopes?: ScopeService | null;
  catalog?: CatalogService | null;
  /** Environment names the code reads: the per-turn facts (names only) and the "This app needs X" card. */
  env?: EnvService | null;
  verifier?: { check(url: string, shot: string | null, o?: { mobile?: boolean; session?: import("./verifier.js").VerifySession | null }): Promise<{ ran: boolean; note?: string; errors: import("./errors.js").ErrorInput[]; shot: string | null }> } | null;
  /** Per-project One Connect: the turn-end offer ("This app uses Gmail. Turn on One Connect for it?") and the facts line. */
  connect?: import("./connect.js").ConnectSetups | null;
  /** How the verifier signs in to a preview with One Connect on (the developer's session, or the sample's own sign-in). */
  previewSession?: (project: ProjectRow) => Promise<import("./verifier.js").VerifySession | null>;
  /** URL the verifier loads; defaults to the preview proxy URL. */
  verifyUrl?: (project: ProjectRow, port: number | null) => string;
  /** Pause between settle polls (ms). Tests and the demo shorten it. */
  quietMs?: number;
  /** Speed factor for replay pacing (1 = scenario pacing). */
  replaySpeed?: number;
  apiOrigin?: string;
  log?: (line: string) => void;
  maxConcurrent?: number;
  timeoutMs?: number;
  idleMs?: number;
}

interface Live {
  turnId: string;
  projectId: string;
  harnessTurn: HarnessTurn | null;
  cancelled: boolean;
  steer: string[];
  token: string;
}

const RESUME_FAILED = /No conversation found|session .*not found|resume failed|could not resume/i;

export class TurnEngine {
  private live = new Map<string, Live>(); // by turn id (user turns and their fix children)
  private projectBusy = new Set<string>();
  private seqs = new Map<string, number>();
  private pumping = false;
  private tokens = new Map<string, { turnId: string; projectId: string }>();

  constructor(private o: EngineOptions) {}

  private log(line: string) {
    this.o.log?.(line);
  }

  // ---- queries -----------------------------------------------------------

  async get(turnId: string): Promise<Turn | null> {
    const [r] = await this.o.db.select().from(turns).where(eq(turns.id, turnId));
    return r ? toTurn(r) : null;
  }

  async list(projectId: string, before?: string, limit = 30): Promise<{ turns: Turn[]; nextBefore: string | null }> {
    const where = before
      ? and(eq(turns.projectId, projectId), lt(turns.createdAt, new Date(before)))
      : eq(turns.projectId, projectId);
    const rows = await this.o.db.select().from(turns).where(where).orderBy(desc(turns.createdAt)).limit(limit + 1);
    const page = rows.slice(0, limit).map(toTurn);
    return { turns: page, nextBefore: rows.length > limit ? page[page.length - 1]!.createdAt : null };
  }

  async events(turnId: string, after = 0) {
    const rows = await this.o.db
      .select()
      .from(turnEvents)
      .where(and(eq(turnEvents.turnId, turnId)))
      .orderBy(asc(turnEvents.seq));
    return rows.filter((r) => r.seq > after).map((r) => ({ turnId: r.turnId, seq: r.seq, at: r.at.toISOString(), event: r.payload }));
  }

  async active(projectId: string): Promise<Turn | null> {
    const [r] = await this.o.db
      .select()
      .from(turns)
      .where(and(eq(turns.projectId, projectId), inArray(turns.status, ACTIVE_STATUSES)))
      .orderBy(asc(turns.createdAt))
      .limit(1);
    return r ? toTurn(r) : null;
  }

  /** Turns that are running (not queued) for a project, parents first. */
  async running(projectId: string): Promise<Turn[]> {
    const rows = await this.o.db
      .select()
      .from(turns)
      .where(and(eq(turns.projectId, projectId), inArray(turns.status, ["running", "settling", "verifying", "fixing"])))
      .orderBy(asc(turns.createdAt));
    return rows.map(toTurn);
  }

  /**
   * A turn token outside a harness run, for the in-process smoke scripts
   * (scripts that drive the MCP server directly). Revoke it when done.
   */
  mintToken(projectId: string, turnId: string | null = null): { token: string; revoke: () => void } {
    const token = newToken();
    this.tokens.set(token, { turnId: turnId ?? `smoke-${token.slice(0, 6)}`, projectId });
    return { token, revoke: () => this.tokens.delete(token) };
  }

  /** Check a turn token (MCP, steer hook, catalog). */
  tokenFor(token: string | undefined): { turnId: string; projectId: string } | null {
    if (!token) return null;
    return this.tokens.get(token) ?? null;
  }

  // ---- lifecycle ---------------------------------------------------------

  /** At boot: turns left active by a stopped server end as failed. */
  async recover(): Promise<void> {
    await this.o.db
      .update(turns)
      .set({ status: "failed", error: `${BRAND.name} stopped while this step ran.`, endedAt: new Date() })
      .where(inArray(turns.status, ["running", "settling", "verifying", "fixing"]));
    this.pump();
  }

  async submit(
    project: ProjectRow,
    body: { prompt: string; selections?: Selection[]; images?: string[]; kind?: TurnKind },
  ): Promise<Turn> {
    const [row] = await this.o.db
      .insert(turns)
      .values({
        id: newId("t"),
        projectId: project.id,
        kind: body.kind ?? "user",
        prompt: body.prompt,
        selections: body.selections ?? [],
        harness: project.harness,
        model: project.model,
        status: "queued",
        usage: ZERO_USAGE,
      })
      .returning();
    const t = toTurn(row!);
    if (body.images?.length) this.images.set(t.id, body.images);
    this.o.bus.emit(project.id, { type: "turn.started", turn: t });
    this.pump();
    return t;
  }

  private images = new Map<string, string[]>();

  /** A finished, agent-less entry in the chat for a restore or manual edits (a divider in the UI). */
  async record(project: ProjectRow, kind: "restore" | "manual" | "edit", prompt: string, checkpointSha: string | null): Promise<Turn> {
    const now = new Date();
    const [row] = await this.o.db
      .insert(turns)
      .values({ id: newId("t"), projectId: project.id, kind, prompt, harness: project.harness, model: project.model, status: "done", exit: "ok", usage: ZERO_USAGE, startedAt: now, endedAt: now, checkpointSha })
      .returning();
    const t = toTurn(row!);
    this.o.bus.emit(project.id, { type: "turn.started", turn: t });
    this.o.bus.emit(project.id, { type: "turn.ended", turn: t });
    return t;
  }

  /** Queue a steer message for a running Claude turn; read by the PostToolUse hook. */
  steer(turnId: string, text: string): boolean {
    const l = this.liveFor(turnId);
    if (!l) return false;
    l.steer.push(text);
    l.harnessTurn?.steer?.(text);
    void this.feed(l.turnId, l.projectId, { t: "steer", text });
    return true;
  }

  /** Called by the steer hook route. */
  claimSteer(turnId: string): string | null {
    const l = this.liveFor(turnId);
    if (!l || l.steer.length === 0) return null;
    const read = l.steer.splice(0);
    void this.feed(l.turnId, l.projectId, { t: "steer_read", count: read.length });
    return read.join("\n\n");
  }

  private liveFor(turnId: string): Live | null {
    const direct = this.live.get(turnId);
    if (direct) return direct;
    for (const l of this.live.values()) if (l.turnId === turnId) return l;
    return null;
  }

  async cancel(turnId: string): Promise<Turn | null> {
    const t = await this.get(turnId);
    if (!t) return null;
    if (t.status === "queued") {
      await this.setStatus(t.id, t.projectId, "cancelled", { endedAt: new Date(), exit: "cancelled" });
      const done = await this.get(turnId);
      if (done) this.o.bus.emit(t.projectId, { type: "turn.ended", turn: done });
      return done;
    }
    // Cancel the user turn and whatever child is running.
    for (const l of this.live.values()) {
      if (l.turnId === turnId || l.projectId === t.projectId) {
        l.cancelled = true;
        await l.harnessTurn?.cancel().catch(() => {});
      }
    }
    return this.get(turnId);
  }

  private pump(): void {
    if (this.pumping) return;
    this.pumping = true;
    void (async () => {
      try {
        const max = this.o.maxConcurrent ?? 2;
        while (this.projectBusy.size < max) {
          const queued = await this.o.db.select().from(turns).where(eq(turns.status, "queued")).orderBy(asc(turns.createdAt));
          const next = queued.find((q) => !this.projectBusy.has(q.projectId));
          if (!next) break;
          this.projectBusy.add(next.projectId);
          void this.runUserTurn(next.id).finally(() => {
            this.projectBusy.delete(next.projectId);
            this.pump();
          });
        }
      } catch (err) {
        this.log(`turn queue: ${(err as Error).message}`);
      } finally {
        this.pumping = false;
      }
    })();
  }

  /** Resolves when the project has no active turn (demo, tests). */
  async idle(projectId: string, timeoutMs = 10 * 60_000): Promise<void> {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (!this.projectBusy.has(projectId) && !(await this.active(projectId))) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("Timed out waiting for the turn to finish");
  }

  // ---- internals ---------------------------------------------------------

  private async setStatus(turnId: string, projectId: string, status: TurnStatus, extra: Partial<TurnRow> = {}, step?: string | null): Promise<void> {
    const [r] = await this.o.db
      .update(turns)
      .set({ status, ...extra })
      .where(eq(turns.id, turnId))
      .returning({ fixAttempt: turns.fixAttempt });
    this.o.bus.emit(projectId, { type: "turn.status", turnId, status, fixAttempt: r?.fixAttempt ?? 0, step: step ?? null });
  }

  private async feed(turnId: string, projectId: string, event: FeedEvent): Promise<void> {
    let seq = this.seqs.get(turnId);
    if (seq === undefined) {
      const [last] = await this.o.db.select({ seq: turnEvents.seq }).from(turnEvents).where(eq(turnEvents.turnId, turnId)).orderBy(desc(turnEvents.seq)).limit(1);
      seq = last?.seq ?? 0;
    }
    seq += 1;
    this.seqs.set(turnId, seq);
    const at = new Date();
    // Deltas are many and small: keep them out of the DB (the final text event carries the content).
    const persist = event.t !== "text_delta" && !(event.t === "thinking" && event.delta);
    if (persist) await this.o.db.insert(turnEvents).values({ turnId, seq, payload: event, at }).catch(() => {});
    this.o.bus.emit(projectId, { type: "turn.event", turnId, seq, event, at: at.toISOString() });
  }

  /** A platform event in a turn's feed, from outside the engine (MCP tools). */
  async note(turnId: string, projectId: string, event: FeedEvent): Promise<void> {
    await this.feed(turnId, projectId, event);
  }

  private async step(turnId: string, projectId: string, status: TurnStatus, step: string): Promise<void> {
    await this.setStatus(turnId, projectId, status, {}, step);
    await this.feed(turnId, projectId, { t: "step", step });
  }

  private async lastSession(projectId: string, harness: HarnessId, excludeTurnId: string): Promise<{ sessionId: string | null; otherHarness: HarnessId | null; costUsd: number | null }> {
    const rows = await this.o.db.select().from(turns).where(eq(turns.projectId, projectId)).orderBy(desc(turns.createdAt)).limit(20);
    for (const r of rows) {
      if (r.id === excludeTurnId) continue;
      if (r.kind !== "user" && r.kind !== "fix" && r.kind !== "plan") continue;
      if (r.harness !== harness) return { sessionId: null, otherHarness: r.harness as HarnessId, costUsd: null };
      if (r.sessionId) return { sessionId: r.sessionId, otherHarness: null, costUsd: r.sessionCostUsd };
    }
    return { sessionId: null, otherHarness: null, costUsd: null };
  }

  private async runUserTurn(turnId: string): Promise<void> {
    const t = await this.get(turnId);
    if (!t || t.status !== "queued") return;
    const project = await this.o.workspace.get(t.projectId);
    if (!project) return;
    const pid = project.id;
    try {
      await this.o.db.update(turns).set({ startedAt: new Date() }).where(eq(turns.id, t.id));
      await this.setStatus(t.id, pid, "running", {}, "Starting");
      // Edits made outside the agent become their own version first.
      const manual = await this.o.checkpoints.manualEdits(pid, project.path);
      if (manual) await this.record(project, "manual", "Manual edits", manual.sha);
      const before = new Set((await this.o.errors.open(pid)).map((e) => e.signature));
      const touched = new Set<string>();
      const first = await this.runOne(t, project, touched);
      if (first.exit !== "ok") {
        await this.finish(t.id, pid, first.cancelled ? "cancelled" : "failed", first.error ?? null);
        return;
      }
      const fresh = await this.o.workspace.get(pid);
      if (!fresh?.autoFix || t.kind !== "user") {
        await this.finish(t.id, pid, "done", null);
        return;
      }
      await this.fixLoop(t, project, before, touched, first.shot, 0);
    } catch (err) {
      this.log(`turn ${turnId}: ${(err as Error).stack ?? err}`);
      await this.feed(t.id, pid, { t: "error", message: (err as Error).message });
      await this.finish(t.id, pid, "failed", (err as Error).message);
    } finally {
      for (const [k, l] of this.live) if (l.projectId === pid) this.live.delete(k);
      // Steer messages the agent never read become the next queued turn, so nothing is lost.
      const left = this.leftoverSteer.get(pid);
      if (left?.length) {
        this.leftoverSteer.delete(pid);
        const p = await this.o.workspace.get(pid);
        if (p) await this.submit(p, { prompt: left.join("\n\n") });
      }
    }
  }

  private leftoverSteer = new Map<string, string[]>();

  /** "Try again" and "Fix these": a user turn on the open errors, with a fresh budget of 3 fix turns. */
  async fixNow(project: ProjectRow, errorIds?: string[]): Promise<Turn> {
    const open = await this.o.errors.open(project.id);
    const chosen = open.filter((e) => e.severity === "error" && e.source !== "one" && (!errorIds?.length || errorIds.includes(e.id)));
    const prompt = chosen.length
      ? `${autofix.fixSubject(chosen)}\n\n${autofix.fixPrompt(chosen, null)}`
      : "Check the project for errors (run pnpm typecheck) and fix what you find. Do not refactor or restyle.";
    return this.submit(project, { prompt, kind: "user" });
  }

  private async fixLoop(parent: Turn, project: ProjectRow, before: Set<string>, touched: Set<string>, shot: string | null, used: number): Promise<void> {
    const pid = project.id;
    let attempts = used;
    let lastTargets: ProjectError[] | null = null;
    for (;;) {
      const open = await this.o.errors.open(pid);
      const toFix = autofix.errorsToFix(open, before, touched);
      const d = autofix.decide({ attemptsUsed: attempts, toFix, lastTargets, openAfter: open });
      if (d.action === "done") {
        await this.finish(parent.id, pid, "done", null);
        return;
      }
      if (d.action === "give_up") {
        await this.feed(parent.id, pid, {
          t: "note",
          tone: "warn",
          text: `Couldn't fix this. Here is what is still wrong:\n${autofix.describeErrors(d.errors)}`,
        });
        await this.finish(parent.id, pid, "failed", d.reason === "repeat" ? "The same error came back after a fix." : "Still failing after 3 fixes.");
        return;
      }
      attempts += 1;
      await this.feed(parent.id, pid, { t: "fix_plan", errors: d.errors.length, attempt: attempts, max: autofix.MAX_FIX_TURNS });
      await this.setStatus(parent.id, pid, "fixing", { fixAttempt: attempts }, `Fixing ${d.errors.length} error${d.errors.length === 1 ? "" : "s"} (${attempts} of ${autofix.MAX_FIX_TURNS})`);
      const [row] = await this.o.db
        .insert(turns)
        .values({
          id: newId("t"),
          projectId: pid,
          kind: "fix",
          parentTurnId: parent.id,
          fixAttempt: attempts,
          prompt: autofix.fixPrompt(d.errors, shot),
          harness: project.harness,
          model: project.model,
          status: "running",
          startedAt: new Date(),
          usage: ZERO_USAGE,
        })
        .returning();
      const child = toTurn(row!);
      this.o.bus.emit(pid, { type: "turn.started", turn: child });
      const r = await this.runOne(child, (await this.o.workspace.get(pid)) ?? project, touched, d.errors);
      await this.finish(child.id, pid, r.exit === "ok" ? "done" : r.cancelled ? "cancelled" : "failed", r.error ?? null);
      if (r.cancelled) {
        await this.finish(parent.id, pid, "cancelled", null);
        return;
      }
      if (r.exit !== "ok") {
        await this.finish(parent.id, pid, "failed", r.error ?? "The fix step failed.");
        return;
      }
      shot = r.shot ?? shot;
      lastTargets = d.errors;
    }
  }

  private async finish(turnId: string, projectId: string, status: TurnStatus, error: string | null): Promise<void> {
    await this.setStatus(turnId, projectId, status, { endedAt: new Date(), error: error ?? null, ...(status === "cancelled" ? { exit: "cancelled" } : {}) });
    await this.o.workspace.touch(projectId);
    const t = await this.get(turnId);
    if (t) this.o.bus.emit(projectId, { type: "turn.ended", turn: t });
  }

  /** One harness run plus settle, verify and checkpoint. */
  private async runOne(
    t: Turn,
    project: ProjectRow,
    touched: Set<string>,
    targets?: ProjectError[],
  ): Promise<{ exit: TurnResult["exit"]; error?: string; cancelled: boolean; shot: string | null; checkpoint: Checkpoint | null }> {
    const pid = project.id;
    const cwd = project.path;
    const harnessId = project.harness as HarnessId;
    const harness = this.o.harness(harnessId);
    const beforeTree = (await git.snapshotTree(cwd)) ?? git.EMPTY_TREE;
    const token = newToken();
    const live: Live = { turnId: t.id, projectId: pid, harnessTurn: null, cancelled: false, steer: [], token };
    this.live.set(t.id, live);
    this.tokens.set(token, { turnId: t.id, projectId: pid });

    const permission = (t.kind === "plan" ? "plan" : project.permission) as TurnInput["permission"];
    const open = await this.o.errors.open(pid);
    const latest = await this.o.checkpoints.latest(pid);
    const restored = latest?.kind === "restore" ? latest : null;
    const sys = systemAppend({
      kind: t.kind,
      previewUrl: previewUrl(project.slug),
      permission,
      openErrors: t.kind === "fix" ? [] : open.filter((e) => e.severity === "error"),
      selections: t.selections,
      restored,
      fixAttempt: t.fixAttempt,
      one: await this.oneFacts(project),
    });
    const prompt = t.kind === "fix" ? t.prompt : t.kind === "plan" ? planPrompt(userPrompt(t.prompt, t.selections, this.images.get(t.id) ?? [])) : userPrompt(t.prompt, t.selections, this.images.get(t.id) ?? []);
    const prior = await this.lastSession(pid, harnessId, t.id);
    const stateDir = this.o.home.stateFor(pid);
    const apiOrigin = this.o.apiOrigin ?? SERVER_ORIGIN;
    const mcpEnv = { [env("API")]: apiOrigin, [env("TURN_TOKEN")]: token, [env("TURN_ID")]: t.id };

    const makeInput = async (sessionId: string | null, withHandoff: boolean): Promise<TurnInput> => {
      let p = prompt;
      if (withHandoff) {
        const history = (await this.list(pid, undefined, 12)).turns.filter((x) => x.id !== t.id);
        if (history.length) p = `${await handoff({ cwd, turns: history, openErrors: open, fromHarness: prior.otherHarness })}\n\n---\n\n${p}`;
      }
      const { agentEnv } = await import("@builder/harness");
      const base = agentEnv({ projectId: pid, turnId: t.id, shimsDir: this.o.shims.dir });
      return {
        cwd,
        prompt: p,
        images: this.images.get(t.id),
        sessionId,
        priorCostUsd: sessionId ? prior.costUsd : 0,
        model: project.model,
        permission,
        systemAppend: sys,
        mcp: { name: BRAND.slug, command: process.execPath, args: [this.o.shims.mcp], env: mcpEnv },
        env: { ...base, ...mcpEnv },
        timeoutMs: this.o.timeoutMs ?? 20 * 60_000,
        idleMs: this.o.idleMs ?? 4 * 60_000,
        stateDir,
        turnId: t.id,
        settingsJson: await this.claudeSettings(),
        replay: harnessId === "replay" ? { file: join(this.o.replayDir, `${project.model || "demo"}.json`), speed: this.o.replaySpeed } : undefined,
      };
    };

    const runHarness = async (input: TurnInput): Promise<{ result: TurnResult; sessionSeen: string | null }> => {
      const ht = harness.start(input);
      live.harnessTurn = ht;
      if (live.cancelled) await ht.cancel();
      let sessionSeen: string | null = null;
      let text = "";
      for await (const ev of ht.events) {
        if (ev.t === "session") {
          sessionSeen = ev.id;
          await this.o.db.update(turns).set({ sessionId: ev.id }).where(eq(turns.id, t.id));
        }
        if (ev.t === "tool_start" && ev.files) for (const f of ev.files) touched.add(relPath(f, cwd));
        if (ev.t === "tool_start" && ev.kind === "write" && ev.files?.length && t.kind === "user") {
          const name = relPath(ev.files[0]!, cwd).split("/").pop();
          this.o.bus.emit(pid, { type: "turn.status", turnId: t.id, status: "running", fixAttempt: t.fixAttempt, step: `Agent is writing ${name}` });
        }
        if (ev.t === "denied") this.o.bus.emit(pid, { type: "harness.denied", turnId: t.id, tool: ev.tool, reason: ev.reason });
        if (ev.t === "text") text = text ? `${text}\n\n${ev.text}` : ev.text;
        await this.feed(t.id, pid, ev as HarnessEvent);
      }
      const result = await ht.done;
      if (!result.text) result.text = text;
      return { result, sessionSeen };
    };

    let res: TurnResult;
    let sessionSeen: string | null;
    try {
      const resume = prior.sessionId;
      ({ result: res, sessionSeen } = await runHarness(await makeInput(resume, !resume)));
      if (resume && res.exit === "error" && (isResumeFailure(res) || RESUME_FAILED.test(res.error ?? "")) && !live.cancelled) {
        await this.feed(t.id, pid, { t: "note", text: "The earlier session could not be resumed, so this step starts fresh with a summary of the project." });
        ({ result: res, sessionSeen } = await runHarness(await makeInput(null, true)));
      }
    } finally {
      this.tokens.delete(token);
    }
    if (live.cancelled) res.exit = "cancelled";
    await this.o.db
      .update(turns)
      .set({
        exit: res.exit,
        usage: res.usage,
        costUsd: res.costUsd,
        sessionCostUsd: res.sessionCostUsd ?? null,
        text: res.text.slice(0, 20_000),
        sessionId: sessionSeen ?? res.sessionId ?? null,
        error: res.error ?? null,
      })
      .where(eq(turns.id, t.id));

    // Whatever happened, files on disk are kept as a version.
    let shot: string | null = null;
    if (res.exit === "ok") {
      await this.step(t.id, pid, "settling", "Waiting for files to settle");
      const afterTree = await this.settle(cwd, beforeTree);
      const changed = await this.o.checkpoints.changes(cwd, beforeTree, afterTree);
      for (const f of changed) touched.add(f.path);
      if (changed.some((f) => f.path === "package.json")) await this.install(t.id, project);
      await this.database(t.id, project, changed.map((f) => f.path));
      await this.step(t.id, pid, "settling", "Checking types");
      await this.typecheck(project, t.id);
      if (this.o.devservers && this.o.verifier) {
        await this.step(t.id, pid, "verifying", "Checking the preview");
        shot = await this.verify(t, project);
      }
    }
    // The manifest follows the code into the same commit.
    if (this.o.scopes) {
      try {
        const { diff, manifest } = await this.o.scopes.refresh(project, t.id);
        if (diff.widened && diff.lines.length) await this.feed(t.id, pid, { t: "asks_more", lines: diff.lines });
        // Visitors on the builder's grant are the builder's call: the turn ends with Allow / Keep sign-in required.
        const { notAllowed } = visitorSplit(manifest, await this.o.scopes.visitors(project));
        if (notAllowed.length && (t.kind === "user" || t.kind === "fix") && !(await this.askedVisitors(t, notAllowed.map((a) => a.actionId)))) {
          const describe = await this.o.scopes.describe(notAllowed);
          await this.feed(t.id, pid, { t: "visitors_needed", actions: notAllowed.map((a) => ({ actionId: a.actionId, line: describe(a) })) });
        }
        // One calls in an app without One Connect: the builder decides (Turn on One Connect, or Not now).
        if (manifest.actions.length && this.o.connect && (t.kind === "user" || t.kind === "fix") && !(await this.o.connect.projectConnect(pid)).enabled && !(await this.offeredConnect(pid))) {
          const platforms = [...new Set(manifest.actions.map((a) => a.platform))];
          const named = await Promise.all(platforms.map(async (x) => ({ platform: x, name: (await this.o.catalog?.platformName(x).catch(() => null)) ?? x })));
          await this.feed(t.id, pid, { t: "connect_offer", platforms: named });
        }
      } catch (err) {
        this.log(`manifest for ${project.slug}: ${(err as Error).message}`);
      }
    }
    if (t.kind === "user" || t.kind === "fix") await this.envNeeded(t, project, touched).catch((err) => this.log(`env for ${project.slug}: ${(err as Error).message}`));
    const subject = t.kind === "fix" ? autofix.fixSubject(targets ?? []) : t.prompt;
    let cp: Checkpoint | null = null;
    if (res.exit === "ok" || res.exit === "cancelled" || res.exit === "error" || res.exit === "timeout" || res.exit === "limit") {
      cp = await this.o.checkpoints.commit(pid, cwd, {
        subject: res.exit === "ok" ? subject : `${subject} (stopped)`,
        kind: t.kind,
        turnId: t.id,
        harness: harnessId,
        sessionId: sessionSeen ?? res.sessionId,
      });
    }
    if (cp) {
      if (shot) await this.o.checkpoints.setShot(pid, cp.sha, shot);
      await this.o.db.update(turns).set({ checkpointSha: cp.sha }).where(eq(turns.id, t.id));
      await this.feed(t.id, pid, { t: "checkpoint", sha: cp.sha, subject: cp.subject, additions: cp.additions, deletions: cp.deletions, files: cp.files.length });
    }
    // Anything the agent left running is stopped.
    const stopped = await stopAgentProcesses(pid);
    if (stopped.length) {
      await this.feed(t.id, pid, { t: "note", tone: "warn", text: `Stopped a server the agent started (${stopped.map((s) => s.command.split(" ")[0]).join(", ")})` });
    }
    if (live.steer.length) this.leftoverSteer.set(pid, [...(this.leftoverSteer.get(pid) ?? []), ...live.steer.splice(0)]);
    this.live.delete(t.id);
    return { exit: res.exit, error: res.error, cancelled: res.exit === "cancelled", shot, checkpoint: cp };
  }

  /** A fix turn does not ask again for what its user turn already asked. */
  private async askedVisitors(t: { kind: string; parentTurnId?: string | null }, ids: string[]): Promise<boolean> {
    if (t.kind !== "fix" || !t.parentTurnId) return false;
    const rows = await this.o.db.select({ payload: turnEvents.payload }).from(turnEvents).where(eq(turnEvents.turnId, t.parentTurnId));
    const asked = new Set<string>();
    for (const r of rows) {
      const e = r.payload as FeedEvent;
      if (e.t === "visitors_needed") for (const a of e.actions) asked.add(a.actionId);
    }
    return ids.every((id) => asked.has(id));
  }

  /** One offer per project until the builder answers it (a later turn asks again only after "Not now" on an earlier one is old news). */
  private async offeredConnect(projectId: string): Promise<boolean> {
    const rows = await this.o.db
      .select({ payload: turnEvents.payload })
      .from(turnEvents)
      .innerJoin(turns, eq(turns.id, turnEvents.turnId))
      .where(eq(turns.projectId, projectId));
    let offered = false;
    for (const r of rows) {
      const e = r.payload as FeedEvent;
      if (e.t === "connect_offer") offered = true;
      if (e.t === "connect_answer") offered = true;
    }
    return offered;
  }

  /** Per-turn One facts: the manifest summary and the app's One Connect. */
  private async oneFacts(project: ProjectRow): Promise<string> {
    const envLine = (() => {
      try {
        return this.o.env?.facts(project) ?? "";
      } catch {
        return "";
      }
    })();
    if (!this.o.scopes || !this.o.catalog) return envLine;
    try {
      const summary = await this.o.scopes.summary(project);
      const c = this.o.connect ? await this.o.connect.projectConnect(project.id) : null;
      const connect = !c
        ? ""
        : c.enabled
          ? "One Connect is on for this app: it has its own Connect app, so Sign in with One works in preview and calls run on the developer's own sign-in to it."
          : "One Connect is off for this app: there is no One login and every one(c).run returns a local refusal (connect_off) until the builder turns it on in Settings. Build the feature anyway; the builder gets a card to turn it on when your turn ends.";
      return [summary, connect, envLine].filter(Boolean).join("\n");
    } catch {
      return envLine;
    }
  }

  /**
   * The end of a turn: names the code reads that have no value yet, when this
   * turn touched a file that reads them (or the agent asked with project_env).
   * The chat shows "This app needs X" with the secure input. Names only.
   */
  private async envNeeded(t: { id: string; kind: string; parentTurnId?: string | null }, project: ProjectRow, touched: Set<string>): Promise<void> {
    if (!this.o.env) return;
    const { vars } = this.o.env.projectStatus(project);
    const asked = this.envAsked.get(t.id) ?? new Map<string, string>();
    this.envAsked.delete(t.id);
    const need: { name: string; why: string | null; sites: { file: string; line: number }[] }[] = vars
      .filter((v) => !v.present && v.needed && (asked.has(v.name) || (v.target === "both" && v.sites.some((s) => touched.has(s.file)))))
      .map((v) => ({ name: v.name, why: asked.get(v.name) ?? v.why, sites: v.sites.slice(0, 4) }));
    for (const [name, why] of asked) if (!vars.some((v) => v.name === name)) need.push({ name, why, sites: [] });
    // A fix turn does not ask again for what its user turn already asked.
    const before = new Set<string>();
    if (t.kind === "fix" && t.parentTurnId) {
      const rows = await this.o.db.select({ payload: turnEvents.payload }).from(turnEvents).where(eq(turnEvents.turnId, t.parentTurnId));
      for (const r of rows) {
        const e = r.payload as FeedEvent;
        if (e.t === "env_needed") for (const v of e.vars) before.add(v.name);
      }
    }
    const fresh = need.filter((v) => !before.has(v.name));
    if (!fresh.length) return;
    await this.feed(t.id, project.id, { t: "env_needed", vars: fresh });
  }

  /** project_env {request}: the agent names a variable the app needs and why. Shown at the end of the turn. */
  private envAsked = new Map<string, Map<string, string>>();
  requestEnv(turnId: string, name: string, why: string): void {
    const m = this.envAsked.get(turnId) ?? new Map<string, string>();
    m.set(name, why.slice(0, 300));
    this.envAsked.set(turnId, m);
  }

  private async claudeSettings(): Promise<string> {
    const { claudeSettingsJson, DENY_LIST } = await import("@builder/harness");
    return claudeSettingsJson({ steerHookCommand: `${JSON.stringify(process.execPath)} ${JSON.stringify(this.o.shims.steerHook)}`, deny: DENY_LIST });
  }

  /** Wait until two snapshots in a row agree (files quiet for quietMs), max 10 s. */
  private async settle(cwd: string, _before: string): Promise<string> {
    const quiet = this.o.quietMs ?? 1500;
    let last = (await git.snapshotTree(cwd)) ?? git.EMPTY_TREE;
    const end = Date.now() + 10_000;
    while (Date.now() < end) {
      await new Promise((r) => setTimeout(r, quiet));
      const now = (await git.snapshotTree(cwd)) ?? git.EMPTY_TREE;
      if (now === last) return now;
      last = now;
    }
    return last;
  }

  async install(turnId: string | null, project: ProjectRow): Promise<boolean> {
    if (turnId) await this.step(turnId, project.id, "settling", "Installing packages");
    this.o.bus.emit(project.id, { type: "install", state: "running", tail: "" });
    const r = await installPackages(project.path);
    this.o.bus.emit(project.id, { type: "install", state: r.ok ? "done" : "failed", tail: r.tail });
    if (!r.ok) await this.o.errors.record(project.id, project.path, { source: "install", message: `Installing packages failed:\n${r.tail}` }, turnId);
    else await this.o.errors.resolveAll(project.id, ["install"]);
    return r.ok;
  }

  /** Generate and apply D1 migrations when the schema or migrations changed. */
  async database(turnId: string | null, project: ProjectRow, changed: string[]): Promise<void> {
    const schema = changed.some((f) => f === "server/db/schema.ts");
    const migrations = changed.some((f) => f.startsWith("server/db/migrations/"));
    if (!schema && !migrations) return;
    if (turnId) await this.step(turnId, project.id, "settling", "Updating the app database");
    if (schema) {
      const g = await generateMigrations(project.path);
      if (!g.ok) {
        await this.o.errors.record(project.id, project.path, { source: "server", message: `Generating the database migration failed:\n${g.output}` }, turnId);
        return;
      }
    }
    const a = await applyMigrations(project.path);
    if (!a.ok) await this.o.errors.record(project.id, project.path, { source: "server", message: `Applying the database migration failed:\n${a.output}` }, turnId);
  }

  /** tsc --noEmit over the project; replaces the open `types` rows. */
  async typecheck(project: ProjectRow, turnId: string | null): Promise<ProjectError[]> {
    const tsc = join(project.path, "node_modules", "typescript", "bin", "tsc");
    if (!existsSync(tsc)) return [];
    const out = await new Promise<string>((resolve) => {
      const child = spawn(process.execPath, [tsc, "--noEmit", "-p", ".", "--pretty", "false"], { cwd: project.path, stdio: ["ignore", "pipe", "pipe"] });
      let buf = "";
      child.stdout.on("data", (d) => (buf += d));
      child.stderr.on("data", (d) => (buf += d));
      const timer = setTimeout(() => child.kill("SIGTERM"), 120_000);
      child.on("close", () => {
        clearTimeout(timer);
        resolve(buf);
      });
    });
    return this.o.errors.replaceSource(project.id, project.path, "types", parseTsc(out), turnId);
  }

  private async verify(t: Turn, project: ProjectRow): Promise<string | null> {
    const ds = this.o.devservers!;
    const devToken = this.o.workspace.devToken(project);
    const up = await ds.ensure({ id: project.id, path: project.path, devUrl: `${this.o.apiOrigin ?? SERVER_ORIGIN}/api/dev/${project.id}`, devToken });
    if (!up) {
      await this.feed(t.id, project.id, { t: "note", tone: "warn", text: "The preview is not running, so the check after this step was skipped." });
      return null;
    }
    const port = ds.readyPort(project.id);
    const url = this.o.verifyUrl ? this.o.verifyUrl(project, port) : previewUrl(project.slug);
    const shotRel = `${t.id}.png`;
    const shotAbs = join(project.path, BRAND.projectDir, "shots", shotRel);
    const loadStarted = new Date();
    const session = (await this.o.previewSession?.(project).catch(() => null)) ?? null;
    const r = await this.o.verifier!.check(url, shotAbs, { session });
    if (!r.ran) {
      if (r.note) await this.feed(t.id, project.id, { t: "note", text: r.note });
      return null;
    }
    for (const e of r.errors) await this.o.errors.record(project.id, project.path, e, t.id);
    // Runtime and network rows not seen on this fresh load are gone.
    await this.o.errors.resolveStale(project.id, ["runtime", "network", "server"], loadStarted);
    return r.shot ? shotRel : null;
  }
}

function relPath(f: string, cwd: string): string {
  return f.startsWith(cwd + "/") ? f.slice(cwd.length + 1) : f.replace(/^\.\//, "");
}
