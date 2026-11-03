// The secure environment inputs, end to end in Chrome (per-project Connect):
//   pnpm exec tsx scripts/smoke-env.ts [--no-shots]
// Builds the editor, starts the server on its own ports and a scratch home
// (never 51989 or ~/.builder), with an in-memory Keychain, a Check probe
// that answers like One accepting the app, and no One CLI (nothing runs
// `one` on this computer), then:
//   - a new Connect template: the redirect URI is the shared preview
//     callback, a pasted NAME=value block fills every field (the redirect URI
//     line is left out), a value in the wrong field says where it belongs
//     and moves there, show/hide works, Check answers, Save stores it
//   - Settings, Connect templates lists it, "used by" counts the projects
//     that link it; Replace and Remove work per value
//   - a project's own Connect app ("New Connect app") saved in the same
//     screen, then Turn on One Connect; another project links the template
//   - a replay turn that reads c.env.WEATHER_API_KEY ends with "This app
//     needs WEATHER_API_KEY"; setting it there restarts the preview, and the
//     app's own API sees the value (the Worker gets it as a var); linked to
//     the template, the Worker's /api/one/health sees the Connect app too
//   - no saved value is ever in the page, any API response, the server or
//     dev server log, or a project's files (.dev.vars included)
//   - Access shows the Environment section
// and writes light and dark screenshots to docs/qa/env-setup/.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.BUILDER_SMOKE_CHILD) {
  const r = spawnSync(process.execPath, ["--import", "tsx", ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, BUILDER_SMOKE_CHILD: "1", BUILDER_DEV: "1", BUILDER_SERVER_PORT: process.env.BUILDER_SERVER_PORT ?? "51969", BUILDER_PROXY_PORT: process.env.BUILDER_PROXY_PORT ?? "51970", BUILDER_STUB_GRANT: "", BUILDER_ONE_BIN: "/nonexistent/builder-smoke/one" },
  });
  process.exit(r.status ?? 1);
}

