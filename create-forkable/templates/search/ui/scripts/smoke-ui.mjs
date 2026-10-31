#!/usr/bin/env node
// UI smoke (SPEC 19, Phase 2). Drives the app in Chromium through the whole
// Phase 2 path: sample sign-in, a search with an operator, chips rewriting the
// box both ways, the preview, a chat answer with 3 citations, Apply on a
// proposal, the New profile flow on the Zendesk sample to a saved source with a
// first run, and Access listing the grant.
//
//   node scripts/smoke-ui.mjs                 starts its own mock UI (VITE_MOCK=1) on 5681
//   SMOKE_URL=http://localhost:5780 node scripts/smoke-ui.mjs   uses a running UI on its own port (never 5680)
//   SMOKE_HEADED=1 ...                        watch it
//
// Exits 0 when every step passes, 1 otherwise. Screens of failures go to /tmp/search-smoke/.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const uiDir = resolve(here, "..");
const OUT = "/tmp/search-smoke";
mkdirSync(OUT, { recursive: true });

// Never against the owner's running copy (5680/52289): tests and shots use their own
// server on a tmp SEARCH_HOME. SEARCH_LIVE_OK=1 overrides, for a deliberate look only.
const refuseLive = (url) => {
  if (/:(5680|52289)(\/|$)/.test(url) && process.env.SEARCH_LIVE_OK !== "1") {
    console.error(`Refusing ${url}: that is the running Search on ~/.search. Start one on another port with a tmp SEARCH_HOME and pass its URL.`);
    process.exit(2);
  }
};
let base = process.env.SMOKE_URL;
if (base) refuseLive(base);
let child = null;
async function up(url) { try { const r = await fetch(url); return r.ok; } catch { return false; } }
if (!base) {
  base = "http://localhost:5681";
  child = spawn("npx", ["vite", "--port", "5681", "--strictPort"], { cwd: uiDir, env: { ...process.env, VITE_MOCK: "1", NODE_ENV: "development" }, stdio: "ignore" });
  for (let i = 0; i < 60 && !(await up(base)); i++) await new Promise((r) => setTimeout(r, 500));
  if (!(await up(base))) { console.error("could not start the mock UI on 5681"); child.kill(); process.exit(1); }
}

