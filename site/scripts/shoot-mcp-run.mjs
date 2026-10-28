// QA shots for the "Run your own MCP" section on /mcp and the hero, plus the
// home page card, at 390 and 1280 in dark and light. Run against
// `pnpm preview --port 4174`; writes PNGs, then converts them to webp.
import { chromium } from "/opt/homebrew/lib/node_modules/playwright/index.mjs";
import { mkdirSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";

const BASE = process.env.BASE ?? "http://127.0.0.1:4174";
const OUT = new URL("../docs/qa/mcp/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const shots = [];

for (const width of [390, 1280]) {
  for (const theme of ["dark", "light"]) {
    const ctx = await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: 2, reducedMotion: "reduce", colorScheme: theme });
    await ctx.addInitScript((t) => localStorage.setItem("forkable-site-theme", t), theme);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(`${BASE}/mcp/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    // The floating header is fixed; keep it out of section shots.
    const hideHeader = () => page.addStyleTag({ content: "body > div > header, header.fixed { visibility: hidden !important; }" });
    const top = `${OUT}${theme}-${width}-hero.png`;
    await page.screenshot({ path: top });
    shots.push(top);
    await hideHeader();
    const el = page.locator("#run-your-own");
    // Walk through the section so every reveal fires.
    const box = await el.boundingBox();
    const y0 = await page.evaluate(() => scrollY);
    for (let y = box.y + y0 - 200; y < box.y + y0 + box.height; y += 400) {
      await page.evaluate((v) => scrollTo(0, v), y);
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(700);
    const run = `${OUT}${theme}-${width}-run-your-own.png`;
    await el.screenshot({ path: run });
    shots.push(run);
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await hideHeader();
    const chat = page.locator("#chat");
    const cb = await chat.boundingBox();
    for (let y = cb.y - 200; y < cb.y + cb.height; y += 400) {
      await page.evaluate((v) => scrollTo(0, v), y);
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(900);
    const home = `${OUT}${theme}-${width}-home-chat.png`;
    await chat.screenshot({ path: home });
    shots.push(home);
    if (errors.length) console.log(`${theme} ${width} errors:`, errors);
    await ctx.close();
  }
}
await browser.close();
for (const png of shots) {
  execFileSync("cwebp", ["-quiet", "-q", "82", png, "-o", png.replace(/\.png$/, ".webp")]);
  unlinkSync(png);
}
console.log(shots.map((s) => s.replace(/\.png$/, ".webp")).join("\n"));
