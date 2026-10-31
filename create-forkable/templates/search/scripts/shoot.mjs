#!/usr/bin/env node
// QA screenshots (SPEC 19, Phase 4) of every screen against a REAL server on the
// Acme sample: home, results, a preview per object type, chat with citations and
// a proposal, the answer strip, palette, shortcuts, the person preview with a
// possible match, Integrations, source detail, each New profile step, Access,
// setup, empty and error states. Light and dark at each width.
//
//   SHOOT_URL=http://localhost:5780 node scripts/shoot.mjs [outDir] [widths]
//   defaults: docs/qa/phase4, 1024,1280,1536. SHOOT_ONLY=home,results limits the set.
//
// It signs in with "Try the Acme sample" once and reuses that session. It never
// saves a New profile, so the sample index is left as it was. Point it at a
// server with its own SEARCH_HOME, not at someone's working copy.
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, "../ui/package.json"));
const { chromium } = require("playwright");

// Never against the owner's running copy (5680/52289): tests and shots use their own
// server on a tmp SEARCH_HOME. SEARCH_LIVE_OK=1 overrides, for a deliberate look only.
const refuseLive = (url) => {
  if (/:(5680|52289)(\/|$)/.test(url) && process.env.SEARCH_LIVE_OK !== "1") {
    console.error(`Refusing ${url}: that is the running Search on ~/.search. Start one on another port with a tmp SEARCH_HOME and pass its URL.`);
    process.exit(2);
  }
};
const base = process.env.SHOOT_URL ?? "http://localhost:5780";
refuseLive(base);
const out = resolve(process.argv[2] ?? resolve(here, "../docs/qa/phase4"));
const widths = (process.argv[3] ?? "1024,1280,1536").split(",").map(Number);
const only = process.env.SHOOT_ONLY ? new Set(process.env.SHOOT_ONLY.split(",")) : null;
const themes = (process.env.SHOOT_THEMES ?? "light,dark").split(",");
mkdirSync(out, { recursive: true });
const mod = process.platform === "darwin" ? "Meta" : "Control";

const browser = await chromium.launch();
// one sample session for every context
const signin = await browser.newContext();
{
  const p = await signin.newPage();
  await p.goto(`${base}/start`);
  await p.getByTestId("try-sample").click();
  await p.waitForURL((u) => u.pathname === "/", { timeout: 60_000 });
}
const state = await signin.storageState();
const api = async (path) => {
  const r = await signin.request.get(`${base}/api/v1${path}`);
  if (!r.ok()) throw new Error(`${path}: ${r.status()}`);
  return r.json();
};
const sources = (await api("/sources")).sources;
const src = (platform, model) => sources.find((s) => s.platform === platform && (!model || s.profile?.model === model || s.profile?.id?.endsWith(model)))?.id ?? sources[0].id;
const ent = async (q) => (await api(`/entities?q=${encodeURIComponent(q)}`))[0]?.id;
const priya = await ent("priya shah");
const ravi = await ent("ravi menon");
await signin.close();

const q = (s) => `/?q=${encodeURIComponent(s)}`;
// opens the preview on the first row of a query whose title matches
const pick = (re) => async (p) => {
  await p.getByTestId("result-row").first().waitFor({ timeout: 10_000 });
  const rows = p.getByTestId("result-row");
  const n = await rows.count();
  for (let i = 0; i < n; i++) if (re.test(await rows.nth(i).innerText())) { await rows.nth(i).click(); break; }
  await p.getByTestId("preview").waitFor({ timeout: 5000 }).catch(() => {});
};
const first = pick(/./);

