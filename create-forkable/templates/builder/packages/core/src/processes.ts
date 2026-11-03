// Adapted from earlier One Systems code (MIT).
// Copyright (c) 2026 One Systems, Inc.
// Portions Copyright (c) 2025 Paperclip AI (forked). See LICENSES/harness-MIT.txt.
//
// Every harness process carries BUILDER_AGENT=1 and
// BUILDER_PROJECT_ID in its env, and so does anything it starts, including a
// server it put in the background with nohup. `ps -E` reads that env for every
// process of this user. The platform's own dev servers never carry
// BUILDER_AGENT, so they are never matched.

import { execFile } from "node:child_process";
import { env } from "./brand.js";

export interface TaggedProcess {
  pid: number;
  pgid: number;
  command: string;
  ports: number[];
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024, timeout: 10_000 }, (_err, stdout) => resolve(typeof stdout === "string" ? stdout : ""));
  });
}

/** Processes started by an agent for this project (optionally only one turn's). */
export async function scanAgentProcesses(projectId: string, turnId?: string): Promise<TaggedProcess[]> {
  if (process.platform === "win32") return [];
  const out = await run("ps", ["-axEww", "-o", "pid=,pgid=,command="]);
  const agentTag = new RegExp(`(?:^|\\s)${env("AGENT")}=1(?=\\s|$)`);
  const projTag = new RegExp(`(?:^|\\s)${env("PROJECT_ID")}=${projectId.replace(/[^\w-]/g, "")}(?=\\s|$)`);
  const turnTag = turnId ? new RegExp(`(?:^|\\s)${env("TURN_ID")}=${turnId.replace(/[^\w-]/g, "")}(?=\\s|$)`) : null;
  const found: TaggedProcess[] = [];
  for (const line of out.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    if (pid === process.pid) continue;
    if (!agentTag.test(line) || !projTag.test(line)) continue;
    if (turnTag && !turnTag.test(line)) continue;
    // The command is everything before the first VAR=value that is ours; keep it short.
    const command = m[3]!.split(/\s[A-Z_][A-Z0-9_]*=/)[0]!.slice(0, 200);
    found.push({ pid, pgid: Number(m[2]), command, ports: [] });
  }
  if (found.length) {
    const lsof = await run("lsof", ["-nP", "-a", "-iTCP", "-sTCP:LISTEN", "-F", "pn", "-p", found.map((p) => p.pid).join(",")]);
    let pid = 0;
    for (const line of lsof.split("\n")) {
      if (line.startsWith("p")) pid = Number(line.slice(1));
      else if (line.startsWith("n") && pid) {
        const port = Number(line.slice(line.lastIndexOf(":") + 1));
        const p = found.find((f) => f.pid === pid);
        if (p && port > 0 && !p.ports.includes(port)) p.ports.push(port);
      }
    }
  }
  return found;
}

/** Stop what an agent left running. Returns what was stopped. */
export async function stopAgentProcesses(projectId: string): Promise<TaggedProcess[]> {
  const found = await scanAgentProcesses(projectId);
  for (const p of found) {
    try {
      process.kill(-p.pgid, "SIGTERM");
    } catch {
      try {
        process.kill(p.pid, "SIGTERM");
      } catch {
        /* gone */
      }
    }
  }
  if (found.length) {
    await new Promise((r) => setTimeout(r, 2000));
    for (const p of found) {
      try {
        process.kill(p.pid, 0);
        process.kill(p.pid, "SIGKILL");
      } catch {
        /* gone */
      }
    }
  }
  return found;
}

/**
 * Dev servers left by an earlier platform process (a crash, or a watch
 * restart that did not get to clean up). Only platform dev servers carry
 * BUILDER_DEV_PORT in their env. Run once at boot, before any start.
 *
 * Scoped to one home: a preview carries BUILDER_PREVIEW_HOME (the home that
 * started it), so a smoke script or the eval on a scratch home never stops
 * the previews of an editor running on ~/.builder, and the reverse. A
 * preview from before that tag existed is matched by its dev URL (or, older
 * still, its relay URL) only.
 */
export async function stopOrphanDevServers(serverOrigin?: string, homeRoot?: string): Promise<number> {
  if (process.platform === "win32") return 0;
  const out = await run("ps", ["-axEww", "-o", "pid=,pgid=,command="]);
  const tag = new RegExp(`(?:^|\\s)${env("DEV_PORT")}=\\d+(?=\\s|$)`);
  const homeTag = new RegExp(`(?:^|\\s)${env("PREVIEW_HOME")}=(\\S+)`);
  const mine = serverOrigin ? [`${env("DEV_URL")}=${serverOrigin}/`, `${env("RELAY_URL")}=${serverOrigin}/`] : null;
  const groups = new Set<number>();
  for (const line of out.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+/);
    if (!m || Number(m[1]) === process.pid) continue;
    if (!tag.test(line)) continue;
    if (!previewIsOurs(line, homeTag, homeRoot, mine)) continue;
    groups.add(Number(m[2]));
  }
  for (const g of groups) {
    try {
      process.kill(-g, "SIGTERM");
    } catch {
      /* gone */
    }
  }
  return groups.size;
}

/** A preview's ps line belongs to this server: same home when it is tagged, else (an older preview) the same dev or relay URL. */
export function previewIsOurs(line: string, homeTag: RegExp, homeRoot: string | undefined, prefix: string | string[] | null): boolean {
  const list = prefix === null ? [] : Array.isArray(prefix) ? prefix : [prefix];
  const has = list.some((x) => line.includes(x));
  const tagged = homeTag.exec(line)?.[1];
  if (tagged !== undefined) return homeRoot !== undefined && tagged === homeRoot && (!list.length || has);
  return has;
}
