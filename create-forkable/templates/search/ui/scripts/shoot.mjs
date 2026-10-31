#!/usr/bin/env node
// QA screenshots of every screen on the Acme sample, light and dark.
//   node scripts/shoot.mjs [outDir] [widths]      default ../docs/qa/phase2-ui, 1280
//   SHOOT_URL=http://localhost:5780 node scripts/shoot.mjs   use a running UI (never 5680) instead of starting a mock one
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const uiDir = resolve(here, "..");
const out = resolve(process.argv[2] ?? resolve(uiDir, "../docs/qa/phase2-ui"));
const widths = (process.argv[3] ?? "1280").split(",").map(Number);
mkdirSync(out, { recursive: true });

// Never against the owner's running copy (5680/52289) unless SEARCH_LIVE_OK=1.
const refuseLive = (url) => {
  if (/:(5680|52289)(\/|$)/.test(url) && process.env.SEARCH_LIVE_OK !== "1") {
    console.error(`Refusing ${url}: that is the running Search on ~/.search. Start one on another port with a tmp SEARCH_HOME and pass its URL.`);
    process.exit(2);
  }
};
let base = process.env.SHOOT_URL;
if (base) refuseLive(base);
let child = null;
async function up(u) { try { return (await fetch(u)).ok; } catch { return false; } }
if (!base) {
  base = "http://localhost:5682";
  child = spawn("npx", ["vite", "--port", "5682", "--strictPort"], { cwd: uiDir, env: { ...process.env, VITE_MOCK: "1", NODE_ENV: "development" }, stdio: "ignore" });
  for (let i = 0; i < 60 && !(await up(base)); i++) await new Promise((r) => setTimeout(r, 500));
}
// SHOOT_ONLY=home,results,... limits the set (names below).
const only = process.env.SHOOT_ONLY ? new Set(process.env.SHOOT_ONLY.split(",")) : null;
const mod = process.platform === "darwin" ? "Meta" : "Control";

const shots = [
  { name: "start", path: "/start", signedIn: false },
  { name: "home", path: "/" },
  { name: "results", path: "/?q=globex%20renewal" },
  { name: "results-operators", path: "/?q=globex%20from%3Apriya%20after%3A30d" },
  { name: "preview-event", path: "/?q=type%3Aevent", act: async (p) => { await p.keyboard.press("j"); } },
  { name: "preview-deal", path: "/?q=type%3Adeal" },
  { name: "preview-issue", path: "/?q=ACME-298" },
  { name: "preview-meeting", path: "/?q=type%3Ameeting%20globex" },
  { name: "empty", path: "/?q=pricing%20from%3Ajules" },
  { name: "dock-answer", path: "/?q=globex", act: async (p) => {
    await p.keyboard.press(`${mod}+Shift+j`);
    await p.getByTestId("composer").fill("Where are we with Globex?");
    await p.getByTestId("composer").press(`${mod}+Enter`);
    await p.waitForSelector('[data-testid="proposal"]', { timeout: 15000 });
    await p.locator('[data-testid="dock"] [data-citation]').first().hover();
  } },
  { name: "answer-strip", path: "/?q=who%20is%20priya%20shah%3F" },
  { name: "palette", path: "/?q=globex", act: async (p) => { await p.keyboard.press(`${mod}+k`); await p.keyboard.type("glob"); } },
  { name: "shortcuts", path: "/", act: async (p) => { await p.locator("body").click({ position: { x: 600, y: 700 } }); await p.keyboard.press("Shift+?"); } },
  { name: "entity", path: "/people/ent_priya" },
  { name: "integrations", path: "/settings/integrations" },
  { name: "new-profile-1-platform", path: "/settings/integrations/new", act: async (p) => { await p.getByTestId("platform-search").fill("zendesk"); } },
  { name: "new-profile-2-models", path: "/settings/integrations/new", act: async (p) => { await np(p, 1); } },
  { name: "new-profile-3-fields", path: "/settings/integrations/new", act: async (p) => { await np(p, 2); } },
  { name: "new-profile-4-identity", path: "/settings/integrations/new", act: async (p) => { await np(p, 3); } },
  { name: "new-profile-5-review", path: "/settings/integrations/new", act: async (p) => { await np(p, 4); } },
  { name: "source-detail", path: "/sources/src_hubspot_deals" },
  { name: "source-runs", path: "/sources/src_slack_messages", act: async (p) => { await p.getByRole("tab", { name: /Runs/ }).click().catch(() => {}); } },
  { name: "source-errors", path: "/sources/src_teams_chat_messages", act: async (p) => { await p.getByRole("tab", { name: /Errors/ }).click().catch(() => {}); } },
  { name: "access", path: "/access", act: async (p) => { await p.getByTestId("write-row").first().click(); } },
  { name: "setup-connect", path: "/setup/connect" },
  { name: "settings-general", path: "/settings/general" },
  { name: "settings-search", path: "/settings/search" },
  { name: "settings-api", path: "/settings/api" },
];

async function np(p, steps) {
  await p.getByTestId("platform-search").fill("zendesk");
  await p.getByTestId("platform-zendesk").click();
  for (let i = 0; i < steps; i++) {
    await p.waitForFunction(() => { const b = document.querySelector('[data-testid="sheet-primary"]'); return b && !b.hasAttribute("disabled") && b.getAttribute("aria-busy") !== "true"; }, null, { timeout: 25000 });
    await p.getByTestId("sheet-primary").click();
    await p.waitForTimeout(500);
  }
}

const browser = await chromium.launch();
for (const w of widths) for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 820 }, colorScheme: theme, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  for (const s of shots.filter((x) => !only || only.has(x.name))) {
    await page.goto(`${base}/start`);
    await page.evaluate(([t, si]) => { localStorage.setItem("search.theme", t); localStorage.setItem("search.mock", JSON.stringify({ signedIn: si, setup: {} })); localStorage.setItem("search.dock.open", "0"); }, [theme, s.signedIn !== false]);
    await page.goto(`${base}${s.path}`);
    await page.waitForTimeout(1200);
    try { if (s.act) await s.act(page); } catch (e) { console.log(`  ${s.name}: ${String(e.message).split("\n")[0]}`); }
    await page.waitForTimeout(1500); // logos from assets.withone.ai are lazy
    const file = `${out}/${s.name}-${theme}-${w}.png`;
    await page.screenshot({ path: file });
  }
  await ctx.close();
  console.log(`shot ${only ? only.size : shots.length} screens at ${w} ${theme}`);
}
await browser.close();
if (child) child.kill();
console.log(`wrote ${out}`);
