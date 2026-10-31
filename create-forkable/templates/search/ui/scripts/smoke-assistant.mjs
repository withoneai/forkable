// The mapping assistant in the browser, on the Acme sample with the local engine:
// New profile for Zendesk to the Fields step, the panel is open beside the map,
// one ask changes the map (a row shows its new target), Undo puts it back.
// Screenshots in docs/qa/assistant/. Needs `pnpm dev` up and Claude Code or Codex.
// Run: node ui/scripts/smoke-assistant.mjs [base]
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const shots = resolve(here, "../../docs/qa/assistant");
mkdirSync(shots, { recursive: true });
// Never against the owner's running copy (5680/52289): tests and shots use their own
// server on a tmp SEARCH_HOME. SEARCH_LIVE_OK=1 overrides, for a deliberate look only.
const refuseLive = (url) => {
  if (/:(5680|52289)(\/|$)/.test(url) && process.env.SEARCH_LIVE_OK !== "1") {
    console.error(`Refusing ${url}: that is the running Search on ~/.search. Start one on another port with a tmp SEARCH_HOME and pass its URL.`);
    process.exit(2);
  }
};
const base = process.argv[2] ?? "http://localhost:5780";
refuseLive(base);
let failed = 0;
const step = async (name, fn) => { try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${String(e.message ?? e).split("\n")[0]}`); } };

const browser = await chromium.launch();
for (const theme of ["dark", "light"]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
  const row = (path) => page.getByTestId(`map-row-${path}`);
  console.log(`-- ${theme}`);
  await step("sample sign-in", async () => {
    await page.goto(`${base}/start`);
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${base}/start`);
    await page.getByTestId("try-sample").click();
    await page.waitForURL((u) => u.pathname === "/", { timeout: 15_000 });
  });
  await step("New profile for Zendesk to Fields, assistant open", async () => {
    await page.goto(`${base}/settings/integrations`);
    await page.getByTestId("new-profile").click();
    await page.getByTestId("platform-search").fill("zendesk");
    await page.getByTestId("platform-zendesk").click();
    for (let i = 0; i < 2; i++) {
      await page.waitForFunction(() => { const b = document.querySelector('[data-testid="sheet-primary"]'); return b && !b.hasAttribute("disabled") && b.getAttribute("aria-busy") !== "true"; }, null, { timeout: 30_000 });
      await page.getByTestId("sheet-primary").click();
      await page.waitForTimeout(400);
    }
    // Check: the field map sits under Edit fields, the assistant opens when asked
    await page.getByTestId("profile-name").waitFor({ timeout: 20_000 });
    await page.getByTestId("edit-fields").locator("button").first().click();
    await page.getByTestId("field-map").waitFor({ timeout: 10_000 });
    await page.getByTestId("assist-open").click();
    await page.getByTestId("mapping-assistant").waitFor({ timeout: 5_000 });
    await page.screenshot({ path: `${shots}/${theme}-1-open.png` });
  });
  let before = "";
  await step("an ask changes the map", async () => {
    before = await row("updated_at").innerText();
    // updated_at already comes in as Date updated from the proposal, so the ask is one that always changes the map
    await page.getByTestId("assist-input").fill("Map updated_at as the status.");
    await page.keyboard.press("Enter");
    await page.getByTestId("assist-changes").waitFor({ timeout: 120_000 });
    await page.waitForFunction(() => /status/i.test(document.querySelector('[data-testid="map-row-updated_at"]')?.textContent ?? ""), null, { timeout: 5_000 });
    const after = await row("updated_at").innerText();
    if (after === before) throw new Error(`row unchanged: ${after}`);
    await page.screenshot({ path: `${shots}/${theme}-2-changed.png` });
  });
  await step("Undo puts it back", async () => {
    await page.getByTestId("assist-undo").click();
    await page.waitForFunction((b) => (document.querySelector('[data-testid="map-row-updated_at"]')?.textContent ?? "") === b.replace(/\n/g, ""), before, { timeout: 5_000 }).catch(() => {});
    const now = await row("updated_at").innerText();
    if (now !== before) throw new Error(`after undo: ${JSON.stringify(now)} vs ${JSON.stringify(before)}`);
    await page.screenshot({ path: `${shots}/${theme}-3-undone.png` });
  });
  await step("Esc in the panel closes the panel, not the sheet", async () => {
    await page.getByTestId("assist-input").click();
    await page.keyboard.press("Escape");
    await page.getByTestId("mapping-assistant").waitFor({ state: "detached", timeout: 3_000 });
    await page.getByTestId("new-profile-sheet").waitFor({ timeout: 1_000 });
    await page.getByTestId("assist-open").click();
    await page.getByTestId("mapping-assistant").waitFor({ timeout: 3_000 });
  });
  await page.close();
}
await browser.close();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
