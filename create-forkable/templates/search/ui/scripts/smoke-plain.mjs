#!/usr/bin/env node
// UI smoke for plain sentences (SPEC D48, D49), light and dark:
//   home speaks in sentences, a sentence becomes removable chips, removing one
//   keeps the words, "Search the exact words instead" quotes them all, a name two
//   people share asks, typed filters still work, the Cheatsheet lists them, recent
//   searches show the sentence as typed, date phrases follow the browser's zone
//   (a run in Asia/Qatar), the chips and choices with the keyboard only, a negation
//   offered and not applied, and the first-index panel on the mock (a tool that stops
//   before its first read stays in it, and "Everything is in" waits for it).
//
//   SMOKE_URL=http://localhost:5782 node scripts/smoke-plain.mjs
//       a UI on its own port proxied to a real server on the Acme sample (never 5680)
//   MOCK_URL=http://localhost:5783   a running mock UI for the first-index steps, else it starts one
//   SHOTS=1                          screenshots into docs/qa/plain-language/
//
// Exits 0 when every step passes, 1 otherwise.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const uiDir = resolve(here, "..");
const SHOTS = resolve(uiDir, "../docs/qa/plain-language");
const FAILS = "/tmp/search-smoke-plain";
mkdirSync(FAILS, { recursive: true });
if (process.env.SHOTS) mkdirSync(SHOTS, { recursive: true });

const refuseLive = (url) => {
  if (/:(5680|52289)(\/|$)/.test(url) && process.env.SEARCH_LIVE_OK !== "1") { console.error(`Refusing ${url}: that is the running Search on ~/.search.`); process.exit(2); }
};
const base = process.env.SMOKE_URL;
if (!base) { console.error("Set SMOKE_URL to a UI proxied to a server on the Acme sample (tmp SEARCH_HOME, not 5680)."); process.exit(2); }
refuseLive(base);
async function up(url) { try { const r = await fetch(url); return r.ok; } catch { return false; } }
let mockBase = process.env.MOCK_URL;
let child = null;
if (!mockBase) {
  mockBase = "http://localhost:5783";
  child = spawn("npx", ["vite", "--port", "5783", "--strictPort"], { cwd: uiDir, env: { ...process.env, VITE_MOCK: "1", NODE_ENV: "development" }, stdio: "ignore" });
  for (let i = 0; i < 60 && !(await up(mockBase)); i++) await new Promise((r) => setTimeout(r, 500));
  if (!(await up(mockBase))) { console.error("could not start the mock UI on 5783"); child.kill(); process.exit(1); }
}