const ROOT = join(import.meta.dirname, "..");
const SHOTS = join(ROOT, "docs", "qa", "env-setup");
const noShots = process.argv.includes("--no-shots");
const results: [string, boolean, string][] = [];
const check = (name: string, pass: boolean, detail = "") => {
  results.push([name, pass, detail]);
  console.log(`${pass ? "pass" : "FAIL"}  ${name}${detail ? `   (${detail})` : ""}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A template's Connect app. */
const CANARY = {
  ONE_CLIENT_ID: "client_acmeQ7w2Zr",
  ONE_CLIENT_SECRET: "one_secret_SMOKEsecret5Kd8Lm3Np9Rt",
  ONE_CONNECT_KEY: "sk_live_SMOKEkey4Vb7Hn2Jd6",
  ONE_PERMISSION_SET: "ask_acme_builder",
};
/** One project's own Connect app. */
const OWN = {
  ONE_CLIENT_ID: "client_acmeOwn4Tq9",
  ONE_CLIENT_SECRET: "one_secret_SMOKEown7Wd2Zs6Hk1Lp",
  ONE_CONNECT_KEY: "sk_live_SMOKEownkey3Mc8Rf5",
};
const WEATHER = "wk_SMOKEweather8Ff3Gg6Hh";
const SECRETS = [CANARY.ONE_CLIENT_SECRET, CANARY.ONE_CONNECT_KEY, OWN.ONE_CLIENT_SECRET, OWN.ONE_CONNECT_KEY, WEATHER];
const FORBIDDEN = [...SECRETS, ...SECRETS.map((v) => v.slice(-6)), CANARY.ONE_CLIENT_ID, OWN.ONE_CLIENT_ID];
const leaks = (t: string) => FORBIDDEN.filter((f) => t.includes(f));

{
  const build = spawnSync("pnpm", ["--filter", "@builder/ui", "build"], { cwd: ROOT, encoding: "utf8" });
  check("ui builds", build.status === 0, build.status === 0 ? "" : (build.stderr || build.stdout).slice(-400));
  if (build.status !== 0) process.exit(1);
}

const core = await import("@builder/core");
const { startServer } = await import("@builder/server");
const { chromium } = await import("playwright-core");
type Page = import("playwright-core").Page;

const scratch = mkdtempSync(join(tmpdir(), `${core.BRAND.slug}-smoke-env-`));
core.linkScratchTemplateCache(scratch);

// An in-memory Keychain (the real one is covered by the unit test), so the shots say what macOS would.
const keychain = new Map<string, string>();
const security: import("@builder/core").SecurityRunner = async (args, stdin) => {
  if (args[0] === "-i") {
    const m = /-s "([^"]+)" -a "([^"]+)".* -w "([^"]+)"/.exec(stdin ?? "");
    if (m) keychain.set(`${m[1]}|${m[2]}`, m[3]!);
    return { code: m ? 0 : 1, stdout: "" };
  }
  const key = `${args[args.indexOf("-s") + 1]}|${args[args.indexOf("-a") + 1]}`;
  if (args[0] === "find-generic-password") return keychain.has(key) ? { code: 0, stdout: `${keychain.get(key)}\n` } : { code: 44, stdout: "" };
  if (args[0] === "delete-generic-password") return { code: keychain.delete(key) ? 0 : 44, stdout: "" };
  return { code: 1, stdout: "" };
};
const logs: string[] = [];
const server = await startServer({ home: scratch, log: (l) => logs.push(l), audit: false, env: { backend: "keychain", security, probe: async () => ({ online: "accepted", message: "One knows this app: it accepted the client ID and secret." }) } });
const p = server.platform;
const O = core.SERVER_ORIGIN;
const browser = await chromium.launch({ headless: true, channel: "chrome" }).catch(() => chromium.launch({ headless: true }));
const bodies: string[] = [];
let failed = false;

async function newPage(theme: "light" | "dark", width = 1280): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width, height: Math.round(width * 0.66) }, colorScheme: theme, deviceScaleFactor: 2 });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: O });
  await ctx.addInitScript((t) => { localStorage.setItem("builder.theme", t); localStorage.removeItem("builder.one.skip"); }, theme);
  const pg = await ctx.newPage();
  pg.on("response", async (r) => { if (r.url().includes("/api/")) bodies.push(`${r.url()}\n${await r.text().catch(() => "")}`); });
  return pg;
}
const shot = async (pg: Page, name: string, o: { fullPage?: boolean } = {}) => {
  if (noShots) return;
  mkdirSync(SHOTS, { recursive: true });
  await sleep(350);
  await pg.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: o.fullPage ?? false });
};
/** Paste text into the focused element as a browser would. */
const paste = (pg: Page, selector: string, text: string) =>
  pg.locator(selector).evaluate((el, t) => {
    (el as HTMLElement).focus();
    const dt = new DataTransfer();
    dt.setData("text/plain", t);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);

try {
  await p.workspace.ensureTemplate(() => {});

  const json = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const r = await fetch(`${O}${path}`, { method, headers: { origin: O, "content-type": "application/json", [`x-${core.BRAND.slug}-csrf`]: p.env.csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    bodies.push(`${path}\n${text}`);
    return JSON.parse(text) as T;
  };
  const REDIRECT = `http://127.0.0.1:${core.PORTS.proxy}/api/one/callback`;
  let templateId = "";

  // ---- A new template: empty, both themes ---------------------------------------
  for (const theme of ["light", "dark"] as const) {
    const pg = await newPage(theme);
    await pg.goto(`${O}/setup/connect?new=template`, { waitUntil: "networkidle" });
    await pg.getByTestId("connect-form").waitFor();
    if (theme === "light") {
      const text = (await pg.locator("main, body").first().textContent()) ?? "";
      check("the redirect URI shown is the shared preview callback", text.includes(REDIRECT), REDIRECT);
      check("there is no redirect URI field to fill", (await pg.locator("#f-ONE_REDIRECT_URI").count()) === 0);
    }
    await shot(pg, `setup-empty-${theme}-1280`);
    await pg.context().close();
  }
  for (const width of [1024, 1536]) {
    const pg = await newPage("light", width);
    await pg.goto(`${O}/setup/connect?new=template`, { waitUntil: "networkidle" });
    await pg.getByTestId("connect-form").waitFor();
    await shot(pg, `setup-empty-light-${width}`);
    await pg.context().close();
  }

  // ---- Fill, validate, check, save a template ---------------------------------------
  {
    const pg = await newPage("light");
    await pg.goto(`${O}/setup/connect?new=template`, { waitUntil: "networkidle" });
    await pg.getByTestId("connect-form").waitFor();
    await pg.locator("#f-name").fill("Acme Inc apps");
    // A value pasted in the wrong field says where it belongs, and moves.
    await pg.locator("#f-ONE_CLIENT_SECRET").fill(CANARY.ONE_CONNECT_KEY);
    const hint = await pg.locator("#f-ONE_CLIENT_SECRET-hint").textContent();
    check("a connect key in the secret field says where it belongs", /connect key/i.test(hint ?? "") && !(hint ?? "").includes(CANARY.ONE_CONNECT_KEY), hint ?? "");
    await shot(pg, "setup-wrong-field-light-1280");
    await pg.getByRole("button", { name: /Move it to Connect key/ }).click();
    check("Move it puts the value in the right field", (await pg.locator("#f-ONE_CONNECT_KEY").inputValue()) === CANARY.ONE_CONNECT_KEY && (await pg.locator("#f-ONE_CLIENT_SECRET").inputValue()) === "");
    // A block of NAME=value lines fills every field; the redirect URI line is left out.
    const block = Object.entries(CANARY).map(([k, v]) => `${k}=${v}`).join("\n");
    await paste(pg, "#f-ONE_CLIENT_ID", `# from the One dashboard\n${block}\nONE_REDIRECT_URI=${REDIRECT}\nOTHER_THING=1\n`);
    await sleep(200);
    const filled = await Promise.all(Object.keys(CANARY).map(async (k) => (await pg.locator(`#f-${k}`).inputValue()) === CANARY[k as keyof typeof CANARY]));
    check("a pasted block fills every field", filled.every(Boolean), filled.join(","));
    check("secret fields are masked", (await pg.locator("#f-ONE_CLIENT_SECRET").getAttribute("type")) === "password" && (await pg.locator("#f-ONE_CONNECT_KEY").getAttribute("type")) === "password");
    await pg.locator("[data-testid='field-ONE_CLIENT_SECRET'] button[aria-label='Show the value']").click();
    const shown = await pg.locator("#f-ONE_CLIENT_SECRET").getAttribute("type");
    await pg.locator("[data-testid='field-ONE_CLIENT_SECRET'] button[aria-label='Hide the value']").click();
    check("show and hide toggle the secret", shown === "text" && (await pg.locator("#f-ONE_CLIENT_SECRET").getAttribute("type")) === "password");
    await shot(pg, "setup-filled-light-1280");
    await pg.getByRole("button", { name: "Check", exact: true }).click();
    await pg.getByTestId("check-result").waitFor();
    check("Check answers per field and with One's answer", /Ready to sign in/.test((await pg.getByTestId("check-result").textContent()) ?? ""));
    await shot(pg, "setup-checked-light-1280");
    await pg.getByRole("button", { name: "Save", exact: true }).click();
    await pg.getByTestId("saved-banner").waitFor();
    templateId = new URL(pg.url()).pathname.split("/").at(-1) ?? "";
    const row = await p.connect.get(templateId);
    check("Save stores the template, write-only", row?.kind === "template" && row.name === "Acme Inc apps" && p.env.setupConfigured(templateId));
    check("the redirect URI was not stored", !p.env.store.has(`connect:${templateId}`, "ONE_REDIRECT_URI"));
    const html = await pg.content();
    check("no saved value is in the page after saving", leaks(html).length === 0, leaks(html).join(","));
    check("the client id shows its last four only", (await pg.getByTestId("saved-ONE_CLIENT_ID").textContent())?.includes("…w2Zr") ?? false);
    await shot(pg, "setup-saved-light-1280");
    // Replace and Remove, per value.
    await pg.locator("[data-testid='saved-ONE_PERMISSION_SET'] button", { hasText: "Remove" }).click();
    await pg.locator("[data-testid='saved-ONE_PERMISSION_SET'] button", { hasText: "Remove it" }).click();
    await sleep(500);
    check("Remove takes one value off", !p.env.store.has(`connect:${templateId}`, "ONE_PERMISSION_SET") && p.env.setupConfigured(templateId));
    await pg.locator("[data-testid='saved-ONE_CLIENT_ID'] button", { hasText: "Replace" }).click();
    await pg.locator("#f-ONE_CLIENT_ID").fill("client_acmeR8x3Ys");
    await pg.getByRole("button", { name: "Save", exact: true }).click();
    await pg.getByTestId("saved-banner").waitFor();
    check("Replace stores the new value", ((await p.env.setupValues(templateId)).ONE_CLIENT_ID ?? "") === "client_acmeR8x3Ys");
    await pg.context().close();
    const d = await newPage("dark");
    await d.goto(`${O}/setup/connect/${templateId}`, { waitUntil: "networkidle" });
    await d.getByTestId("saved-ONE_CLIENT_SECRET").waitFor();
    await shot(d, "setup-saved-dark-1280");
    await d.context().close();
  }

  // ---- Projects: one with its own Connect app, two linking the template --------------
  const mk = (name: string) => fetch(`${O}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, harness: "replay", model: "demo", permission: "build" }) }).then((r) => r.json() as Promise<{ project: { id: string; slug: string } }>);
  const ownProject = (await mk("Acme Own")).project;
  {
    const r = await json<{ connect: { setupId: string; enabled: boolean } }>("PUT", `/api/projects/${ownProject.id}/connect`, { use: "new" });
    const ownId = r.connect.setupId;
    const pg = await newPage("light");
    await pg.goto(`${O}/setup/connect/${ownId}?project=${ownProject.id}`, { waitUntil: "networkidle" });
    await pg.getByTestId("connect-form").waitFor();
    for (const [k, v] of Object.entries(OWN)) await pg.locator(`#f-${k}`).fill(v);
    await pg.getByRole("button", { name: "Save", exact: true }).click();
    await pg.getByTestId("saved-banner").waitFor();
    await shot(pg, "project-own-saved-light-1280");
    await pg.getByTestId("turn-on").click();
    for (let i = 0; i < 40 && !(await p.connect.projectConnect(ownProject.id)).enabled; i++) await sleep(100);
    const c = await p.connect.projectConnect(ownProject.id);
    check("a project's own Connect app saves, and Turn on One Connect turns it on", c.enabled && c.setupId === ownId && c.via === "new");
    check("its own values are its own, not the template's", (await p.env.setupValues(ownId)).ONE_CONNECT_KEY === OWN.ONE_CONNECT_KEY && (await p.env.setupValues(templateId)).ONE_CONNECT_KEY === CANARY.ONE_CONNECT_KEY);
    check("no value in the page", leaks(await pg.content()).length === 0);
    await pg.context().close();
  }

  // ---- An app value the code reads -----------------------------------------------
  const created = await fetch(`${O}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Acme Weather", harness: "replay", model: "env", permission: "build" }) }).then((r) => r.json() as Promise<{ project: { id: string; slug: string } }>);
  const pid = created.project.id;
  await fetch(`${O}/api/projects/${pid}/turns`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: "A weather page for Acme Inc with today's forecast" }) });
  await sleep(300);
  await p.turns.idle(pid, 5 * 60_000);
  const turnsRun = (await p.turns.list(pid)).turns;
  const openErrs = await p.errors.open(pid);
  check("the replay turn is clean (one turn, no errors)", turnsRun.filter((t) => t.kind === "user" || t.kind === "fix").length === 1 && openErrs.length === 0, `${turnsRun.map((t) => `${t.kind}:${t.status}`).join(",")} ${openErrs.map((e) => `${e.source} ${e.file}:${e.line} ${e.message.slice(0, 120)}`).join(" | ")}`);
  for (const theme of ["light", "dark"] as const) {
    const pg = await newPage(theme);
    await pg.goto(`${O}/p/${pid}`, { waitUntil: "networkidle" });
    const card = pg.getByTestId("env-card");
    await card.waitFor({ timeout: 30_000 });
    if (theme === "light") check("the turn ends with This app needs WEATHER_API_KEY", /This app needs\s*WEATHER_API_KEY/.test((await card.textContent()) ?? ""));
    await pg.frameLocator("iframe[title^='Preview of']").getByTestId("weather").waitFor({ timeout: 30_000 }).catch(() => {});
    await shot(pg, `chat-needs-${theme}-1280`);
    if (theme === "light") {
      const before = await fetch(`http://${created.project.slug}.localhost:${core.PORTS.proxy}/api/weather`).then((r) => r.json() as Promise<{ configured: boolean }>).catch(() => null);
      check("before: the app's API reports the key missing", before?.configured === false, JSON.stringify(before));
      await card.locator("input").fill(WEATHER);
      await card.getByRole("button", { name: "Save", exact: true }).click();
      await pg.getByText("is set. The preview runs with it.").waitFor({ timeout: 10_000 });
      check("setting it in the card marks it set", true);
      let after: { configured: boolean; keyLength?: number } | null = null;
      for (let i = 0; i < 60 && !after?.configured; i++) {
        await sleep(500);
        after = await fetch(`http://${created.project.slug}.localhost:${core.PORTS.proxy}/api/weather`).then((r) => (r.ok ? (r.json() as Promise<{ configured: boolean; keyLength?: number }>) : null)).catch(() => null);
      }
      check("the preview restarted and the app's Worker sees the value", after?.configured === true && after.keyLength === WEATHER.length, JSON.stringify(after));
      await pg.reload({ waitUntil: "networkidle" });
      await pg.getByTestId("env-card").waitFor();
      await shot(pg, "chat-set-light-1280");
    }
    await pg.goto(`${O}/p/${pid}/access`, { waitUntil: "networkidle" });
    await pg.getByTestId("environment-section").waitFor();
    await pg.getByTestId("environment-section").scrollIntoViewIfNeeded();
    await shot(pg, `access-environment-${theme}-1280`);
    if (theme === "light") {
      const t = (await pg.getByTestId("env-row-WEATHER_API_KEY").textContent()) ?? "";
      check("Access lists the name with file:line and where it is stored", /server\/weather\.ts:\d+/.test(t) && /Set/.test(t) && /macOS Keychain/.test(t) && !t.includes(WEATHER), t.slice(0, 160));
    }
    await pg.context().close();
  }

  // ---- The weather app links the template: the Worker sees the Connect app, no file holds it ----
  {
    const linkA = await json<{ connect: { enabled: boolean; via: string } }>("PUT", `/api/projects/${pid}/connect`, { use: "template", setupId: templateId });
    const other = (await mk("Acme Other")).project;
    await json("PUT", `/api/projects/${other.id}/connect`, { use: "template", setupId: templateId });
    check("two projects link the template, One Connect on", linkA.connect.enabled && linkA.connect.via === "template");
    let health: { mode?: string; configured?: Record<string, boolean> } | null = null;
    for (let i = 0; i < 80 && health?.mode !== "connect"; i++) {
      await sleep(500);
      health = await fetch(`http://${created.project.slug}.localhost:${core.PORTS.proxy}/api/one/health`).then((r) => (r.ok ? (r.json() as Promise<typeof health>) : null)).catch(() => null);
    }
    check("the preview restarted and the Worker has the Connect app (booleans only)", health?.mode === "connect" && health.configured?.clientId === true && health.configured?.clientSecret === true && health.configured?.connectKey === true && health.configured?.redirectUri === true, JSON.stringify(health));
    const s2 = await newPage("light");
    await s2.goto(`${O}/settings/templates`, { waitUntil: "networkidle" });
    await s2.getByTestId("settings-templates").waitFor();
    const usedBy = await s2.getByTestId("settings-templates").textContent();
    check("Settings, Connect templates lists it and how many projects use it", (usedBy ?? "").includes("Acme Inc apps") && /2 projects/.test(usedBy ?? ""), (usedBy ?? "").slice(0, 160));
    check("no value on the templates page", leaks(await s2.content()).length === 0);
    await shot(s2, "settings-templates-light-1280");
    await s2.context().close();
    const s3 = await newPage("dark");
    await s3.goto(`${O}/settings/templates`, { waitUntil: "networkidle" });
    await s3.getByTestId("settings-templates").waitFor();
    await shot(s3, "settings-templates-dark-1280");
    await s3.context().close();
  }

  // ---- Nothing anywhere holds a value ---------------------------------------------
  check("no API response the editor saw holds a value", bodies.every((b) => leaks(b).length === 0), bodies.filter((b) => leaks(b).length).map((b) => b.split("\n")[0]).slice(0, 3).join(" | "));
  check("the server log holds no value", leaks(logs.join("\n")).length === 0);
  check("the dev server log holds no value", leaks(p.devservers?.logTail(pid, 400).join("\n") ?? "").length === 0);
  const files = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.name === "node_modules" || e.name === ".git" ? [] : e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)]));
  const { readFileSync } = await import("node:fs");
  for (const id of [pid, ownProject.id]) {
    const row = (await p.workspace.get(id))!;
    const bad = files(row.path).filter((f) => leaks(readFileSync(f, "utf8")).length > 0);
    check(`${row.name}'s folder holds no value (.dev.vars included)`, bad.length === 0, bad.join(", "));
  }
  check("the env index holds names only", leaks(readFileSync(join(scratch, "env-index.json"), "utf8")).length === 0);
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await browser.close();
  await server.stop();
  rmSync(scratch, { recursive: true, force: true });
}
const bad = results.filter((r) => !r[1]);
console.log(`\n${results.length - bad.length} of ${results.length} checks pass`);
process.exit(failed || bad.length ? 1 : 0);
