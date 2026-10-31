#!/usr/bin/env node
// Search's welcome: the S mark and the next steps for a fresh fork.
//
// `npm create forkable` runs this after the keyless demo (forkable.json
// names it as "welcome") and passes --dir <the new folder> and --pm <the
// package manager>. Inside a fork, `pnpm welcome` prints it again.
// No dependencies; plain Node. Fits 80 columns, honours NO_COLOR and CI.
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
const truecolor = /truecolor|24bit/i.test(process.env.COLORTERM ?? "") || ["iTerm.app", "vscode", "WezTerm", "ghostty"].includes(process.env.TERM_PROGRAM ?? "");

// Forkable brand: lime #CCED73 for the mark, secondary #627b6f for quiet
// labels. 256-colour fallbacks for Apple Terminal.
const paint = (rgb, c256) => (s) => (!color ? s : truecolor ? `\x1b[38;2;${rgb}m${s}\x1b[39m` : `\x1b[38;5;${c256}m${s}\x1b[39m`);
const lime = paint("204;237;115", 191);
const moss = paint("98;123;111", 66);
const bold = (s) => (color ? `\x1b[1m${s}\x1b[22m` : s);
const dim = (s) => (color ? `\x1b[2m${s}\x1b[22m` : s);
const chip = (s) => (color ? (truecolor ? `\x1b[48;2;30;34;31m\x1b[38;2;226;250;238m ${s} \x1b[0m` : `\x1b[48;5;236m\x1b[38;5;255m ${s} \x1b[0m`) : `[${s}]`);
const visible = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

// ---- the mark -----------------------------------------------------------

// Search's S from the Forkable brand kit (design/brand/search/marks): the
// solid stem as full blocks, the two hairline fields as braille, all in
// the one accent like the real mark. Rendered from its geometry at 24
// columns.
const MARK = [
  "         ██████⠛⠒⠶⢤⣀",
  "         ██████⣉⠛⠲⢤⡈⠳⣄",
  "         ██████⣉⡙⠳⣤⠙⢦⠈⢧",
  "         ██████⣄⡉⢳⡈⢷⠈⣧⠘⡇",
  "         ██████ ⠓ ⠃⠘⠃⠘ ⠛",
  "         ██████",
  "         ██████",
  "⣤ ⡄⢠⡄⢠ ⢤ ██████",
  "⢸⡄⢻⡀⢷⡈⢧⣈⠙██████",
  " ⢳⡀⠳⣄⠛⢦⣌⣉██████",
  "  ⠙⢦⡈⠓⠦⣤⣉██████",
  "    ⠉⠓⠶⠤⣤██████",
];
const MARK_WIDTH = 24;

const paintMark = (line) => line.replace(/\S+/g, (m) => lime(m));

// ---- content ------------------------------------------------------------

const pkg = readJson("package.json");
const forkable = readJson("forkable.json");
const who = profile();
const dir = arg("dir");
const pm = arg("pm") ?? "pnpm";
const name = forkable.name ?? pkg.name ?? "search";
const title = name === "search" ? "Search" : name;
const ui = "http://localhost:5680";
const serverPort = process.env.SEARCH_PORT || "52289";

const beside = [
  "",
  `${bold(lime(title))}${name === "search" ? "" : dim("  forked from Search")}`,
  "Searches your connected tools",
  "and answers with sources.",
  "",
  dir ? `${moss("Forked into")} ./${dir}` : `${moss("Your fork is in")} ./${basename(root)}`,
  who.for || who.in ? `${moss("For")} ${[who.for, who.in && `in ${who.in}`].filter(Boolean).join(" ")}` : "",
  [chip("HubSpot"), chip("Attio"), chip("Gmail"), chip("Outlook")].join(" "),
  [chip("Notion"), chip("Linear"), chip("Slack"), chip("Granola")].join(" "),
  "",
  dim("Secured by One. Users connect their own"),
  dim("accounts and can revoke them."),
];

const cd = dir ? `cd ${dir} && ` : "";
const steps = [
  [
    "Search the Acme sample",
    [
      lime(`${cd}${pm} dev`),
      `Open ${bold(ui)} and pick ${bold("Try the Acme sample")}.`,
      dim("Sample data, no account: a week of Acme Inc in 11 tools."),
    ],
  ],
  [
    "Sign in with One",
    [
      `${lime(`${cd}${pm} connect`)} makes your Connect app.`,
      `Approve it in the browser, then paste its two secrets on`,
      `${bold(`${ui}/setup/connect`)} while ${pm} dev runs.`,
      `Redirect URI  ${lime(`http://localhost:${serverPort}/api/one/callback`)}`,
      dim("Kept in your Keychain or ~/.search, never in .env."),
    ],
  ],
  [
    "Files to edit",
    [
      `${lime("profiles/")}              what gets indexed, one JSON pack per tool`,
      `${lime("connect.manifest.json")}  every action Search may call`,
      `${lime("local/profile.md")}       who this fork is for, and where`,
      `${lime("AGENTS.md")}              point Claude Code or Codex here first`,
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
  out.write(`  ${dim(`Print this again with ${pm} welcome. More in README.md`)}\n\n`);
}

main();
