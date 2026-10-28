// Each flow's finished chat at 1280, dark and light, into docs/qa/mcp/.
import { chromium } from "/opt/homebrew/lib/node_modules/playwright/index.mjs";
const BASE = process.env.BASE ?? "http://127.0.0.1:4174";
const OUT = new URL("../docs/qa/mcp/", import.meta.url).pathname;
const browser = await chromium.launch();
for (const theme of ["dark", "light"]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
  await ctx.addInitScript((t) => localStorage.setItem("forkable-site-theme", t), theme);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("pageerror", String(e)));
  await page.goto(`${BASE}/mcp/`, { waitUntil: "networkidle" });
  const tabs = page.locator("#flows [aria-label=Flows] [role=tab]");
  for (let i = 0; i < (await tabs.count()); i++) {
    await tabs.nth(i).click();
    await page.waitForTimeout(1300);
    const win = page.locator("#flows .overflow-y-auto").first();
    await win.evaluate((el) => (el.style.height = "auto"));
    await page.locator("#flows .lg\\:grid-cols-\\[20rem_minmax\\(0\\,1fr\\)\\] > div").nth(1).screenshot({ path: `${OUT}${theme}-1280-flow-${i + 1}.png` });
    await win.evaluate((el) => (el.style.height = ""));
  }
  await ctx.close();
}
await browser.close();