const browser = await chromium.launch({ headless: !process.env.SMOKE_HEADED });
let page;
let errors = [];
let failed = 0, n = 0;
async function step(name, fn) {
  n++;
  const t0 = Date.now();
  try {
    await fn();
    console.log(`  ok  ${String(n).padStart(2)} ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    failed++;
    const shot = `${FAILS}/step-${n}.png`;
    await page?.screenshot({ path: shot }).catch(() => {});
    console.log(`  FAIL ${String(n).padStart(2)} ${name}\n       ${String(e.message ?? e).split("\n")[0]}\n       screen: ${shot}`);
  }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const shoot = async (name) => { if (process.env.SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const box = () => page.getByTestId("search-box").first();
const boxValue = () => box().inputValue();
const waitQ = (want) => page.waitForFunction((w) => new URL(location.href).searchParams.get("q") === w, want, { timeout: 8000 });
const waitBox = (want) => page.waitForFunction((w) => document.querySelector('[data-testid="search-box"]')?.value === w, want, { timeout: 5000 });
const understoodLabels = async () => (await page.getByTestId("understood").locator("[data-understood]").allInnerTexts()).map((s) => s.trim());
async function searchFor(q) {
  await box().click();
  await box().fill(q);
  await box().press("Enter");
  await waitQ(q);
  await settle();
}
// the URL moves first; wait for React to render the new query and its answer to land
async function settle() {
  await page.waitForTimeout(120);
  await page.waitForSelector('[data-testid="results"][data-loading="0"]', { timeout: 10_000 });
}
async function blurBox() { await page.evaluate(() => (document.activeElement instanceof HTMLElement) && document.activeElement.blur()); }
async function waitUnderstood(min) {
  await page.waitForFunction((m) => document.querySelectorAll('[data-testid="understood"] [data-understood]').length >= m, min, { timeout: 8000 });
}

// Dates the way a zone ahead of UTC sees them: a day label for "yesterday" there.
const dayIn = (tz, offsetDays) => {
  const t = new Date(Date.now() + offsetDays * 86_400_000);
  return t.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: tz });
};

console.log(`Plain-language smoke against ${base} (first index on ${mockBase})`);

for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
  page = await ctx.newPage();
  errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await step(`[${theme}] sample sign-in`, async () => {
    await page.goto(`${base}/start`);
    await page.evaluate((t) => { localStorage.clear(); localStorage.setItem("search.theme", t); localStorage.setItem("search.dock.open", "0"); }, theme);
    await page.goto(`${base}/start`);
    await page.getByTestId("try-sample").click();
    await page.waitForURL((u) => u.pathname === "/", { timeout: 15_000 });
    await box().waitFor({ timeout: 10_000 });
  });

  await step(`[${theme}] home speaks in sentences from the person's data`, async () => {
    await page.getByTestId("try").first().waitFor({ timeout: 10_000 });
    const tries = await page.getByTestId("try").allInnerTexts();
    expect(tries.length >= 2, `expected Try sentences, got ${tries.length}`);
    expect(tries.every((t) => !/\b[a-z]+:\S/.test(t)), `a Try chip still shows a filter: ${tries.join(" | ")}`);
    const tip = await page.getByTestId("tip").innerText();
    expect(/the way you would say it/.test(tip) && !/\b[a-z]+:\S/.test(tip), `tip line: ${tip}`);
    const ph = await box().getAttribute("placeholder");
    // one hint for asking (polish item 12): the tip line names the example and the key, the box does not repeat it
    expect(/ask/i.test(tip) && !/like “/.test(ph ?? ""), `tip: ${tip} placeholder: ${ph}`);
    await shoot(`home-${theme}`);
  });

  await step(`[${theme}] a Try sentence runs and is understood`, async () => {
    const t = (await page.getByTestId("try").allInnerTexts())[0];
    await page.getByTestId("try").first().click();
    await waitQ(t);
    await settle();
    await waitUnderstood(1);
  });

  await step(`[${theme}] "emails from Priya last month" becomes three chips`, async () => {
    await searchFor("emails from Priya last month");
    await waitUnderstood(3);
    const labels = await understoodLabels();
    expect(labels[0] === "Emails" && labels[1] === "From Priya Shah" && /^[A-Z][a-z]+ \d{4}$/.test(labels[2] ?? ""), `labels: ${labels.join(" | ")}`);
    const kinds = await page.locator('[data-testid="result-row"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-kind")));
    expect(kinds.every((k) => k === "email_thread"), `non-mail rows: ${kinds.join(",")}`);
    expect(await boxValue() === "emails from Priya last month", "the box text changed on its own");
    await page.getByTestId("exact-words").waitFor();
    await shoot(`understood-${theme}`);
  });

  await step(`[${theme}] removing a chip keeps the words`, async () => {
    await page.getByRole("button", { name: "Remove From Priya Shah" }).click();
    await waitQ('emails "from Priya" last month');
    await settle();
    await waitBox('emails "from Priya" last month');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="understood"] [data-understood]').length === 2, null, { timeout: 8000 });
    const labels = await understoodLabels();
    expect(!labels.some((l) => /Priya/.test(l)), `Priya is still a filter: ${labels.join(" | ")}`);
  });

  await step(`[${theme}] "Search the exact words instead" quotes every phrase`, async () => {
    await page.getByTestId("exact-words").click();
    await waitQ('"emails" "from Priya" "last month"');
    await settle();
    await page.waitForFunction(() => !document.querySelector('[data-testid="understood"]'), null, { timeout: 8000 });
  });

  await step(`[${theme}] two Mia Parks: a choice, not a pick`, async () => {
    await searchFor("emails from Mia");
    await page.getByTestId("understand-choices").waitFor({ timeout: 8000 });
    const choices = page.getByTestId("understand-choices").getByRole("button");
    const count = await choices.count();
    expect(count >= 2, `expected two choices, got ${count}`);
    const labels = await understoodLabels();
    expect(labels.length === 1 && labels[0] === "Emails", `only Emails should apply: ${labels.join(" | ")}`);
    await shoot(`choices-${theme}`);
    await choices.first().click();
    await page.waitForFunction(() => /from:mia@acme\.com/.test(new URL(location.href).searchParams.get("q") ?? ""), null, { timeout: 8000 });
    await page.waitForFunction(() => !document.querySelector('[data-testid="understand-choices"]'), null, { timeout: 8000 });
  });

  // keyboard only (D48): the chips come right after the box, Enter and Space press them, focus comes back
  const active = () => page.evaluate(() => { const a = document.activeElement; return { label: a?.getAttribute("aria-label") ?? "", testid: a?.getAttribute("data-testid") ?? "", inChoices: !!a?.closest('[data-testid="understand-choices"]'), text: (a?.textContent ?? "").trim().slice(0, 40) }; });
  async function tabUntil(pred, max = 8) {
    for (let i = 0; i < max; i++) { await page.keyboard.press("Tab"); const a = await active(); if (pred(a)) return a; }
    throw new Error(`Tab never reached the target; at ${JSON.stringify(await active())}`);
  }
  await step(`[${theme}] keyboard: Tab from the box goes to the chips`, async () => {
    await searchFor("emails from Priya last month");
    await waitUnderstood(3);
    await box().focus();
    await page.keyboard.press("Tab");
    const a = await active();
    expect(a.label === "Remove Emails", `Tab from the box landed on ${JSON.stringify(a)}`);
  });
  await step(`[${theme}] keyboard: Enter on a chip's remove keeps its words, focus back in the box`, async () => {
    await page.keyboard.press("Tab");
    expect((await active()).label === "Remove From Priya Shah", `second Tab: ${JSON.stringify(await active())}`);
    await page.keyboard.press("Enter");
    await waitQ('emails "from Priya" last month');
    await settle();
    expect((await active()).testid === "search-box", `focus after remove: ${JSON.stringify(await active())}`);
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="understood"] [data-understood]').length === 2, null, { timeout: 8000 });
  });
  await step(`[${theme}] keyboard: Space on a chip's remove works too`, async () => {
    await page.keyboard.press("Tab");
    expect((await active()).label === "Remove Emails", `Tab: ${JSON.stringify(await active())}`);
    await page.keyboard.press(" ");
    await waitQ('"emails" "from Priya" last month');
    await settle();
    expect((await active()).testid === "search-box", `focus after Space: ${JSON.stringify(await active())}`);
  });
  await step(`[${theme}] keyboard: "Search the exact words instead" with Enter`, async () => {
    await searchFor("emails from Priya last month");
    await waitUnderstood(3);
    await box().focus();
    await tabUntil((a) => a.testid === "exact-words");
    await page.keyboard.press("Enter");
    await waitQ('"emails" "from Priya" "last month"');
    await settle();
    expect((await active()).testid === "search-box", `focus after exact words: ${JSON.stringify(await active())}`);
  });
  await step(`[${theme}] keyboard: a Did you mean choice with Enter`, async () => {
    await searchFor("emails from Mia");
    await page.getByTestId("understand-choices").waitFor({ timeout: 8000 });
    await box().focus();
    await tabUntil((a) => a.inChoices);
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => /from:mia/.test(new URL(location.href).searchParams.get("q") ?? ""), null, { timeout: 8000 });
    await settle();
    expect((await active()).testid === "search-box", `focus after a choice: ${JSON.stringify(await active())}`);
  });
  await step(`[${theme}] keyboard: a negation is offered, never applied`, async () => {
    await searchFor("emails that are not from Priya");
    await page.getByTestId("understand-choices").waitFor({ timeout: 8000 });
    const labels = await understoodLabels();
    expect(!labels.some((l) => /Priya/.test(l)), `Priya applied: ${labels.join(" | ")}`);
    expect(/Not from Priya Shah/.test(await page.getByTestId("understand-choices").innerText()), "no exclusion offered");
  });

  await step(`[${theme}] typed filters work as before and win`, async () => {
    await searchFor("globex from:priya");
    await page.getByTestId("result-row").first().waitFor();
    expect(/priya/i.test(await page.locator('[data-chip="from"]').innerText()), "From chip did not light up");
    expect(await page.getByTestId("understood").count() === 0, "a typed filter was read again");
  });

  await step(`[${theme}] words that only look like filters stay words`, async () => {
    for (const q of ["from scratch", "in progress", "with regards"]) {
      await searchFor(q);
      expect(await page.getByTestId("understood").count() === 0, `"${q}" was read as a filter`);
    }
  });

  await step(`[${theme}] filter menu reads in plain words`, async () => {
    await searchFor("open deals");
    await waitUnderstood(2);
    await page.getByTestId("add-filter").click();
    const menu = await page.getByRole("menu").innerText();
    expect(!/\b[a-z]+:/.test(menu), `the menu shows filter syntax: ${menu}`);
    expect(/Show only/.test(menu) && /Includes/.test(menu), `menu: ${menu}`);
    await shoot(`filter-menu-${theme}`);
    await page.keyboard.press("Escape");
  });

  await step(`[${theme}] the Cheatsheet documents typed filters`, async () => {
    await blurBox();
    await page.keyboard.press("?");
    await page.getByTestId("cheatsheet-filters").waitFor({ timeout: 5000 });
    expect(/from:priya/.test(await page.getByTestId("cheatsheet-filters").innerText()), "no from: in the Cheatsheet");
    await page.getByTestId("cheatsheet-filters").scrollIntoViewIfNeeded();
    await shoot(`cheatsheet-${theme}`);
    await page.keyboard.press("Escape");
  });

  await step(`[${theme}] recent searches show sentences as typed`, async () => {
    await page.goto(`${base}/`);
    await page.getByLabel("Recent").waitFor({ timeout: 8000 });
    const recent = await page.getByLabel("Recent").innerText();
    expect(recent.includes("open deals") && recent.includes("emails from Mia"), `recent: ${recent.slice(0, 300)}`);
    expect(!/\n\?\n/.test(recent), "a keyboard shortcut became a search");
  });

  await step(`[${theme}] no page errors`, async () => { expect(errors.length === 0, errors.join(" | ")); });
  await ctx.close();
}