const shots = [
  { name: "start", path: "/start", signedOut: true },
  { name: "home", path: "/" },
  { name: "results", path: q("globex renewal"), act: async (p) => { await first(p); await p.waitForTimeout(1500); } },
  { name: "results-operators", path: q("globex from:priya after:30d") },
  { name: "lane-needs-you", path: q("lane:needs-you") },
  { name: "lane-vip", path: q("lane:vip globex") },
  { name: "preview-mail", path: q("globex renewal terms"), act: pick(/renewal terms/i) },
  { name: "preview-event", path: q("type:event globex"), act: first },
  { name: "preview-meeting", path: q("type:meeting globex"), act: first },
  { name: "preview-deal", path: q("type:deal globex"), act: first },
  { name: "preview-issue", path: q("ACME-298"), act: first },
  { name: "preview-message", path: q("in:slack globex closed"), act: first },
  { name: "preview-doc", path: q("in:notion globex account plan"), act: first },
  { name: "preview-note", path: q("type:note liability"), act: first },
  { name: "preview-person-match", path: q("type:person ravi"), act: first },
  { name: "preview-person-merged", path: q("type:person priya"), act: first },
  { name: "preview-company", path: q("type:company globex"), act: first },
  { name: "entity-person", path: `/people/${ravi}` },
  { name: "entity-priya", path: `/people/${priya}` },
  { name: "answer-strip", path: q("who is priya shah?"), act: async (p) => { await p.getByTestId("answer-strip").waitFor({ timeout: 10_000 }).catch(() => {}); await p.waitForTimeout(800); } },
  { name: "chat", path: q("globex"), act: async (p) => {
    await p.keyboard.press(`${mod}+Shift+j`);
    await p.getByTestId("composer").fill("Where are we with Globex?");
    await p.getByTestId("composer").press(`${mod}+Enter`);
    await p.waitForSelector('[data-testid="proposal"]', { timeout: 20_000 });
    await p.locator('[data-testid="dock"] [data-citation]').first().hover();
    await p.waitForTimeout(400);
  } },
  { name: "palette", path: q("globex"), act: async (p) => { await p.keyboard.press(`${mod}+k`); await p.keyboard.type("glob"); } },
  { name: "shortcuts", path: "/", act: async (p) => { await p.locator("body").click({ position: { x: 600, y: 700 } }); await p.keyboard.press("Shift+?"); } },
  { name: "empty", path: q("pricing from:jules in:linear") },
  { name: "error", path: q("globex"), route: "**/api/v1/search?**" },
  { name: "integrations", path: "/settings/integrations" },
  { name: "source-detail", path: `/sources/${src("hubspot", "deals")}` },
  { name: "source-runs", path: `/sources/${src("slack", "messages")}`, act: async (p) => { await p.getByRole("tab", { name: /Runs/ }).click().catch(() => {}); } },
  { name: "new-profile-1-platform", path: "/settings/integrations/new", act: async (p) => { await p.getByTestId("platform-search").fill("zendesk"); } },
  { name: "new-profile-2-models", path: "/settings/integrations/new", act: (p) => np(p, 1) },
  { name: "new-profile-3-fields", path: "/settings/integrations/new", act: (p) => np(p, 2) },
  { name: "new-profile-4-identity", path: "/settings/integrations/new", act: (p) => np(p, 3) },
  { name: "new-profile-5-review", path: "/settings/integrations/new", act: (p) => np(p, 4) },
  { name: "access", path: "/access", act: async (p) => { await p.getByTestId("write-row").first().click().catch(() => {}); } },
  { name: "setup-connect", path: "/setup/connect" },
  { name: "settings-general", path: "/settings/general" },
  { name: "settings-search", path: "/settings/search" },
];

async function np(p, steps) {
  await p.getByTestId("platform-search").fill("zendesk");
  await p.getByTestId("platform-zendesk").click();
  for (let i = 0; i < steps; i++) {
    await p.waitForFunction(() => { const b = document.querySelector('[data-testid="sheet-primary"]'); return b && !b.hasAttribute("disabled") && b.getAttribute("aria-busy") !== "true"; }, null, { timeout: 30_000 });
    await p.getByTestId("sheet-primary").click();
    await p.waitForTimeout(600);
  }
}

let n = 0;
for (const w of widths) for (const theme of themes) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 820 }, colorScheme: theme, deviceScaleFactor: 1, storageState: state });
  const signedOut = await browser.newContext({ viewport: { width: w, height: 820 }, colorScheme: theme, deviceScaleFactor: 1 });
  for (const s of shots.filter((x) => !only || only.has(x.name))) {
    const page = await (s.signedOut ? signedOut : ctx).newPage();
    if (s.route) await page.route(s.route, (r) => r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "unavailable", message: "The database is not answering." } }) }));
    await page.goto(`${base}/start`);
    await page.evaluate((t) => { localStorage.setItem("search.theme", t); localStorage.setItem("search.dock.open", "0"); localStorage.setItem("search.coached", "1"); localStorage.setItem("search.kwbanner", "1"); }, theme);
    await page.goto(`${base}${s.path}`);
    await page.waitForTimeout(900);
    try { if (s.act) await s.act(page); } catch (e) { console.log(`  ${s.name} ${w} ${theme}: ${String(e.message).split("\n")[0]}`); }
    // connector logos come from assets.withone.ai and load lazily
    await page.waitForFunction(() => [...document.images].every((i) => { const r = i.getBoundingClientRect(); return i.complete || r.bottom < 0 || r.top > innerHeight || r.width === 0; }), null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${out}/${s.name}-${theme}-${w}.png` });
    await page.close();
    n++;
  }
  await ctx.close();
  await signedOut.close();
  console.log(`shot ${w} ${theme}`);
}
await browser.close();
console.log(`wrote ${n} screenshots to ${out}`);
