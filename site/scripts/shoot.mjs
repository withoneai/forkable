import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = new URL("../docs/qa/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const widths = [1280, 1536];
const sections = ["top", "integrations", "templates", "blocks", "chat", "fork", "publish", "open-source"];
const browser = await chromium.launch();

for (const width of widths) {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle" });
  await page.waitForTimeout(400);

  for (const theme of ["dark", "light"]) {
    if (theme === "light") {
      await page.click('[data-theme-toggle]');
      await page.waitForTimeout(400);
    }
    for (const id of sections) {
      const el = page.locator(`#${id}`);
      await el.scrollIntoViewIfNeeded();
      await page.waitForTimeout(700); // let reveal-on-scroll finish
      await el.screenshot({ path: `${OUT}${theme}-${width}-${id}.png` });
    }
  }
  await page.close();
  console.log(`done ${width}`);
}

await browser.close();
