import { chromium } from "/opt/homebrew/lib/node_modules/playwright/index.mjs";
const OUT = process.env.HOME + "/projects/forkable-landing-blocks/site/docs/qa/search-card/";
const browser = await chromium.launch();
for (const width of [1280, 390]) {
  for (const theme of ["dark", "light"]) {
    const ctx = await browser.newContext({ viewport: { width, height: width > 500 ? 1000 : 844 }, colorScheme: theme, deviceScaleFactor: width > 500 ? 1 : 2 });
    const page = await ctx.newPage();
    await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    const isDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
    if ((theme === "dark") !== isDark) { await page.click("[data-theme-toggle]"); await page.waitForTimeout(400); }
    for (const id of ["top", "templates"]) {
      if (id === "templates") await page.addStyleTag({ content: "header:not(section header){visibility:hidden!important}" });
      const el = page.locator(`#${id}`);
      await el.scrollIntoViewIfNeeded();
      await page.waitForTimeout(900);
      await el.screenshot({ path: `${OUT}${theme}-${width}-${id === "top" ? "hero" : id}.png` });
    }
    // Hover the Search card to select it, then shoot the gallery again.
    const card = page.locator("#templates a", { hasText: "Personal search" }).first();
    await card.hover(); await page.waitForTimeout(600);
    await page.locator("#templates").screenshot({ path: `${OUT}${theme}-${width}-templates-search-selected.png` });
    await ctx.close();
  }
}
await browser.close();
console.log("ok");
