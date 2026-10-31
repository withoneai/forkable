// Saved results smoke (D47) on the Acme sample: a refresh renders from the browser store
// with no search wait, no rerank, no answer and no Jev call; the page says so; Refresh and
// ⇧R skip every cache; the quiet check offers new results behind a pill; sign-out clears it.
// Usage: SHOOT_URL=http://localhost:5695 node ui/scripts/smoke-cache.mjs [shotsDir]
import { chromium } from "playwright";

const base = process.env.SHOOT_URL ?? "http://localhost:5695";
if (/:(5680|52289)(\/|$)/.test(base)) { console.error("refusing the owner's running copy"); process.exit(2); }
const shots = process.argv[2] ?? null;
const Q = "where are we with globex";
const STORE = "search.results.v1";

let failed = 0, passed = 0;
const check = (name, ok, detail) => {
  if (ok) { passed++; console.log(`ok   ${name}`); } else { failed++; console.log(`FAIL ${name}${detail === undefined ? "" : ` ${JSON.stringify(detail)}`}`); }
};

const browser = await chromium.launch();
for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 }, colorScheme: theme, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const seen = { search: [], rerank: [], answer: [] };
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname === "/api/v1/search") seen.search.push(u.searchParams.get("fresh") === "1" ? "fresh" : "plain");
    if (u.pathname === "/api/v1/search/rerank") seen.rerank.push(JSON.parse(r.postData() || "{}").fresh ? "fresh" : "plain");
    if (u.pathname === "/api/v1/answer") seen.answer.push(1);
  });
  const reset = () => { seen.search = []; seen.rerank = []; seen.answer = []; };
  const jevCalls = async () => (await (await page.request.get(`${base}/api/v1/ledger?limit=500`)).json()).filter((r) => r.action === "rerank").length;
  const tag = (s) => `[${theme}] ${s}`;

  await page.goto(`${base}/start`);
  await page.evaluate((t) => { localStorage.clear(); localStorage.setItem("search.theme", t); localStorage.setItem("search.dock.open", "0"); sessionStorage.clear(); }, theme);
  const me = await (await page.request.get(`${base}/api/v1/me`)).json();
  if (!me.signedIn) {
    await page.getByTestId("try-sample").click();
    await page.waitForURL((u) => !u.pathname.startsWith("/start"), { timeout: 120000 }).catch(() => {});
    await page.waitForTimeout(3000);
  }

  // 1. first visit: search, rerank and answer run once, and the page is not marked saved
  reset();
  await page.goto(`${base}/?q=${encodeURIComponent(Q)}`);
  await page.getByText("Reranked by Jev").waitFor({ timeout: 20000 });
  await page.getByTestId("answer-strip").locator("text=sources").waitFor({ timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(800);
  const firstOrder = await page.locator("[data-testid=results] [data-id]").evaluateAll((els) => els.map((e) => e.getAttribute("data-id")));
  check(tag("first visit runs search, rerank and answer"), seen.search.length >= 1 && seen.rerank.length === 1 && seen.answer.length === 1, seen);
  check(tag("first visit is not marked saved"), (await page.getByTestId("saved-note").count()) === 0);
  const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), STORE);
  check(tag("the page, its Jev order and its answer are in the browser store"), !!stored?.entries?.[0]?.order && !!stored.entries[0].answer, stored && { n: stored.entries.length, order: !!stored.entries[0]?.order, answer: !!stored.entries[0]?.answer });

  // 2. browser refresh: renders from the store, no rerank, no answer, zero Jev calls
  const jev0 = await jevCalls();
  reset();
  const t0 = Date.now();
  await page.reload();
  await page.getByTestId("saved-note").waitFor({ timeout: 5000 });
  const renderMs = Date.now() - t0;
  await page.waitForTimeout(1500);
  const order = await page.locator("[data-testid=results] [data-id]").evaluateAll((els) => els.map((e) => e.getAttribute("data-id")));
  check(tag("refresh shows Saved results with Refresh"), /Saved results from (just now|\d+ min ago)/.test(await page.getByTestId("saved-note").innerText()) && (await page.getByTestId("refresh-results").count()) === 1);
  check(tag("refresh keeps the Jev order"), JSON.stringify(order) === JSON.stringify(firstOrder) && (await page.getByText("Reranked by Jev").count()) === 1, { order: order.slice(0, 3), firstOrder: firstOrder.slice(0, 3) });
  check(tag("refresh renders without a skeleton"), (await page.getByRole("status", { name: "Loading results" }).count()) === 0 && (await page.getByRole("status", { name: "Reading the results" }).count()) === 0);
  check(tag("refresh makes no rerank and no answer call"), seen.rerank.length === 0 && seen.answer.length === 0, seen);
  check(tag("refresh makes zero Jev calls"), (await jevCalls()) === jev0, { before: jev0, after: await jevCalls() });
  check(tag("the quiet check is one plain search"), seen.search.length === 1 && seen.search[0] === "plain", seen.search);
  check(tag("no new results pill when nothing changed"), (await page.getByTestId("new-results").count()) === 0);
  console.log(`     cached render in ${renderMs} ms (reload to label)`);
  if (shots) await page.screenshot({ path: `${shots}/saved-results-${theme}.png` });

  // 3. the quiet check: a saved page that lacks two results gets a pill, applied on click
  await page.evaluate((k) => {
    const s = JSON.parse(localStorage.getItem(k));
    s.entries[0].search.results = s.entries[0].search.results.slice(0, -2);
    localStorage.setItem(k, JSON.stringify(s));
  }, STORE);
  reset();
  await page.reload();
  await page.getByTestId("saved-note").waitFor({ timeout: 5000 });
  const pill = page.getByTestId("new-results");
  await pill.waitFor({ timeout: 10000 });
  check(tag("the quiet check offers 2 new results"), (await pill.innerText()).trim() === "2 new results", await pill.innerText());
  const rowsBefore = await page.locator("[data-testid=results] [data-id]").count();
  check(tag("the list did not move under the pill"), rowsBefore === firstOrder.length - 2, { rowsBefore, first: firstOrder.length });
  if (shots) await page.screenshot({ path: `${shots}/new-results-${theme}.png` });
  await pill.click();
  await page.waitForTimeout(1500);
  check(tag("a click applies them"), (await page.locator("[data-testid=results] [data-id]").count()) === firstOrder.length && (await page.getByTestId("saved-note").count()) === 0);
  check(tag("applying asks rerank once, with no answer call"), seen.rerank.length === 1 && seen.rerank[0] === "plain" && seen.answer.length === 0, seen);

  // 4. Refresh skips every cache: a fresh search, a fresh rerank, a new answer
  await page.reload();
  await page.getByTestId("saved-note").waitFor({ timeout: 5000 });
  await page.waitForTimeout(800);
  reset();
  await page.getByTestId("refresh-results").click();
  await page.getByText("Reranked by Jev").waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
  check(tag("Refresh runs a fresh search, rerank and answer"), seen.search.includes("fresh") && seen.rerank.join() === "fresh" && seen.answer.length === 1, seen);
  check(tag("after Refresh the page is live, not saved"), (await page.getByTestId("saved-note").count()) === 0);

  // 5. ⇧R does the same from the list
  await page.reload();
  await page.getByTestId("saved-note").waitFor({ timeout: 5000 });
  await page.waitForTimeout(800);
  reset();
  await page.getByTestId("results").focus();
  await page.keyboard.press("Shift+R");
  await page.waitForTimeout(2500);
  check(tag("⇧R refreshes"), seen.search.includes("fresh") && seen.rerank.join() === "fresh", seen);

  // 6. another query, then back: the saved page again
  await page.goto(`${base}/?q=${encodeURIComponent("globex renewal")}`);
  await page.getByText("Reranked by Jev").waitFor({ timeout: 20000 });
  reset();
  await page.goBack();
  await page.getByTestId("saved-note").waitFor({ timeout: 5000 });
  await page.waitForTimeout(800);
  check(tag("returning to a query renders it saved, no rerank or answer"), seen.rerank.length === 0 && seen.answer.length === 0, seen);
  await ctx.close();
}

// sign-out through the app's own call clears the store
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${base}/start`);
  await page.getByTestId("try-sample").click().catch(() => {});
  await page.waitForURL((u) => !u.pathname.startsWith("/start"), { timeout: 120000 }).catch(() => {});
  await page.goto(`${base}/?q=${encodeURIComponent(Q)}`);
  await page.getByText("Reranked by Jev").waitFor({ timeout: 20000 });
  await page.waitForTimeout(500);
  const had = await page.evaluate((k) => !!localStorage.getItem(k), STORE);
  await page.goto(`${base}/settings`);
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL((u) => u.pathname.startsWith("/start"), { timeout: 10000 }).catch(() => {});
  const left = await page.evaluate((k) => localStorage.getItem(k), STORE);
  check("sign-out clears the saved results", had && left === null, { had, left: !!left });
  await ctx.close();
}

await browser.close();
console.log(failed ? `\n${failed} failed, ${passed} passed` : `\nall ${passed} passed`);
process.exit(failed ? 1 : 0);
