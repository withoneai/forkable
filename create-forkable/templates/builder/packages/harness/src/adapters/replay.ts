/**
 * Replay adapter (CONTRACT 4): plays scripted turns from
 * fixtures/replay/<scenario>.json. Spawns nothing. Used by `pnpm start`,
 * tests and UI work.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type Harness, type HarnessEvent, type HarnessInfo, type TurnExit, type TurnInput, type TurnResult } from "../types.js";
import { UsageMeter } from "../usage.js";
import { failedResult, makeTurn } from "./common.js";

export interface ReplayTurn {
  /** Picked when this is a substring of the prompt (case-insensitive). */
  match?: string;
  events: HarnessEvent[];
  writes?: { path: string; content: string }[];
  delete?: string[];
  /** Pause between events, before speed. Default 40. */
  delayMs?: number;
  /** Test hooks: end the turn this way. */
  exit?: TurnExit;
  error?: string;
}

export interface ReplayScenario {
  turns: ReplayTurn[];
}

export function loadScenario(file: string): ReplayScenario {
  const raw = JSON.parse(readFileSync(file, "utf8")) as ReplayScenario;
  if (!raw || !Array.isArray(raw.turns)) throw new Error(`${file} has no turns`);
  return raw;
}

function counterFile(stateDir: string, scenarioFile: string): string {
  return path.join(stateDir, `replay-${path.basename(scenarioFile, ".json")}.json`);
}

/** index, else the first `match` found in the prompt, else the next turn by counter. */
export function pickTurn(scenario: ReplayScenario, input: TurnInput): { turn: ReplayTurn; index: number } | null {
  const replay = input.replay!;
  const counter = counterFile(input.stateDir, replay.file);
  let next = 0;
  try {
    next = (JSON.parse(readFileSync(counter, "utf8")) as { next?: number }).next ?? 0;
  } catch {
    // first play
  }
  let index: number;
  if (typeof replay.index === "number") index = replay.index;
  else {
    const prompt = input.prompt.toLowerCase();
    const hit = scenario.turns.findIndex((t) => t.match && prompt.includes(t.match.toLowerCase()));
    index = hit >= 0 ? hit : Math.min(next, scenario.turns.length - 1);
  }
  const turn = scenario.turns[index];
  if (!turn) return null;
  try {
    mkdirSync(input.stateDir, { recursive: true });
    writeFileSync(counter, JSON.stringify({ next: next + 1 }));
  } catch {
    // counter is best effort
  }
  return { turn, index };
}

function safePath(cwd: string, rel: string): string {
  const abs = path.resolve(cwd, rel);
  const root = path.resolve(cwd);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error(`Replay path escapes the project: ${rel}`);
  return abs;
}

function applyFiles(cwd: string, turn: ReplayTurn, permission?: string): void {
  // Plan mode is read only, here too.
  if (permission === "plan") return;
  for (const w of turn.writes ?? []) {
    const abs = safePath(cwd, w.path);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, w.content);
  }
  for (const d of turn.delete ?? []) {
    const abs = safePath(cwd, d);
    if (existsSync(abs)) rmSync(abs, { recursive: true, force: true });
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const INFO: HarnessInfo = {
  id: "replay",
  label: "Replay",
  status: "ready",
  bin: null,
  version: "1",
  signedIn: true,
  models: [{ id: "replay", label: "Replay", hint: "Scripted turns from fixtures" }],
  caps: { stream: "token", resume: "native", mcp: "none", images: false, steer: false, plan: true, costUsd: false },
};

export const replayHarness: Harness = {
  id: "replay",
  detect: async () => INFO,
  start(input: TurnInput) {
    return makeTurn(async ({ push, cancelled }) => {
      if (!input.replay?.file) return failedResult("The replay harness needs a scenario file");
      let scenario: ReplayScenario;
      try {
        scenario = loadScenario(input.replay.file);
      } catch (err) {
        return failedResult(`Could not read the replay scenario: ${(err as Error).message}`);
      }
      const picked = pickTurn(scenario, input);
      if (!picked) return failedResult("The replay scenario has no turn to play");
      const { turn } = picked;
      const speed = input.replay.speed ?? 1;
      const delay = Math.max(0, (turn.delayMs ?? 40) * speed);
      const sessionId = input.sessionId ?? `replay-${randomUUID()}`;
      const meter = new UsageMeter();
      let text = "";
      let applied = false;

      const result = (exit: TurnExit, error?: string): TurnResult => ({
        sessionId,
        text,
        usage: meter.value,
        costUsd: null,
        exit,
        ...(error ? { error } : {}),
      });

      push({ t: "session", id: sessionId });
      const events = turn.events;
      for (let i = 0; i < events.length; i++) {
        if (cancelled()) return result("cancelled");
        // Files land before the last event, so a watcher sees them mid-turn.
        if (i === events.length - 1 && !applied) {
          applyFiles(input.cwd, turn, input.permission);
          applied = true;
        }
        const ev = events[i]!;
        if (ev.t === "session") continue;
        if (ev.t === "text") text = text ? `${text}\n\n${ev.text}` : ev.text;
        if (ev.t === "usage") meter.push(ev);
        push(ev);
        if (delay) await sleep(delay);
      }
      if (cancelled()) return result("cancelled");
      if (!applied) applyFiles(input.cwd, turn, input.permission);
      if (turn.exit && turn.exit !== "ok") return result(turn.exit, turn.error ?? "Scripted failure");
      return result("ok");
    });
  },
};