// Asia/Qatar: a zone ahead of UTC, where date code has bitten here before.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: "Asia/Qatar", colorScheme: "light" });
  page = await ctx.newPage();
  errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const zones = [];
  page.on("request", (r) => { const u = new URL(r.url()); if (u.pathname === "/api/v1/search") zones.push(u.searchParams.get("tz")); });
  await step("[Asia/Qatar] sign in", async () => {
    await page.goto(`${base}/start`);
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem("search.dock.open", "0"); });
    await page.goto(`${base}/start`);
    await page.getByTestId("try-sample").click();
    await page.waitForURL((u) => u.pathname === "/", { timeout: 15_000 });
    await box().waitFor();
  });
  await step("[Asia/Qatar] yesterday and today are Doha's days, and the zone is sent", async () => {
    await searchFor("pricing yesterday");
    await waitUnderstood(1);
    const y = (await understoodLabels())[0];
    expect(y === `Yesterday, ${dayIn("Asia/Qatar", -1)}`, `got "${y}", Doha's yesterday is ${dayIn("Asia/Qatar", -1)}`);
    await searchFor("meetings today");
    await waitUnderstood(2);
    const t = (await understoodLabels())[1];
    expect(t === `Today, ${dayIn("Asia/Qatar", 0)}`, `got "${t}", Doha's today is ${dayIn("Asia/Qatar", 0)}`);
    expect(zones.length > 0 && zones.every((z) => z === "Asia/Qatar"), `tz sent: ${[...new Set(zones)].join(",")}`);
  });
  await step("[Asia/Qatar] last week starts on Doha's Monday", async () => {
    await searchFor("emails last week");
    await waitUnderstood(2);
    const l = (await understoodLabels())[1];
    // Monday of last week, Doha's calendar
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Qatar", year: "numeric", month: "numeric", day: "numeric", weekday: "short" }).formatToParts(new Date()).map((p) => [p.type, p.value]));
    const dow = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday);
    const today = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
    const mon = new Date(today - (dow + 7) * 86_400_000);
    const sun = new Date(mon.getTime() + 6 * 86_400_000);
    const f = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    expect(l === `Last week, ${f(mon)} to ${f(sun)}`, `got "${l}", expected Last week, ${f(mon)} to ${f(sun)}`);
    await shoot("qatar-dates");
  });
  await step("[Asia/Qatar] no page errors", async () => { expect(errors.length === 0, errors.join(" | ")); });
  await ctx.close();
}

