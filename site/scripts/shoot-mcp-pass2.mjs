// QA for the discoverability, source logos, confirm layer and seeded data
// pass: home hero + nav (and the mobile menu), the home In chat section, a
// flow mid-replay with its logos lighting, a finished flow, and the
// connector's Confirm on /mcp and on the home page. 390 and 1280, dark and
// light, webp into docs/qa/mcp/. Run against
// `pnpm preview --port 4174 --host 127.0.0.1`.
import { chromium } from "/opt/homebrew/lib/node_modules/playwright/index.mjs";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:4174";
const OUT = new URL("../docs/qa/mcp/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const shot = async (loc, name) => {
  const png = `${OUT}${name}.png`;
  await loc.screenshot({ path: png });
  execFileSync("cwebp", ["-quiet", "-q", "82", png, "-o", `${OUT}${name}.webp`]);
  rmSync(png);
};

const browser = await chromium.launch();
for (const width of [390, 1280]) {
  for (const theme of ["dark", "light"]) {
    const tag = `${theme}-${width}`;
    const errors = [];
    const make = async (reduced) => {
      const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, deviceScaleFactor: 2, colorScheme: theme, reducedMotion: reduced ? "reduce" : "no-preference" });
      await ctx.addInitScript((t) => localStorage.setItem("forkable-site-theme", t), theme);
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errors.push(String(e)));
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      return { ctx, page };
    };

    // Home: hero and nav, the mobile menu, the In chat section and its Confirm.
    {
      const { ctx, page } = await make(true);
      await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
      await page.waitForTimeout(700);
      await shot(page, `${tag}-home-hero-nav`);
      if (width < 1024) {
        await page.getByRole("button", { name: "Open the menu" }).click();
        await page.waitForTimeout(300);
        await shot(page, `${tag}-home-mobile-menu`);
        await page.getByRole("button", { name: "Close the menu" }).click();
      }
      const chat = page.locator("#chat");
      await chat.scrollIntoViewIfNeeded();
      await page.waitForTimeout(900);
      await shot(chat, `${tag}-home-chat`);
      await chat.getByRole("button", { name: "Reply yes" }).first().click();
      await page.waitForTimeout(400);
      await shot(chat.locator(".grid > div").first(), `${tag}-home-chat-confirm`);
      // Links from the prerendered home page land where they say.
      for (const href of ["/mcp", "/mcp#run-your-own"]) {
        const p2 = await ctx.newPage();
        const r = await p2.goto(`${BASE}${href}`, { waitUntil: "domcontentloaded" });
        const ok = r.status() === 200 && (await p2.locator("#run-your-own").count()) === 1;
        if (!ok) errors.push(`link ${href} did not reach /mcp`);
        await p2.close();
      }
      await ctx.close();
    }

    // /mcp: the hero replay mid-trail (logos lighting), with motion on.
    {
      const { ctx, page } = await make(false);
      await page.goto(`${BASE}/mcp/`, { waitUntil: "networkidle" });
      const win = page.locator("#top .stage");
      await win.scrollIntoViewIfNeeded();
      // Wait until exactly some, not all, of the sources are lit.
      const start = Date.now();
      while (Date.now() - start < 12000) {
        const lit = await page.locator("#top .source-logo[data-lit]").count();
        const all = await page.locator("#top .source-logo").count();
        if (all && lit > 0 && lit < all) break;
        await page.waitForTimeout(60);
      }
      await page.waitForTimeout(250);
      await shot(win, `${tag}-mcp-hero-lighting`);
      await ctx.close();
    }

    // /mcp: a finished flow (all lit), then the connector's Confirm.
    {
      const { ctx, page } = await make(true);
      await page.goto(`${BASE}/mcp/`, { waitUntil: "networkidle" });
      await page.locator("#flows").scrollIntoViewIfNeeded();
      await page.getByRole("tab", { name: /Follow-up radar/ }).click();
      await page.waitForTimeout(1300);
      const flowWin = page.locator("#flows .lg\\:grid-cols-\\[20rem_minmax\\(0\\,1fr\\)\\] > div").nth(1).locator("> div").first();
      await shot(flowWin, `${tag}-mcp-flow-lit`);
      await flowWin.getByRole("button", { name: /Pricing for the Vandelay rollout/ }).click();
      await page.waitForTimeout(200);
      await flowWin.getByRole("button", { name: /Send nudge/ }).click();
      await page.waitForTimeout(600);
      await shot(flowWin, `${tag}-mcp-confirm`);
      await page.keyboard.press("Escape");
      const saved = page.locator("#saved");
      await saved.scrollIntoViewIfNeeded();
      await page.waitForTimeout(700);
      await shot(saved, `${tag}-mcp-saved`);
      const why = page.locator("#why");
      await why.scrollIntoViewIfNeeded();
      await page.waitForTimeout(700);
      await shot(why, `${tag}-mcp-why`);
      await ctx.close();
    }
    if (errors.length) console.log(tag, "errors:", errors);
    console.log("done", tag);
  }
}
await browser.close();
