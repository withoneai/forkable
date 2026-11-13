#!/usr/bin/env node
// Agents screen smoke (SPEC 16.5), in light and dark: the sidebar link and Cmd+K
// ("connect", "claude", "agent", "AI app"), the Claude app first and in plain words,
// no paths on a card face (Details shows them), the For developers section closed
// by default with the sentence to paste, the address card, the command line and the
// signed-in apps inside, one card per agent with its status, Connect, Remove, a
// missing app's disabled Connect with where to get it. Screenshots at 1440 and 1024
// go to docs/qa/agents/.
//
//   node scripts/smoke-agents.mjs                 its own mock UI (VITE_MOCK=1) on 5781
//   SMOKE_URL=http://localhost:52391 node scripts/smoke-agents.mjs
//                                                 a real server (tmp SEARCH_HOME and
//                                                 SEARCH_AGENT_HOME, never 5680/52289).
//                                                 Before any click it reads GET /agents
//                                                 and refuses unless every agent config
//                                                 path sits in a temp folder.
//
// Exits 0 when every step passes. Failure screens go to /tmp/search-smoke/.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const uiDir = resolve(here, "..");
const QA = resolve(uiDir, "..", "docs", "qa", "agents");
const OUT = "/tmp/search-smoke";
mkdirSync(OUT, { recursive: true });
mkdirSync(QA, { recursive: true });

let base = process.env.SMOKE_URL;
if (base && /:(5680|52289)(\/|$)/.test(base) && process.env.SEARCH_LIVE_OK !== "1") {
  console.error(`Refusing ${base}: that is the running Search on ~/.search.`);
  process.exit(2);
}
// MOCK_URL: a mock UI that is already running (VITE_MOCK=1), instead of starting one on 5781
const mock = !base;
if (!base && process.env.MOCK_URL) base = process.env.MOCK_URL;
let child = null;
async function up(url) { try { return (await fetch(url)).ok; } catch { return false; } }
if (!base) {
  base = "http://localhost:5781";
  child = spawn("npx", ["vite", "--port", "5781", "--strictPort"], { cwd: uiDir, env: { ...process.env, VITE_MOCK: "1", NODE_ENV: "development" }, stdio: "ignore" });
  for (let i = 0; i < 60 && !(await up(base)); i++) await new Promise((r) => setTimeout(r, 500));
  if (!(await up(base))) { console.error("could not start the mock UI on 5781"); child.kill(); process.exit(1); }
}

const browser = await chromium.launch({ headless: !process.env.SMOKE_HEADED });
let failed = 0, n = 0;
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
console.log(`Agents screen smoke against ${base}${mock ? " (mock)" : ""}`);

