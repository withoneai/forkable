#!/usr/bin/env node
// pnpm connect: makes (or updates) Search's One Connect app from one.connect.ts.
//
// One command makes your Connect app. You approve it in the browser. The
// One CLI then writes the app's ids to .env. The client secret and the
// Connect key are shown once on the approval page, never here: you paste
// them on Search's setup screen, which keeps them in your macOS Keychain.
//
// Dependency free. Extra arguments go to `one connect create`
// (`pnpm connect --no-open` prints the approval link instead of opening it).

import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SETUP_URL = "http://localhost:5680/setup/connect";
const HEALTH_URL = `http://127.0.0.1:${process.env.SEARCH_PORT || 52289}/api/health`;
const args = process.argv.slice(2).filter((a) => a !== "--");
const noOpen = args.includes("--no-open") || !!process.env.CI;

const say = (line = "") => process.stdout.write(`${line}\n`);
const fail = (lines) => {
  for (const l of lines) process.stderr.write(`${l}\n`);
  process.exit(1);
};

function lastJson(text) {
  for (const line of text.trim().split("\n").reverse()) {
    const l = line.trim();
    if (!l.startsWith("{")) continue;
    try {
      return JSON.parse(l);
    } catch {
      /* not JSON */
    }
  }
  return null;
}

const installHelp = ["Install the One CLI, then log in:", "", "  npm install -g @withone/cli", "  one login", "", "Then run pnpm connect again."];

// 1. The One CLI is on PATH and logged in.
const who = spawnSync("one", ["--agent", "whoami"], { cwd: ROOT, encoding: "utf8", shell: process.platform === "win32" });
if (who.error && who.error.code === "ENOENT") fail(["The One CLI is not installed.", "", ...installHelp]);
if (who.status !== 0) {
  const j = lastJson(who.stdout || "");
  if (j?.code === "NODE_UPGRADE_REQUIRED") fail(["The One CLI needs a newer Node.js. Update it with:", "", `  ${j.upgrade ?? "a newer Node.js"}`, "", "Then run pnpm connect again."]);
  fail(["The One CLI is not logged in.", "", ...installHelp]);
}

// 2. Create or update the app. The CLI prints the approval link on stderr.
say("One command makes your Connect app. You approve it in the browser.");
say("");
const child = spawn("one", ["--agent", "connect", "create", ...args], { cwd: ROOT, stdio: ["inherit", "pipe", "inherit"], shell: process.platform === "win32" });
let out = "";
child.stdout.on("data", (d) => (out += d.toString()));
child.on("error", () => fail(["The One CLI could not start.", "", ...installHelp]));
child.on("close", async (code) => {
  const j = lastJson(out);
  if (code !== 0 || !j?.outcome) {
    if (j?.code === "NODE_UPGRADE_REQUIRED") fail(["", "The One CLI needs a newer Node.js. Update it with:", "", `  ${j.upgrade ?? "a newer Node.js"}`]);
    fail(["", `Did not make the app: ${j?.error ?? "the One CLI stopped without an answer."}`]);
  }
  say("");
  if (j.outcome !== "created") {
    say(`Search's Connect app is up to date (${j.outcome}). Its secrets stay as they are.`);
    return;
  }
  say(`Search's Connect app is made. Its ids are in ${j.envFile ?? ".env"}.`);
  say("");
  say("One step left. The approval page showed a client secret and a Connect key, once.");
  say(`Paste both at ${SETUP_URL}`);
  say("Search keeps them in your macOS Keychain. Never paste them in a chat.");
  const up = await fetch(HEALTH_URL).then((r) => r.ok, () => false);
  if (!up) {
    say("");
    say("Start Search first with pnpm dev, then open that page.");
    return;
  }
  if (noOpen) return;
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(opener, [SETUP_URL], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).on("error", () => {}).unref();
});