const browser = await chromium.launch({ headless: !process.env.SMOKE_HEADED });
const page = await browser.newPage({ viewport: { width: 1536, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const mod = process.platform === "darwin" ? "Meta" : "Control";
let failed = 0;
let n = 0;

async function step(name, fn) {
  n++;
  const t0 = Date.now();
  try {
    await fn();
    console.log(`  ok  ${String(n).padStart(2)} ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    failed++;
    const shot = `${OUT}/step-${n}.png`;
    await page.screenshot({ path: shot }).catch(() => {});
    console.log(`  FAIL ${String(n).padStart(2)} ${name}\n       ${String(e.message ?? e).split("\n")[0]}\n       screen: ${shot}`);
  }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const box = () => page.getByTestId("search-box").first();
const boxValue = () => box().inputValue();
const urlQ = () => new URL(page.url()).searchParams.get("q") ?? "";
// The box follows the URL one render later; wait for it instead of reading at once.
const waitBox = (re, present = true) => page.waitForFunction(([src, want]) => new RegExp(src).test(document.querySelector('[data-testid="search-box"]')?.value ?? "") === want, [re.source, present], { timeout: 3000 }).catch(() => {});

console.log(`Search UI smoke against ${base}`);

await step("sample sign-in from /start", async () => {
  await page.goto(`${base}/start`);
  await page.evaluate(() => { localStorage.clear(); });
  await page.goto(`${base}/start`);
  await page.getByTestId("try-sample").click();
  await page.waitForURL((u) => u.pathname === "/", { timeout: 10_000 });
  await box().waitFor({ timeout: 10_000 });
});

await step("search with an operator", async () => {
  await box().click();
  await box().fill("globex from:priya");
  await box().press("Enter");
  await page.waitForFunction(() => new URL(location.href).searchParams.get("q") === "globex from:priya");
  await page.getByTestId("result-row").first().waitFor();
  const rows = await page.getByTestId("result-row").count();
  expect(rows >= 1, `expected results, got ${rows}`);
  const chip = await page.locator('[data-chip="from"]').innerText();
  expect(/priya/i.test(chip), `From chip did not light up: "${chip}"`);
});

await step("chips rewrite the box (and back)", async () => {
  await page.locator('[data-chip="source"]').click();
  await page.getByRole("option", { name: /Gmail/ }).first().click();
  await page.waitForFunction(() => /in:gmail|source:gmail/.test(new URL(location.href).searchParams.get("q") ?? ""));
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => /(in|source):gmail/.test(document.querySelector('[data-testid="search-box"]')?.value ?? ""), null, { timeout: 3000 }).catch(() => {});
  expect(/(in|source):gmail/.test(await boxValue()), `box did not get the operator: ${await boxValue()}`);
  await page.getByRole("button", { name: "Remove From" }).click();
  await page.waitForFunction(() => !/from:/.test(new URL(location.href).searchParams.get("q") ?? ""));
  await waitBox(/from:/, false);
  expect(!/from:/.test(await boxValue()), "removing the chip left from: in the box");
  await box().fill("globex renewal");
  await box().press("Enter");
  await page.waitForFunction(() => new URL(location.href).searchParams.get("q") === "globex renewal");
});

await step("preview opens for the selected row", async () => {
  await page.getByTestId("result-row").nth(1).click();
  const preview = page.getByTestId("preview");
  await preview.waitFor();
  const title = await page.getByTestId("result-row").nth(1).getAttribute("data-id");
  expect(!!title, "no selected row id");
  await preview.getByRole("heading").first().waitFor();
  await page.keyboard.press("j");
  const sel = await page.locator('[data-testid="result-row"][aria-selected="true"]').getAttribute("data-index");
  expect(sel === "2", `J did not move the selection (index ${sel})`);
});

await step("chat answer with 3 citations", async () => {
  await box().fill("globex");
  await box().press("Enter");
  await page.waitForFunction(() => new URL(location.href).searchParams.get("q") === "globex");
  await page.getByTestId("result-row").first().waitFor();
  await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press(`${mod}+Shift+j`);
  const composer = page.getByTestId("composer");
  await composer.waitFor();
  await composer.fill("Where are we with Globex?");
  await composer.press(`${mod}+Enter`);
  const pills = page.locator('[data-testid="dock"] [data-citation]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="dock"] [data-citation]').length >= 3, null, { timeout: 15_000 });
  const count = await pills.count();
  expect(count >= 3, `expected 3 citation pills, got ${count}`);
  await pills.first().click();
  await page.getByTestId("preview").waitFor();
});

await step("Apply a proposal rewrites the box", async () => {
  const apply = page.getByTestId("proposal").last().getByRole("button", { name: /^Apply/ });
  await apply.waitFor({ timeout: 10_000 });
  await apply.click();
  await page.waitForFunction(() => /with:globex\.com/.test(new URL(location.href).searchParams.get("q") ?? ""));
  expect(/after:14d/.test(urlQ()), `proposal not applied: ${urlQ()}`);
  await page.keyboard.press(`${mod}+j`);
});

await step("New profile for Zendesk to a saved source with a first run", async () => {
  await page.goto(`${base}/settings/integrations`);
  await page.getByTestId("new-profile").waitFor();
  await page.keyboard.press("n");
  const sheet = page.getByTestId("new-profile-sheet");
  await sheet.waitFor();
  await page.getByTestId("platform-search").fill("zendesk");
  await page.getByTestId("platform-zendesk").click();
  const primary = page.getByTestId("sheet-primary");
  // Platform, Models, Fields, Identity: Continue whenever the step allows it (the proposal takes a few seconds).
  for (let i = 0; i < 6 && !(await page.getByTestId("profile-name").isVisible().catch(() => false)); i++) {
    await page.waitForFunction(() => { const b = document.querySelector('[data-testid="sheet-primary"]'); return b && !b.hasAttribute("disabled") && b.getAttribute("aria-busy") !== "true"; }, null, { timeout: 25_000 });
    await primary.click();
    await page.waitForTimeout(300);
  }
  await page.getByTestId("profile-name").waitFor();
  await page.keyboard.press(`${mod}+Enter`);
  await page.waitForURL(/\/sources\/[^/]+$/, { timeout: 15_000 });
  await page.getByTestId("first-run").waitFor({ timeout: 15_000 });
});

await step("Access lists the grant", async () => {
  await page.goto(`${base}/access`);
  await page.getByText(/Search can read/).first().waitFor();
  await page.getByTestId("actions").waitFor();
  const granted = await page.getByTestId("actions").getByText("Granted", { exact: true }).count();
  expect(granted >= 5, `expected granted read actions, got ${granted}`);
  await page.getByTestId("write-row").first().click();
  await page.getByText(/declined, 403/).first().waitFor();
});

await step("Settings, Assistant: AI engine choice", async () => {
  await page.goto(`${base}/settings/assistant`);
  const group = page.getByRole("radiogroup", { name: "AI engine" });
  await group.waitFor({ timeout: 10_000 });
  const radio = (name) => group.getByRole("radio", { name: new RegExp(`^${name}`) });
  expect(await radio("Auto").getAttribute("aria-checked") === "true", "Auto is not the default");
  expect(await radio("Codex").isDisabled(), "Codex (signed out in the mock) should be disabled");
  await page.getByText("Not signed in (run codex login)").waitFor();
  await radio("Models through One").click();
  await page.waitForFunction(() => document.querySelector('[role="radiogroup"][aria-label="AI engine"] [aria-checked="true"]')?.textContent?.startsWith("Models through One"), null, { timeout: 5000 });
  await page.waitForFunction(() => /Claude Sonnet 5\.5/.test(document.querySelector('[aria-label="Chat model"]')?.textContent ?? ""), null, { timeout: 5000 });
  await radio("Claude Code").click();
  // Claude Code lists its own models (labels carry the tier)
  await page.waitForFunction(() => /balanced/.test(document.querySelector('[aria-label="Chat model"]')?.textContent ?? ""), null, { timeout: 5000 });
  await radio("Auto").click();
  await page.getByRole("button", { name: "Check again" }).click();
});

await step("no page errors", async () => { expect(errors.length === 0, errors.join(" | ")); });

await browser.close();
if (child) child.kill();
console.log(failed ? `${failed} of ${n} steps failed` : `all ${n} steps passed`);
process.exit(failed ? 1 : 0);
