// QA shots of the tester-pass screens that read real server data, light and dark at
// 1440 and 1024: the first screen, the results with the assistant docked, a person and
// a company. Against a production build on a real server on the Acme sample (tmp
// SEARCH_HOME, never 5680/52289).
//   SHOOT_URL=http://localhost:52394 node scripts/shoot-tester.mjs [outDir]   default ../docs/qa/plain-words
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const base = process.env.SHOOT_URL;
if (!base || (/:(5680|52289)(\/|$)/.test(base) && process.env.SEARCH_LIVE_OK !== "1")) {
  console.error("Set SHOOT_URL to a Search on its own port with a tmp SEARCH_HOME (never 5680 or 52289).");
  process.exit(2);
}
const out = resolve(process.argv[2] ?? resolve(here, "../../docs/qa/plain-words"));
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ headless: true });
let n = 0;
for (const w of [1440, 1024]) for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: theme });
  const page = await ctx.newPage();
  const shot = async (name) => { await page.waitForTimeout(700); await page.screenshot({ path: `${out}/${name}-${theme}-${w}.png` }); n++; };

  // the first screen, signed out
  await page.goto(`${base}/start`);
  await page.evaluate((t) => { localStorage.clear(); localStorage.setItem("search.theme", t); }, theme);
  await page.reload();
  await page.getByTestId("try-sample").waitFor({ timeout: 20000 });
  await shot("start");

  await page.getByTestId("try-sample").click();
  await page.waitForURL((u) => !u.pathname.startsWith("/start"), { timeout: 120000 });
  const find = async (q) => (await (await page.request.get(`${base}/api/v1/search?q=${encodeURIComponent(q)}&limit=3`)).json()).entities;

  // results with the assistant docked
  await page.evaluate(() => localStorage.setItem("search.dock.open", "1"));
  await page.goto(`${base}/?q=globex`);
  await page.locator("[data-testid=results] [data-id]").first().waitFor({ timeout: 30000 });
  await page.getByTestId("order-note").getByText("Best results first").waitFor({ timeout: 20000 }).catch(() => {});
  await shot("dock-search");

  await page.evaluate(() => localStorage.setItem("search.dock.open", "0"));
  const priya = (await find("priya")).find((e) => e.type === "person");
  await page.goto(`${base}/people/${priya.id}`);
  await page.getByLabel("Timeline").waitFor({ timeout: 20000 });
  await shot("person");
  const globex = (await find("globex")).find((e) => e.type === "company");
  await page.goto(`${base}/companies/${globex.id}`);
  await page.getByLabel("Timeline").waitFor({ timeout: 20000 });
  await shot("company");
  await ctx.close();
}
await browser.close();
console.log(`shot ${n} screens into ${out}`);