// First index (mock): the panel, the sentence, the bars, then one notice.
for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: theme });
  page = await ctx.newPage();
  errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await step(`[${theme}] first index: you can search now`, async () => {
    await page.goto(`${mockBase}/`);
    await page.evaluate((t) => { localStorage.setItem("search.theme", t); localStorage.setItem("search.mock", JSON.stringify({ signedIn: true, setup: {} })); localStorage.setItem("search.dock.open", "0"); localStorage.setItem("search.mock.firstIndex", String(Date.now())); }, theme);
    await page.goto(`${mockBase}/`);
    await page.getByTestId("first-index").waitFor({ timeout: 10_000 });
    const sentence = await page.getByTestId("first-index-sentence").innerText();
    expect(/^You can search now\. (Gmail|Slack|HubSpot) is \d+% in/.test(sentence), `sentence: ${sentence}`);
    const rows = await page.getByTestId("first-index-row").count();
    expect(rows === 3, `expected 3 tools, got ${rows}`);
    await page.waitForTimeout(2500);
    await shoot(`first-index-${theme}`);
  });
  await step(`[${theme}] first index: search works while it reads`, async () => {
    await box().fill("globex");
    await box().press("Enter");
    await page.getByTestId("result-row").first().waitFor({ timeout: 8000 });
    await page.goto(`${mockBase}/`);
    await page.getByTestId("first-index").waitFor({ timeout: 8000 });
  });
  await step(`[${theme}] first index: gone when everything is in, with one notice`, async () => {
    await page.getByTestId("first-index").waitFor({ state: "detached", timeout: 30_000 });
    await page.getByText("Everything is in").waitFor({ timeout: 5000 });
    expect(await page.getByText("Everything is in").count() === 1, "more than one notice");
  });
  await step(`[${theme}] first index: a tool that stops stays, with why and what to do`, async () => {
    await page.evaluate(() => { localStorage.setItem("search.mock.firstIndex", String(Date.now())); localStorage.setItem("search.mock.firstIndexStop", "slack:auth_needed"); });
    await page.goto(`${mockBase}/`);
    await page.getByTestId("first-index-stopped").waitFor({ timeout: 25_000 });
    const row = await page.getByTestId("first-index-stopped").innerText();
    expect(/Needs sign-in/.test(row) && /Reconnect Slack in One/.test(row), `row: ${row}`);
    expect(/Slack stopped before it came in/.test(await page.getByTestId("first-index-sentence").innerText()), "the sentence does not say Slack stopped");
    await shoot(`first-index-stopped-${theme}`);
  });
  await step(`[${theme}] first index: no "Everything is in" while a tool has stopped`, async () => {
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="first-index-row"]').length === 0, null, { timeout: 30_000 });
    await page.waitForTimeout(3000);
    expect(await page.getByText("Everything is in").count() === 0, "Everything is in showed with Slack stopped");
    expect(await page.getByTestId("first-index").count() === 1, "the panel went away with Slack stopped");
    expect(/^You can search what is in\. Slack stopped/.test(await page.getByTestId("first-index-sentence").innerText()), "sentence after the others came in");
    await page.getByTestId("first-index-open").focus();
    await page.keyboard.press("Enter");
    await page.waitForURL((u) => u.pathname.startsWith("/sources/"), { timeout: 8000 });
    await page.evaluate(() => { localStorage.removeItem("search.mock.firstIndexStop"); localStorage.removeItem("search.mock.firstIndex"); });
  });
  await step(`[${theme}] no page errors (mock)`, async () => { expect(errors.length === 0, errors.join(" | ")); });
  await ctx.close();
}

await browser.close();
if (child) child.kill();
console.log(failed ? `${failed} of ${n} steps failed` : `all ${n} steps passed`);
process.exit(failed ? 1 : 0);
