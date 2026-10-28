import { chromium } from "playwright";
const OUT = new URL("../docs/qa/", import.meta.url).pathname;
const pages = process.argv.slice(2).length ? process.argv.slice(2) : ["introduction", "mail-app", "gmail-inbox", "gmail-thread", "gmail-ai-reply", "gmail-compose", "gmail-thread-actions", "sign-in-with-one"];
const theme = process.env.THEME ?? "dark";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto("http://localhost:5590/", { waitUntil: "networkidle" });
await page.evaluate((t) => localStorage.setItem("fc-theme", t), theme);
for (const id of pages) {
  await page.goto(`http://localhost:5590/#/${id}`, { waitUntil: "networkidle" });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  if (id === "mail-app") {
    await page.locator("li button").first().click();
    await page.waitForTimeout(800);
  }
  await page.screenshot({ path: `${OUT}${theme}-${id}.png` });
}
console.log(errors.length ? errors.join("\n") : "no console errors");
await browser.close();
