#!/usr/bin/env node
// Rill's welcome: the R mark and the next steps for a fresh fork.
//
// `npm create forkable` runs this after the keyless demo (forkable.json
// names it as "welcome") and passes --dir <the new folder>. Inside a fork,
// `pnpm welcome` prints it again. No dependencies; plain Node.
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] ?? null : null;
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(join(root, file), "utf8"));
  } catch {
    return {};
  }
}

// Who and where, from local/profile.md, unless still the placeholders.
function profile() {
  const file = join(root, "local", "profile.md");
  if (!existsSync(file)) return {};
  const text = readFileSync(file, "utf8");
  const field = (key) => {
    const m = text.match(new RegExp(`^${key}:\\s*"?(.*?)"?\\s*$`, "m"));
    const v = m?.[1] ?? "";
    return v && !v.startsWith("(not set") && !v.includes("{{") ? v : null;
  };
  return { for: field("for"), in: field("in") };
}

// ---- colour -------------------------------------------------------------

const out = process.stdout;
out.on("error", () => process.exit(0)); // a closed pipe (| head) is not an error
const color = !process.env.NO_COLOR && (Boolean(process.env.FORCE_COLOR) || (out.isTTY && process.env.TERM !== "dumb"));
const truecolor = /truecolor|24bit/i.test(process.env.COLORTERM ?? "") || process.env.TERM_PROGRAM === "iTerm.app" || process.env.TERM_PROGRAM === "vscode" || process.env.TERM_PROGRAM === "WezTerm" || process.env.TERM_PROGRAM === "ghostty";

// Forkable brand: lime #CCED73 for the solid mass, secondary #627b6f for
// hairlines and quiet text. 256-colour fallbacks for Apple Terminal.
const paint = (rgb, c256) => (s) => !color ? s : truecolor ? `\x1b[38;2;${rgb}m${s}\x1b[39m` : `\x1b[38;5;${c256}m${s}\x1b[39m`;
const lime = paint("204;237;115", 191);
const moss = paint("98;123;111", 66);
const bold = (s) => (color ? `\x1b[1m${s}\x1b[22m` : s);
const dim = (s) => (color ? `\x1b[2m${s}\x1b[22m` : s);
const chip = (s) => (color ? (truecolor ? `\x1b[48;2;30;34;31m\x1b[38;2;226;250;238m ${s} \x1b[0m` : `\x1b[48;5;236m\x1b[38;5;255m ${s} \x1b[0m`) : `[${s}]`);
const visible = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

// ---- the mark -----------------------------------------------------------

// Rill's R (R_BOWL_CAPSULE in the Forkable letter system): the solid stem,
// bowl and leg as half blocks, the hairline halo as braille, all in the
// one accent like the real mark. Rendered from its own geometry at 24 columns.
const MARK = [
  "      ⣛⣛⠲⠶⣤⣀",
  "      ⢭⣭⣝⡛⠶⣍⠳⣄",
  "█████████▄⠳⣌⠳⣌⢷⡀",
  "███████████▄⢧⠹⡎⢷",
  "████████████▄⡇⣿⢸⡇",
  "████████████▀⡇⣿⢸⡇",
  "████████████⡾⣰⠇⡾",
  "██████████▀⢟⣴⢋⡼⠃",
  "████████████▄⠟",
  "███████████████▄",
  "██████  ▀████████▄▄",
  "██████    ▀▀████████▄▄",
  "██████       ▀▀████████▄",
  "▀█████          ▀▀██████",
  "                   ▀▀██▀",
];
const MARK_WIDTH = 24;

function paintMark(line) {
  return line.replace(/\S+/g, (m) => lime(m));
}

// ---- content ------------------------------------------------------------

const pkg = readJson("package.json");
const forkable = readJson("forkable.json");
const who = profile();
const dir = arg("dir");
const pm = arg("pm") ?? "pnpm";
const name = forkable.name ?? pkg.name ?? "rill";
const title = name === "rill" ? "Rill" : `${name}`;
const ui = "http://localhost:5180";
const serverPort = process.env.RILL_PORT || "51789";

const beside = [
  "",
  "",
  `${bold(lime(title))}${name === "rill" ? "" : dim("  forked from Rill")}`,
  "Your goals and your VIPs",
  "decide what you see first.",
  "",
  dir ? `${moss("Forked into")} ./${dir}` : `${moss("Running in")} ./${basename(root)}`,
  who.for || who.in ? `${moss("For")} ${[who.for, who.in && `in ${who.in}`].filter(Boolean).join(" ")}` : "",
  "",
  [chip("VIPs"), chip("Goals"), chip("Needs reply"), chip("Other"), chip("New senders")].join(" "),
  "",
  dim("Secured by One. Each person connects"),
  dim("their own accounts and can revoke them."),
];

const cd = dir ? `cd ${dir} && ` : "";
const steps = [
  [
    "See it on the sample inbox",
    [
      lime(`${cd}${pm} dev`),
      `Open ${bold(ui)} and pick ${bold("Explore the Acme sample inbox")}.`,
      dim("No account needed. A founder's week at Acme Inc, already sorted."),
    ],
  ],
  [
    "Connect your own Gmail",
    [
      `Open ${bold(`${ui}/setup/connect`)} while ${pm} dev runs.`,
      `It walks you through a Connect app in the One dashboard.`,
      `Redirect URI  ${lime(`http://localhost:${serverPort}/api/one/callback`)}`,
      dim("The values stay on this machine, out of git."),
    ],
  ],
  [
    "Make it yours",
    [
      `${lime("INBOX.md")}          lanes and rules in plain English`,
      `${lime("local/profile.md")}  who this fork is for, and where`,
      `${lime("agents/rill.md")}    what the agent does, and what it never does`,
      `${lime("AGENTS.md")}         point Claude Code or Codex here before changing code`,
    ],
  ],
];

// ---- print --------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const animate = color && !process.env.CI && !process.env.FORKABLE_NO_ANIMATION;
const wide = (out.columns || 100) >= 80;

async function main() {
  const lines = [""];
  if (wide) {
    for (let i = 0; i < MARK.length; i++) {
      const m = paintMark(MARK[i]);
      const pad = " ".repeat(MARK_WIDTH - visible(MARK[i]).length);
      lines.push(`  ${m}${pad}   ${beside[i] ?? ""}`.trimEnd());
    }
  } else {
    for (const l of MARK) lines.push(`  ${paintMark(l)}`);
    lines.push("");
    for (const l of beside) if (l) lines.push(`  ${l}`);
  }
  lines.push("");

  // The mark draws itself in, one row at a time, then the steps follow.
  for (const l of lines) {
    out.write(`${l}\n`);
    if (animate) await sleep(22);
  }

  out.write(`  ${bold("Next")}\n\n`);
  steps.forEach(([head, body], i) => {
    out.write(`  ${lime(String(i + 1))}  ${bold(head)}\n`);
    for (const b of body) out.write(`     ${b}\n`);
    out.write("\n");
  });
  out.write(`  ${dim(`Print this again with ${pm} welcome. More at https://rill.forkable.dev`)}\n\n`);
}

main();
