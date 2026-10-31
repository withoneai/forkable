// Search quality QA shots (did you mean, any-word fallback, date chip, badges, semantic banner), light and dark.
import { chromium } from "playwright";
const base = process.env.SHOOT_URL ?? "http://localhost:5695";
if (/:(5680|52289)(\/|$)/.test(base)) { console.error("refusing the owner's running copy"); process.exit(2); }
const out = process.argv[2];
const phase = process.argv[3] ?? "sample";
const shots = phase === "sample" ? [
  { name: "did-you-mean", q: "Owen Prise" },
  { name: "or-fallback", q: "renewal pricing hooli zebra" },
  { name: "date-chip", q: "pricing last month" },
  { name: "one-row-per-person", q: "Owen Price" },
  { name: "exact-email", q: "priya@globex.com" },
] : [
  { name: "semantic-banner", q: "globex renewal" },
];
const browser = await chromium.launch();
for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 }, colorScheme: theme, deviceScaleFactor: 2 });
  // the banner phase signs in with a session the caller made in the tmp database (SHOOT_SID)
  if (process.env.SHOOT_SID) await ctx.addCookies([{ name: "search_sid", value: process.env.SHOOT_SID, url: base }]);
  const page = await ctx.newPage();
  await page.goto(`${base}/start`);
  await page.evaluate((t) => { localStorage.setItem("search.theme", t); localStorage.setItem("search.dock.open", "0"); sessionStorage.clear(); }, theme);
  const r = await page.request.get(`${base}/api/v1/me`);
  const me = await r.json();
  if (!me.signedIn) {
    await page.goto(`${base}/start`);
    await page.getByTestId("try-sample").click();
    await page.waitForURL((u) => !u.pathname.startsWith("/start"), { timeout: 120000 }).catch(() => {});
    await page.waitForTimeout(4000);
  }
  for (const s of shots) {
    await page.goto(`${base}/?q=${encodeURIComponent(s.q)}`);
    await page.waitForSelector('[data-testid="results"]', { timeout: 20000 }).catch(async () => { await page.screenshot({ path: "/tmp/sq-shoot/fail.png" }); throw new Error("no results at " + page.url()); });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${out}/${s.name}-${theme}.png` });
  }
  await ctx.close();
}
await browser.close();
console.log("ok");