for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  async function step(name, fn) {
    n++;
    const t0 = Date.now();
    try {
      await fn();
      console.log(`  ok  ${String(n).padStart(2)} [${theme}] ${name} (${Date.now() - t0} ms)`);
    } catch (e) {
      failed++;
      const shot = `${OUT}/agents-${theme}-${n}.png`;
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      console.log(`  FAIL ${String(n).padStart(2)} [${theme}] ${name}\n       ${String(e.message ?? e).split("\n")[0]}\n       screen: ${shot}`);
    }
  }
  const card = (id) => page.getByTestId(`agent-${id}`);
  const stateOf = (id) => card(id).getAttribute("data-state");

  await step("sample sign-in", async () => {
    await page.goto(`${base}/start`);
    await page.evaluate((t) => { localStorage.clear(); localStorage.setItem("search.theme", t); localStorage.setItem("search.dock.open", "0"); }, theme);
    await page.goto(`${base}/start`);
    await page.getByTestId("try-sample").click();
    await page.waitForURL((u) => u.pathname === "/", { timeout: 15_000 });
  });

  // A real server edits the agent configs it reports: only ever temp ones.
  if (!mock) {
    const paths = await page.evaluate(async () => (await (await fetch("/api/v1/agents")).json()).agents?.map((a) => a.configPath) ?? null);
    const temp = /^(\/private)?\/(tmp|var\/folders)\//;
    if (!paths || !paths.length || !paths.every((p) => temp.test(p))) {
      console.error(`Refusing ${base}: its agent configs are not in a temp folder (${JSON.stringify(paths)}). Start it with SEARCH_AGENT_HOME set to a temp folder.`);
      await browser.close();
      process.exit(2);
    }
    console.log(`  ok     [${theme}] every agent config path is in a temp folder`);
  }

  await step("the sidebar's Agents link opens the Agents screen", async () => {
    await page.getByRole("link", { name: "Agents" }).first().click();
    await page.waitForURL((u) => u.pathname === "/settings/agents", { timeout: 5000 });
    await page.getByTestId("agents-screen").waitFor({ timeout: 5000 });
    await page.getByTestId("agent-cards").waitFor({ timeout: 10_000 });
  });

  await step("the old /settings/api address lands on Agents", async () => {
    await page.goto(`${base}/settings/api`);
    await page.waitForURL((u) => u.pathname === "/settings/agents", { timeout: 5000 });
    await page.getByTestId("agent-cards").waitFor({ timeout: 10_000 });
  });

  await step("written for a person: the title, the Claude app first, no paths on the cards", async () => {
    const text = await page.getByTestId("agents-screen").innerText();
    expect(/Use Search in your AI app/.test(text), "no title");
    expect(/Ask Claude about your own mail, meetings and deals/.test(text), "no intro");
    const order = await page.getByTestId("agent-cards").locator("[data-testid^='agent-'][data-state]").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
    expect(order[0] === "agent-claude-desktop", `first card: ${order[0]}`);
    expect(/^Claude\b/.test(await card("claude-desktop").locator("p").first().innerText()), "the Claude app is not called Claude");
    const cards = await page.getByTestId("agent-cards").innerText();
    expect(!/~\/|\/Users\/|\/Applications\/|\.json|\.toml|pnpm|MCP/.test(cards), `a path or developer word on a card: ${cards.slice(0, 300)}`);
    expect(!/Set up Search for me with/.test(text), "the developer sentence shows before For developers is opened");
    expect((await page.getByTestId("dev-toggle").getAttribute("aria-expanded")) === "false", "For developers is open by default");
  });

  await step("Details on a found card shows where it is", async () => {
    const found = [];
    for (const id of ["claude-desktop", "claude-code", "codex", "cursor"]) if ((await stateOf(id)) !== "not_found") found.push(id);
    expect(found.length > 0, "nothing found");
    await card(found[0]).getByTestId("agent-details-toggle").click();
    expect(/Found at/.test(await card(found[0]).getByTestId("agent-details").innerText()), "no path in details");
    await card(found[0]).getByTestId("agent-details-toggle").click();
  });

  await step("Cmd+K finds this screen by connect, claude, agent and AI app", async () => {
    for (const word of ["connect", "claude", "agent", "AI app"]) {
      await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
      const input = page.getByRole("dialog").locator("input").first();
      await input.waitFor({ timeout: 3000 });
      await input.fill(word);
      await page.getByRole("dialog").getByText("Use Search in your AI app").first().waitFor({ timeout: 3000 });
      await page.keyboard.press("Escape");
    }
  });

  await step("For developers opens and holds the developer pieces", async () => {
    await page.getByTestId("dev-toggle").click();
    await page.getByTestId("setup-sentence").waitFor({ timeout: 3000 });
    const dev = await page.getByTestId("for-developers").innerText();
    expect(/pnpm run search login/.test(dev) && /Signed-in apps/.test(dev), "command line or signed-in apps missing");
  });

  let sentence = "";
  await step("the sentence to paste names start.md, and Copy copies it", async () => {
    sentence = (await page.getByTestId("setup-sentence").locator("code").innerText()).trim();
    expect(/^Set up Search for me with http:\/\/(localhost|127\.0\.0\.1):\d+\/start\.md$/.test(sentence), `sentence: ${sentence}`);
    await page.getByTestId("copy-sentence").click();
    await page.getByTestId("copy-sentence").getByText("Copied").waitFor({ timeout: 2000 });
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip === sentence, `clipboard: ${clip}`);
  });

  await step("four app cards plus Any other app, each with a status", async () => {
    for (const id of ["claude-code", "codex", "cursor", "claude-desktop"]) {
      const s = await stateOf(id);
      expect(["connected", "added", "not_connected", "not_found"].includes(s), `${id} state ${s}`);
      expect((await card(id).getByTestId("agent-status").innerText()).length > 3, `${id} has no status`);
    }
    await page.getByTestId("agent-other").waitFor();
  });

  for (const w of [1440, 1024]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.getByTestId("dev-toggle").click();
    await page.waitForTimeout(300); // the chevron's turn
    await page.screenshot({ path: `${QA}/agents-${theme}-${w}${mock ? "-mock" : ""}.png`, fullPage: true });
    await page.getByTestId("dev-toggle").click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${QA}/agents-${theme}-${w}-developers${mock ? "-mock" : ""}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await step("an agent that is not here has Connect turned off and says to install it", async () => {
    const missing = [];
    for (const id of ["claude-code", "codex", "cursor", "claude-desktop"]) if ((await stateOf(id)) === "not_found") missing.push(id);
    // a real server sees the apps really installed here, so maybe nothing is missing
    if (!missing.length && !mock) return;
    expect(missing.length > 0, "no agent is missing in this run");
    for (const id of missing) {
      expect(await card(id).getByTestId("agent-connect").isDisabled(), `${id} Connect is enabled`);
      expect(/Install[\s\S]+first/.test(await card(id).innerText()), `${id} does not say to install it`);
      expect(/^https:\/\//.test(await card(id).getByTestId("agent-get").locator("a").getAttribute("href") ?? ""), `${id} does not say where to get it`);
    }
  });

  await step("Connect on Cursor signs it in at once: Connected, with how to start", async () => {
    if ((await stateOf("cursor")) !== "not_connected") {
      await card("cursor").getByTestId("agent-remove").click();
      await card("cursor").getByTestId("agent-remove").click();
      await page.waitForFunction(() => document.querySelector('[data-testid="agent-cursor"]')?.getAttribute("data-state") === "not_connected", null, { timeout: 5000 });
    }
    await card("cursor").getByTestId("agent-connect").click();
    await page.waitForFunction(() => document.querySelector('[data-testid="agent-cursor"]')?.getAttribute("data-state") === "connected", null, { timeout: 8000 });
    const ready = await card("cursor").getByTestId("agent-ready").innerText();
    expect(/Cursor picks it up on its own/.test(ready) && /in Cursor open Settings, then MCP/.test(ready), ready);
  });

  await page.screenshot({ path: `${QA}/agents-${theme}-1440-connected${mock ? "-mock" : ""}.png`, fullPage: true });

  if (mock) {
    await step("Connect on Codex: Added, one step left, then Connected once it signs in", async () => {
      await card("codex").getByTestId("agent-connect").click();
      await page.waitForFunction(() => document.querySelector('[data-testid="agent-codex"]')?.getAttribute("data-state") === "added", null, { timeout: 5000 });
      expect(/browser tab/.test(await card("codex").getByTestId("agent-next-step").innerText()), "no step");
      await page.screenshot({ path: `${QA}/agents-${theme}-1440-one-step-left-mock.png`, fullPage: true });
      await page.waitForFunction(() => document.querySelector('[data-testid="agent-codex"]')?.getAttribute("data-state") === "connected", null, { timeout: 12_000 });
      await card("codex").getByTestId("agent-remove").click();
      await card("codex").getByTestId("agent-remove").click();
      await page.waitForFunction(() => document.querySelector('[data-testid="agent-codex"]')?.getAttribute("data-state") === "not_connected", null, { timeout: 5000 });
    });
  }

  await step("Remove asks once more, then takes Search out", async () => {
    const btn = card("cursor").getByTestId("agent-remove");
    await btn.click();
    expect(/Remove it/.test(await btn.innerText()), "no confirm label");
    await btn.click();
    await page.waitForFunction(() => document.querySelector('[data-testid="agent-cursor"]')?.getAttribute("data-state") === "not_connected", null, { timeout: 5000 });
  });

  await step("Any other app: the MCP address and the JSON on request", async () => {
    const other = page.getByTestId("agent-other");
    expect(/\/mcp$/.test((await other.locator("code").first().innerText()).trim()), "no /mcp address");
    await other.getByRole("button", { name: /Show the setup text/ }).click();
    expect(/"mcpServers"/.test(await other.innerText()), "no JSON");
  });

  await step("Settings has an Agents tab, and the page has no console errors", async () => {
    await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "Agents" }).waitFor();
    expect(!errors.length, errors.join(" | "));
  });

  await ctx.close();
}

// one narrow shot for the layout
{
  const ctx = await browser.newContext({ viewport: { width: 820, height: 1000 }, colorScheme: "light" });
  const page = await ctx.newPage();
  await page.goto(`${base}/start`);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem("search.dock.open", "0"); });
  await page.goto(`${base}/start`);
  await page.getByTestId("try-sample").click();
  await page.waitForURL((u) => u.pathname === "/", { timeout: 15_000 });
  await page.goto(`${base}/settings/agents`);
  await page.getByTestId("agent-cards").waitFor({ timeout: 10_000 });
  await page.screenshot({ path: `${QA}/agents-light-820${mock ? "-mock" : ""}.png`, fullPage: true });
  await ctx.close();
}

await browser.close();
if (child) child.kill();
console.log(failed ? `\n${failed} of ${n} failed` : `\nall ${n} passed`);
process.exit(failed ? 1 : 0);
