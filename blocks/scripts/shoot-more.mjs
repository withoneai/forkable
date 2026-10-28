import { chromium } from "playwright";
// QA shots of the business blocks, dark and light: node scripts/shoot-more.mjs [baseUrl]
const BASE = process.argv[2] ?? "http://localhost:5590";
const OUT = new URL("../docs/qa/blocks-more/", import.meta.url).pathname;
const ACT = {
  "rill-ask-inbox": async (p) => p.getByRole("button", { name: "What did Priya ask about the term sheet?" }).click(),
  "brief-visibility-check": async (p) => p.locator('[data-block] button', { hasText: /^Ask \d engines$/ }).click(),
  "lead-people-search": async (p) => p.locator('[data-block] button', { hasText: "Search" }).last().click(),
  "lead-enrich": async (p) => p.locator('[data-block] button', { hasText: "Enrich" }).click(),
  "lead-email-finder": async (p) => {
    await p.locator('[data-block] button', { hasText: "Find email" }).click();
    await p.getByRole("button", { name: "Verify", exact: true }).click({ timeout: 8000 });
  },
  "builder-publish-github": async (p) => p.locator('[data-block] button', { hasText: /^Publish$/ }).click(),
  "brief-citations": async (p) => p.locator('[data-block] li button').first().click(),
};
const ids = ["rill-lanes", "rill-morning-brief", "rill-ask-inbox", "rill-vip-suggestions", "brief-visibility-check", "brief-share-of-voice", "brief-citations", "lead-people-search", "lead-enrich", "lead-email-finder", "builder-action-search", "builder-manifest", "builder-publish-github"];
const browser = await chromium.launch();
const errors = [];
for (const theme of ["dark", "light"]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => errors.push(`${theme}: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${theme}: ${m.text()}`));
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate((t) => localStorage.setItem("fc-theme", t), theme);
  for (const id of ids) {
    await page.goto(`${BASE}/#/${id}`, { waitUntil: "networkidle" });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    if (ACT[id]) {
      await ACT[id](page);
      await page.waitForTimeout(1200);
    }
    const preview = page.locator("main .overflow-hidden.rounded-xl.border").first();
    await preview.screenshot({ path: `${OUT}${theme}-${id}.png` });
  }
  await page.close();
}
console.log(errors.length ? errors.join("\n") : "no console errors");
await browser.close();
