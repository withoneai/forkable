// QA shots of /mcp: each section at 390, 1280 and 1536, dark and light, plus
// a Confirm dialog and a mid-replay frame. Same pattern as shoot.mjs; run
// against `pnpm preview --port 4174`. Reduced motion opens each chat
// finished, so the section shots are deterministic.
import { chromium } from "/opt/homebrew/lib/node_modules/playwright/index.mjs";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:4174";
const OUT = new URL("../docs/qa/mcp/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const widths = [390, 1280, 1536];
const sections = ["top", "how", "flows", "saved", "why", "tools", "more"];
const browser = await chromium.launch();

for (const width of widths) {
  for (const theme of ["dark", "light"]) {
    const ctx = await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: 2, reducedMotion: "reduce", colorScheme: theme });
    await ctx.addInitScript((t) => localStorage.setItem("forkable-site-theme", t), theme);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(`${BASE}/mcp/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    for (const id of sections) {
      const el = page.locator(`#${id}`);
      await el.scrollIntoViewIfNeeded();
      await page.waitForTimeout(900); // reveal and sample latency
      await el.screenshot({ path: `${OUT}${theme}-${width}-${id}.png` });
    }
    // A write in a flow opens the host's Confirm.
    await page.locator("#flows").scrollIntoViewIfNeeded();
    await page.getByRole("tab", { name: /Follow-up radar/ }).click();
    await page.waitForTimeout(1200);
    const flowWin = page.locator("#flows .fk-canvas").first();
    await flowWin.getByRole("button", { name: /Pricing for the Vandelay rollout/ }).click();
    await page.waitForTimeout(200);
    await flowWin.getByRole("button", { name: /Send nudge/ }).click();
    await page.waitForTimeout(400);
    await page.locator("#flows [role=dialog]").screenshot({ path: `${OUT}${theme}-${width}-confirm.png` }).catch(() => {});
    await page.locator("#flows").screenshot({ path: `${OUT}${theme}-${width}-flows-confirm.png` });
    if (errors.length) console.log(`${theme} ${width} errors:`, errors);
    await ctx.close();
  }
  console.log(`done ${width}`);
}

// One frame mid-replay with motion on, to check the tool trail.
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(`${BASE}/mcp/`, { waitUntil: "networkidle" });
await page.waitForTimeout(4600);
await page.locator("#top").screenshot({ path: `${OUT}dark-1280-top-replaying.png` });
await ctx.close();

await browser.close();
