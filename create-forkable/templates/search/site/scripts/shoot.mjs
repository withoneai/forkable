// QA shots: every section plus the first screen, at 1280, 1536 and 390 in
// dark and light. Run `pnpm build && pnpm preview --port 5690` first, then
// node scripts/shoot.mjs [url] [outDir] [widths]. Prints any element that
// runs past the page width.
import { chromium } from "/opt/homebrew/lib/node_modules/playwright/index.mjs";
import { mkdirSync } from "node:fs";
const URL_ = process.argv[2] ?? "http://127.0.0.1:5690/";
const OUT = process.argv[3] ?? new URL("../docs/qa/launch/", import.meta.url).pathname;
const widths = (process.argv[4] ?? "1280,1536,390").split(",").map(Number);
mkdirSync(OUT, { recursive: true });
const sections = ["top", "integrations", "search", "ask", "surfaces", "faq", "fork"];
const browser = await chromium.launch();
for (const width of widths) {
  for (const theme of ["dark", "light"]) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 1000 }, deviceScaleFactor: width < 500 ? 2 : 1 });
    await ctx.addInitScript((t) => localStorage.setItem("search-site-theme", t), theme);
    const page = await ctx.newPage();
    const errs = [];
    page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
    page.on("pageerror", (e) => errs.push(String(e)));
    await page.goto(URL_, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const ov = await page.evaluate(() => {
      const w = document.documentElement.clientWidth;
      const bad = [];
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.right > w + 1 && r.width > 0 && getComputedStyle(el).position !== "fixed") bad.push(`${el.tagName}.${(el.className?.baseVal ?? el.className ?? "").toString().slice(0, 60)} right=${Math.round(r.right)}`);
      }
      return { scrollW: document.documentElement.scrollWidth, w, bad: bad.slice(0, 8) };
    });
    console.log(width, theme, JSON.stringify(ov), errs.slice(0, 3));
    // Walk the page so every reveal fires, then shoot each section as a clip of the full page.
    const H = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < H; y += 300) { await page.evaluate((y) => window.scrollTo(0, y), y); await page.waitForTimeout(120); }
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${OUT}${theme}-${width}-viewport.png` });
    await page.addStyleTag({ content: "header{position:absolute!important}" });
    for (const id of [...sections, "footer"]) {
      const box = await page.locator(id === "footer" ? "footer" : `#${id}`).evaluate((el) => { const r = el.getBoundingClientRect(); return { x: 0, y: r.top + window.scrollY, width: document.documentElement.clientWidth, height: r.height }; });
      await page.screenshot({ path: `${OUT}${theme}-${width}-${id}.png`, fullPage: true, clip: box });
    }
    await ctx.close();
  }
}
await browser.close();
