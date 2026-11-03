// Smoke check://   pnpm exec tsx scripts/smoke-ui.ts [--no-shots]
// Builds the editor (ui/dist), starts the server on the stub grant with a
// scratch home, makes a replay project (the demo scenario: a task list,
// then a Gmail inbox page), and drives the editor in Chrome:
//   - every key in the keymap does its action
//   - Edit text on the preview, then Apply, makes an "Edited 1 text" version
//   - a class swap from the style panel and a comment are batched to the agent
//   - Plan mode answers with Build this plan
//   - a turn that runs a call on the builder's grant for visitors ends with
//     the Allow card; Allow ticks it, Access shows its own group
//   - no `text-[` utility anywhere in ui/src
// Preview and images (also alone with --preview-only):
//   - Preview this version: an older checkpoint on its own dev port and
//     host, a banner with Restore this version and Back to current, HEAD
//     and the working tree untouched, reads run and the project's token
//     cannot open its relay, V and the palette, leaving stops it
//   - images on Home: picker, drop and paste, remove, the limits, and the
//     first turn gets them (also from a prompt saved for after setup)
// and writes light and dark screenshots at 1024, 1280 and 1536 of every
// screen into docs/qa/ui/. Exits 0
// when every check passes.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

if (!process.env.BUILDER_SMOKE_CHILD) {
  const r = spawnSync(process.execPath, ["--import", "tsx", ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, BUILDER_SMOKE_CHILD: "1", BUILDER_STUB_GRANT: "1", BUILDER_SECRETS: "file", BUILDER_DEV: "1", BUILDER_SERVER_PORT: process.env.BUILDER_SERVER_PORT ?? "51939", BUILDER_PROXY_PORT: process.env.BUILDER_PROXY_PORT ?? "51940" },
  });
  process.exit(r.status ?? 1);
}

const ROOT = join(import.meta.dirname, "..");
const SHOTS = join(ROOT, "docs", "qa", "ui");
const SHOTS5 = join(ROOT, "docs", "qa", "ui-preview");
const noShots = process.argv.includes("--no-shots");
/** Preview and image checks only (Preview this version, images on Home), on the same replay project. */
const only5 = process.argv.includes("--preview-only");
/** Per-project Connect only (Settings, One CLI and templates, the project's One Connect tab, the card, Access, Publish). */
const onlyConnect = process.argv.includes("--connect-only");
const SHOTS_CONNECT = join(ROOT, "docs", "qa", "connect");
const results: [string, boolean, string][] = [];
let debugPage: { screenshot(o: { path: string }): Promise<unknown> } | null = null;
const check = (name: string, pass: boolean, detail = "") => {
  results.push([name, pass, detail]);
  console.log(`${pass ? "pass" : "FAIL"}  ${name}${detail ? `   (${detail})` : ""}`);
  if (!pass && debugPage) void debugPage.screenshot({ path: join(tmpdirName(), `smoke-ui-fail-${results.length}.png`) }).catch(() => {});
};
const tmpdirName = () => process.env.TMPDIR ?? "/tmp";

// 0. The ladder: no arbitrary font sizes in the editor's own source.
{
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|css)$/.test(n)) readFileSync(p, "utf8").split("\n").forEach((l, i) => { if (l.includes("text-[")) hits.push(`${p.slice(ROOT.length + 1)}:${i + 1}`); });
    }
  };
  walk(join(ROOT, "ui", "src"));
  check("no text-[ utility in ui/src", hits.length === 0, hits.slice(0, 5).join(", "));
}

const build = spawnSync("pnpm", ["--filter", "@builder/ui", "build"], { cwd: ROOT, encoding: "utf8" });
check("ui builds", build.status === 0, build.status === 0 ? "" : (build.stderr || build.stdout).slice(-400));
if (build.status !== 0) process.exit(1);

const { mkdirSync, mkdtempSync, rmSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const core = await import("@builder/core");
const { startServer } = await import("@builder/server");
const { chromium } = await import("playwright-core");
type Page = import("playwright-core").Page;

const scratch = mkdtempSync(join(tmpdir(), `${core.BRAND.slug}-smoke-ui-`));
core.linkScratchTemplateCache(scratch);
// Every turn goes to the replay harness, and its inputs are kept so a check can see the images a turn got.
const { getHarness } = await import("@builder/harness");
const turnInputs: import("@builder/harness/types").TurnInput[] = [];
const server = await startServer({
  home: scratch,
  log: () => {},
  audit: false,
  harness: (id) => {
    if (id !== "replay") throw new Error(`smoke-ui only runs the replay harness, not ${id}`);
    const h = getHarness(id);
    return { ...h, start: (input) => (turnInputs.push(input), h.start(input)) };
  },
});
const p = server.platform;
const browser = await chromium.launch({ headless: true, channel: "chrome" }).catch(() => chromium.launch({ headless: true }));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  const r = await fetch(`${core.SERVER_ORIGIN}${path}`, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
  return (r.status === 204 ? null : await r.json()) as T;
};
const MOD = "Meta";

let failed = false;
try {
  await p.workspace.ensureTemplate(() => {});
  const { project } = await api<{ project: { id: string; slug: string; path: string } }>("POST", "/api/projects", { name: "Acme tasks", harness: "replay", model: "demo", permission: "build" });
  const pid = project.id;
  for (const prompt of ["A task list for Acme Inc", "Add an inbox page with my latest Gmail threads"]) {
    await api("POST", `/api/projects/${pid}/turns`, { prompt });
    await sleep(300);
    await p.turns.idle(pid, 5 * 60_000);
  }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: core.SERVER_ORIGIN });
  const page = await ctx.newPage();
  debugPage = page;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const editor = `${core.SERVER_ORIGIN}/p/${pid}`;
  await page.goto(editor, { waitUntil: "networkidle" });
  const frame = () => page.frameLocator("iframe[title^='Preview of']");
  await frame().locator("[data-builder-loc]").first().waitFor({ timeout: 30_000 });
  // Focus back on the editor document with nothing open, so single letters reach the keymap.
  const neutral = async () => {
    for (let i = 0; i < 3 && (await page.locator("[role='dialog']").first().isVisible().catch(() => false)); i++) {
      await page.keyboard.press("Escape");
      await sleep(150);
    }
    await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.focus(); });
  };
  const visible = (sel: string) => page.locator(sel).first().isVisible().catch(() => false);
  const pressed = async (label: string) => (await page.getByRole("button", { name: label, exact: true }).getAttribute("aria-pressed")) === "true";

  if (!only5 && !onlyConnect) {
    // ---- Every key -------------------------------------------------
    await neutral();
    await page.keyboard.press(`${MOD}+k`);
    check("Cmd+K opens the palette", await page.getByPlaceholder(/search|type a command|go to/i).first().isVisible().catch(() => false) || (await visible("[role='dialog'] input")));
    await page.keyboard.press("Escape");
    await sleep(250);
    check("Esc closes the palette", !(await page.locator("[role='dialog']").first().isVisible().catch(() => false)));
    await neutral();
    await page.keyboard.press("?");
    check("? opens the shortcuts", await page.getByText("Keyboard shortcuts").first().isVisible().catch(() => false));
    await page.keyboard.press("Escape");
    await sleep(200);
    for (const [n, path] of [["2", "/code"], ["3", "/history"], ["4", "/access"], ["5", "/settings"], ["1", ""]] as const) {
      await neutral();
      await page.keyboard.press(`${MOD}+${n}`);
      await sleep(300);
      check(`Cmd+${n} switches the tab`, page.url().endsWith(`/p/${pid}${path}`), page.url());
    }
    await neutral();
    const chatBefore = await page.locator("aside[aria-label='Chat']").count();
    await page.keyboard.press(`${MOD}+b`);
    await sleep(200);
    const chatAfter = await page.locator("aside[aria-label='Chat']").count();
    await page.keyboard.press(`${MOD}+b`);
    await sleep(200);
    check("Cmd+B hides and shows chat", chatBefore === 1 && chatAfter === 0 && (await page.locator("aside[aria-label='Chat']").count()) === 1);
    await neutral();
    await page.keyboard.press(`${MOD}+Shift+p`);
    await sleep(400);
    check("Cmd+Shift+P opens Publish", await page.getByRole("dialog").filter({ hasText: /publish/i }).first().isVisible().catch(() => false));
    await page.keyboard.press("Escape");
    await sleep(300);
    await neutral();
    let loads = 0;
    page.on("framenavigated", (f) => { if (f !== page.mainFrame()) loads++; });
    await page.keyboard.press("Alt+r");
    await sleep(1500);
    check("Alt+R reloads the preview", loads > 0, `${loads} load(s)`);
    await frame().locator("[data-builder-loc]").first().waitFor({ timeout: 20_000 });
    for (const [key, label] of [["s", "Select"], ["t", "Edit text"], ["c", "Comment"]] as const) {
      await neutral();
      await page.keyboard.press(key);
      await sleep(200);
      const on = await pressed(label);
      await page.keyboard.press("Escape");
      await sleep(200);
      check(`${key.toUpperCase()} turns on ${label}, Esc leaves`, on && !(await pressed(label)));
    }
    // J / K / Enter in History.
    await neutral();
    await page.keyboard.press(`${MOD}+3`);
    await page.locator("[role='option']").nth(2).waitFor();
    await sleep(500);
    const opened = async () => page.locator("[role='option'][aria-selected='true']").getAttribute("data-idx");
    await neutral();
    await page.keyboard.press("j");
    await page.keyboard.press("j");
    await page.keyboard.press("Enter");
    await sleep(200);
    const afterJ = await opened();
    await page.keyboard.press("k");
    await page.keyboard.press("Enter");
    await sleep(200);
    check("J, K and Enter move and open in History", afterJ === "2" && (await opened()) === "1", `${afterJ} then ${await opened()}`);
    // Cmd+S in Code.
    await page.keyboard.press(`${MOD}+2`);
    await page.getByText("App.tsx").first().click();
    const cm = page.locator(".cm-content").first();
    await cm.waitFor({ timeout: 10_000 });
    await cm.click();
    await page.keyboard.press(`${MOD}+End`);
    await page.keyboard.type("\n// checked by smoke-ui\n");
    await page.keyboard.press(`${MOD}+s`);
    await sleep(600);
    check("Cmd+S saves in Code", readFileSync(join(project.path, "src", "App.tsx"), "utf8").includes("checked by smoke-ui"));
    // Cmd+Enter sends, Cmd+. stops.
    await page.keyboard.press(`${MOD}+1`);
    const box = page.getByLabel("Message the agent");
    await box.click();
    await box.fill("Make the task list title bigger");
    const turnsBefore = (await p.turns.list(pid)).turns.length;
    await page.keyboard.press(`${MOD}+Enter`);
    await sleep(150);
    await neutral();
    await page.keyboard.press(`${MOD}+.`);
    await p.turns.idle(pid, 60_000);
    const all = (await p.turns.list(pid)).turns;
    const sent = all.find((t) => t.prompt === "Make the task list title bigger");
    check("Cmd+Enter sends the message", all.length > turnsBefore && !!sent);
    check("Cmd+. stops the running turn", sent?.status === "cancelled" || sent?.status === "done", sent?.status ?? "no turn");

    // ---- Visual edit ---------------------------------------------------------
    await frame().locator("[data-builder-loc]").first().waitFor({ timeout: 20_000 });
    await neutral();
    await page.keyboard.press("t");
    const heading = frame().locator("h1[data-builder-loc]").first();
    const loc = await heading.getAttribute("data-builder-loc");
    // The preview is scaled to fit, so hit tests miss; send the click to the element itself.
    await page.locator("iframe[title^='Preview of']").click({ position: { x: 4, y: 4 } });
    await heading.dispatchEvent("click");
    await page.keyboard.press(`${MOD}+a`);
    await page.keyboard.type("Acme tasks today");
    await page.keyboard.press("Enter");
    await sleep(300);
    const bar = page.getByRole("button", { name: /^Apply 1 edit$/ });
    check("Edit text queues one pending edit", await bar.isVisible().catch(() => false), loc ?? "");
    if (!noShots) await page.screenshot({ path: join(SHOTS, "edit-text-pending-light-1280.png") });
    await bar.click();
    await sleep(1500);
    const cps = await p.checkpoints.list(pid);
    check("Apply makes one version without the agent", cps[0]?.subject === "Edited 1 text in the preview" && readFileSync(join(project.path, "src", "App.tsx"), "utf8").includes("Acme tasks today"), cps[0]?.subject);
    // Style panel and a comment, batched.
    await frame().locator("h1[data-builder-loc]").first().waitFor({ timeout: 20_000 });
    await page.keyboard.press("Escape");
    await neutral();
    await page.keyboard.press("s");
    await frame().locator("h1[data-builder-loc]").first().dispatchEvent("click");
    const panel = page.getByRole("dialog", { name: "Style" });
    await panel.waitFor({ timeout: 5000 });
    await panel.getByRole("button", { name: "15", exact: true }).click();
    await sleep(300);
    const live = await frame().locator("h1[data-builder-loc]").first().getAttribute("class");
    check("the style panel swaps a class live", !!live?.includes("text-15"), live ?? "");
    if (!noShots) await page.screenshot({ path: join(SHOTS, "style-panel-light-1280.png") });
    await panel.getByRole("button", { name: "Close the style panel" }).click();
    await neutral();
    await page.keyboard.press("c");
    await frame().locator("[data-builder-loc]").nth(2).dispatchEvent("click");
    const comment = page.getByRole("dialog", { name: "Comment" });
    await comment.waitFor({ timeout: 5000 });
    await comment.getByLabel("Comment").fill("More room between the rows");
    if (!noShots) await page.screenshot({ path: join(SHOTS, "comment-light-1280.png") });
    await comment.getByRole("button", { name: "Add comment" }).click();
    await page.keyboard.press("Escape");
    const apply2 = page.getByRole("button", { name: /^Apply 2 edits$/ });
    check("a style swap and a comment wait together", await apply2.isVisible().catch(() => false));
    const n0 = (await p.turns.list(pid)).turns.length;
    await apply2.click();
    await sleep(1500);
    await p.turns.idle(pid, 60_000);
    const after = (await p.turns.list(pid)).turns;
    const batched = after.find((t) => t.kind === "user" && /More room between the rows/.test(t.prompt));
    check("what the platform cannot apply goes to the agent as one turn", after.length > n0 && (!!batched || (await p.checkpoints.list(pid))[0]!.subject.startsWith("Edited")), batched?.prompt.split("\n")[0] ?? "");

    // ---- Plan mode -------------------------------------------------------------
    await page.getByRole("button", { name: "Plan", exact: true }).click();
    await box.fill("Add due dates to tasks");
    await page.keyboard.press(`${MOD}+Enter`);
    await sleep(500);
    await p.turns.idle(pid, 60_000);
    const plan = (await p.turns.list(pid)).turns.find((t) => t.kind === "plan");
    check("Plan mode sends a plan turn (read only)", plan?.status === "done", plan?.status ?? "none");
    check("the plan offers Build this plan", await page.getByRole("button", { name: "Build this plan" }).first().isVisible().catch(() => false));

    // ---- Visitors on the builder's grant -----------------------------------------
    {
      const { project: vp } = await api<{ project: { id: string; slug: string; path: string } }>("POST", "/api/projects", { name: "Acme contact", harness: "replay", model: "visitors", permission: "build" });
      // What the agent's one_add_action does (the replay harness plays tool events, it does not call them).
      await p.scopes.add((await p.workspace.get(vp.id))!, "conn_mod_def::GGXAjWkZO8U::uMc1LQIHTTKzeMm3rLL5gQ");
      await api("POST", `/api/projects/${vp.id}/turns`, { prompt: "A public contact form that emails me each message" });
      await sleep(300);
      await p.turns.idle(vp.id, 5 * 60_000);
      type Sc = { manifest: { actions: { actionId: string; runsAs?: string[] }[] }; callSites: { as?: string }[]; visitors: { enabled: boolean; actions: string[] } };
      const sc = await api<Sc>("GET", `/api/projects/${vp.id}/scopes`);
      const owned = sc.manifest.actions.filter((a) => a.runsAs?.includes("owner")).map((a) => a.actionId);
      check("the manifest marks the owner-run call site", owned.length === 1 && sc.callSites.some((c) => c.as === "owner"), owned.join(","));
      check("visitors are off by default", !sc.visitors.enabled && sc.visitors.actions.length === 0);
      const row = (await p.workspace.get(vp.id))!;
      const ownerCall = { platform: "gmail", actionId: owned[0], as: "owner" as const, method: "POST", path: "/gmail/v1/users/me/messages/send", title: "Send Email" };
      const refused = await p.gate.check(row, ownerCall);
      check("an owner-run call that is not allowed is refused locally", !refused.allow && refused.status === 403 && refused.receipt.badge === "Local" && !refused.receipt.line.includes("declined, 403"), refused.allow ? "allowed" : refused.receipt.line);
      const noOrigin = await fetch(`${core.SERVER_ORIGIN}/api/projects/${vp.id}/visitors`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: true, allow: owned }) });
      check("only the editor can turn visitors on (a request with no origin is refused)", noOrigin.status === 403 && !(await p.workspace.visitors(vp.id)).enabled);
      const themed = async (theme: "light" | "dark") => {
        const c3 = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: theme });
        await c3.addInitScript((t) => localStorage.setItem("builder.theme", t), theme);
        return { c3, pg: await c3.newPage() };
      };
      for (const theme of ["light", "dark"] as const) {
        const { c3, pg } = await themed(theme);
        await pg.goto(`${core.SERVER_ORIGIN}/p/${vp.id}`, { waitUntil: "networkidle" });
        const card = pg.getByTestId("visitors-card");
        await card.waitFor({ timeout: 15_000 }).catch(() => {});
        const asks = await card.getByRole("button", { name: "Allow", exact: true }).isVisible().catch(() => false);
        const keep = await card.getByRole("button", { name: "Keep sign-in required" }).isVisible().catch(() => false);
        if (theme === "light") check("the turn ends with Allow / Keep sign-in required", asks && keep);
        if (!noShots) await card.scrollIntoViewIfNeeded().catch(() => {});
        if (!noShots) await pg.screenshot({ path: join(SHOTS, `visitors-card-${theme}-1280.png`) });
        if (theme === "dark") {
          await card.getByRole("button", { name: "Allow", exact: true }).click();
          await sleep(800);
          const v = await p.workspace.visitors(vp.id);
          check("Allow turns visitors on for exactly that action", v.enabled && v.actions.join(",") === owned.join(","), JSON.stringify(v));
          check("the card says it is allowed", await pg.getByText(/Visitors can trigger this on your grant/).first().isVisible().catch(() => false));
          if (!noShots) await pg.screenshot({ path: join(SHOTS, `visitors-card-allowed-dark-1280.png`) });
        }
        await c3.close();
      }
      const ran = await p.gate.check(row, ownerCall);
      check("once allowed, the owner-run call may leave the computer", ran.allow, ran.allow ? "" : ran.receipt.line);
      for (const theme of ["light", "dark"] as const) {
        const { c3, pg } = await themed(theme);
        await pg.goto(`${core.SERVER_ORIGIN}/p/${vp.id}/access`, { waitUntil: "networkidle" });
        const group = pg.getByTestId("visitor-group");
        await group.waitFor({ timeout: 15_000 }).catch(() => {});
        if (theme === "light") {
          const title = await group.getByText("Runs on your grant for visitors").isVisible().catch(() => false);
          const ticked = await group.getByRole("checkbox").first().isChecked().catch(() => false);
          const on = (await group.getByRole("switch").getAttribute("aria-checked").catch(() => null)) === "true";
          check("Access lists owner-run actions in their own group, ticked and on", title && ticked && on);
        }
        if (!noShots) await pg.screenshot({ path: join(SHOTS, `visitors-access-${theme}-1280.png`), fullPage: false });
        await c3.close();
      }
    }

  }

  // ---- Preview this version ---------------------------------------------
  if (!onlyConnect) {
    mkdirSync(SHOTS5, { recursive: true });
    const row0 = (await p.workspace.get(pid))!;
    // The inbox's two actions (a Gmail read and a send) as the agent's one_add_action would
    // install them (replay plays tool events, it does not call them), as their own version,
    // then a manual version on top so that one is older.
    const READ = "conn_mod_def::GGSNlnppgZ0::qk3CudDWTVKPY7hpPVCqLQ";
    const SEND = "conn_mod_def::GGXAjWkZO8U::uMc1LQIHTTKzeMm3rLL5gQ";
    for (const id of [READ, SEND]) await p.scopes.add(row0, id);
    await p.checkpoints.commit(pid, row0.path, { subject: "Connect the inbox to Gmail", kind: "manual", turnId: null, harness: null, sessionId: null });
    await api("PUT", `/api/projects/${pid}/file`, { path: "README.md", content: "# Acme tasks\n\nChecked by smoke-ui.\n" });
    await api("POST", `/api/projects/${pid}/checkpoint`);
    const cps5 = await p.checkpoints.list(pid);
    const inbox = cps5.find((c) => c.subject === "Connect the inbox to Gmail")!;
    const head0 = await core.git.headCommit(row0.path);
    const status0 = (await core.git.runGit(row0.path, ["status", "--porcelain"])).stdout;
    const banner = () => page.getByTestId("version-preview");
    const versionFrame = () => page.frameLocator("iframe[title^='Version ']");
    await neutral();
    await page.keyboard.press(`${MOD}+3`);
    await page.locator("[role='option']").filter({ hasText: inbox.subject }).first().click();
    await page.getByRole("button", { name: "Preview this version" }).click();
    await banner().waitFor({ timeout: 20_000 });
    await versionFrame().locator("[data-builder-loc]").first().waitFor({ timeout: 90_000 });
    const v = p.versions?.get(pid) ?? null;
    check("Preview this version opens the version in the Preview pane", !!v && v.sha === inbox.sha && v.state === "ready" && page.url().endsWith(`/p/${pid}`), v ? `${v.shortSha} ${v.state}` : "none");
    check(
      "the banner names the version and offers Restore this version and Back to current",
      (await banner().getByText("Previewing an older version").isVisible()) &&
        (await banner().getByText(inbox.shortSha).isVisible()) &&
        (await banner().getByRole("button", { name: "Restore this version" }).isVisible()) &&
        (await banner().getByRole("button", { name: "Back to current" }).isVisible()),
    );
    const key = core.versionKey(pid, inbox.sha);
    const vport = p.devservers!.state(key).port;
    const lport = p.devservers!.state(pid).port;
    check("the version runs on its own dev port beside the live one", !!vport && vport !== lport && vport >= 52000 && vport <= 52999 && p.devservers!.readyPort(pid) === lport, `version ${vport}, live ${lport}`);
    check("it is served on its own host", v!.url === `http://${project.slug}--v-${inbox.shortSha}.localhost:${core.PORTS.proxy}/`, v!.url);
    check("the project's HEAD, index and working tree are untouched", (await core.git.headCommit(row0.path)) === head0 && (await core.git.runGit(row0.path, ["status", "--porcelain"])).stdout === status0 && (await p.checkpoints.list(pid)).length === cps5.length);
    const vdir = join(scratch, "state", pid, "versions", inbox.sha.slice(0, 12));
    check("its tree lives in the state dir with a fresh database of its own", existsSync(join(vdir, "src", "App.tsx")) && existsSync(join(vdir, ".wrangler")) && !vdir.startsWith(row0.path), vdir.slice(scratch.length));
    const tok = p.versions!.match(pid, inbox.shortSha)!.token;
    // The version's dev client asks the platform's local check before each call (CONTRACT 18).
    const devCheck = (token: string, actionId: string, method: string, path: string) =>
      fetch(`${core.SERVER_ORIGIN}/api/dev/${pid}/v/${inbox.shortSha}/check`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ platform: "gmail", actionId, method, path, title: actionId === READ ? "List threads" : "Send Email" }) });
    const read = await devCheck(tok, READ, "GET", "/gmail/v1/users/me/threads");
    check("a read from the version may run on your sign-in", read.status === 200, `${read.status}`);
    const sendRes = await devCheck(tok, SEND, "POST", "/gmail/v1/users/me/messages/send");
    const sendBody = ((await sendRes.json()) as { body?: { source?: string; refusal?: { code?: string } } }).body ?? {};
    const ledger = await api<{ receipts: { line: string; badge: string }[] }>("GET", `/api/projects/${pid}/activity`);
    const line = ledger.receipts.find((r) => r.line.includes("previewing an older version"));
    check("a write from the version is held locally, never sent and never One's 403", sendRes.status === 403 && sendBody.source === "local" && sendBody.refusal?.code === "version_preview" && line?.badge === "Local" && !line.line.includes("declined"), line?.line ?? JSON.stringify(sendBody));
    const wrong = await devCheck(p.workspace.devToken(row0), READ, "GET", "/gmail/v1/users/me/threads");
    check("the project's dev token does not open the version's check", wrong.status === 401, `${wrong.status}`);
    const ps = spawnSync("ps", ["-axEww", "-o", "pid=,command="], { encoding: "utf8" }).stdout.split("\n").find((l) => l.includes(`BUILDER_DEV_PORT=${vport}`) && l.includes(`/api/dev/${pid}/v/`)) ?? "";
    check("the version's server carries the home tag the boot sweep reads", ps.includes(`BUILDER_PREVIEW_HOME=${p.home.root}`) && ps.includes(`BUILDER_DEV_URL=${core.SERVER_ORIGIN}/api/dev/${pid}/v/`), ps ? "" : "no process found");
    check("it counts toward the running dev server limit", p.devservers!.pids().length <= 3, `${p.devservers!.pids().length} running`);
    if (!noShots) await page.screenshot({ path: join(SHOTS5, "version-banner-light-1280.png") });
    // V goes back to current.
    await neutral();
    await page.keyboard.press("v");
    await sleep(800);
    check("V goes back to current and stops the version's server", !(await banner().isVisible().catch(() => false)) && !p.versions!.get(pid) && p.devservers!.state(key).state === "stopped" && !existsSync(vdir) && (await page.locator("iframe[title^='Preview of']").isVisible()));
    // V in History opens the highlighted version.
    await neutral();
    await page.keyboard.press(`${MOD}+3`);
    await page.locator("[role='option']").filter({ hasText: inbox.subject }).first().click();
    await neutral();
    await page.keyboard.press("v");
    await banner().waitFor({ timeout: 20_000 }).catch(() => {});
    check("V in History previews the highlighted version", (await banner().isVisible().catch(() => false)) && p.versions!.get(pid)?.sha === inbox.sha);
    // Dark, from a second editor tab; navigating away there is leaving the editor.
    // This tab moves to History first, so its own version frame is not left without a server.
    await page.keyboard.press(`${MOD}+3`);
    {
      const c4 = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "dark" });
      await c4.addInitScript(() => localStorage.setItem("builder.theme", "dark"));
      const pg = await c4.newPage();
      await pg.goto(`${core.SERVER_ORIGIN}/p/${pid}`, { waitUntil: "networkidle" });
      await pg.frameLocator("iframe[title^='Version ']").locator("[data-builder-loc]").first().waitFor({ timeout: 60_000 }).catch(() => {});
      await sleep(400);
      if (!noShots) await pg.screenshot({ path: join(SHOTS5, "version-banner-dark-1280.png") });
      await pg.goto(`${core.SERVER_ORIGIN}/`, { waitUntil: "networkidle" });
      await sleep(800);
      check("leaving the editor stops the version", !p.versions!.get(pid) && p.devservers!.state(key).state === "stopped");
      await c4.close();
    }
    // The palette offers it, and Restore this version restores and goes back.
    await page.reload({ waitUntil: "networkidle" });
    await neutral();
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder("Type a command or a project name").fill(`Preview ${inbox.subject.slice(0, 24)}`);
    await sleep(300);
    await page.keyboard.press("Enter");
    await banner().waitFor({ timeout: 20_000 }).catch(() => {});
    check("the palette previews a version", (await banner().isVisible().catch(() => false)) && p.versions!.get(pid)?.sha === inbox.sha);
    await banner().getByRole("button", { name: "Restore this version" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Restore", exact: true }).click();
    await sleep(1500);
    const top = (await p.checkpoints.list(pid))[0]!;
    check("Restore this version makes a restore version and goes back to current", top.subject.startsWith(`Restore to ${inbox.shortSha}`) && !p.versions!.get(pid) && !(await banner().isVisible().catch(() => false)), top.subject);
  }

  // ---- images on Home ---------------------------------------------------
  if (!onlyConnect) {
    await api("PATCH", "/api/settings", { defaultHarness: "replay", defaultModel: "demo" });
    // A small wireframe sketch to attach, drawn by the browser.
    const sk = await browser.newPage({ viewport: { width: 480, height: 320 } });
    await sk.setContent(`<body style="margin:0;background:#fff;font:600 18px system-ui"><div style="margin:24px;border:2px solid #222;border-radius:12px;height:268px;display:grid;grid-template-columns:120px 1fr;overflow:hidden"><div style="background:#eef;border-right:2px solid #222;padding:12px">Acme</div><div style="padding:16px">Book a session<div style="margin-top:14px;display:grid;grid-template-columns:repeat(5,1fr);gap:6px">${"<div style='height:34px;border:2px solid #222;border-radius:6px'></div>".repeat(10)}</div><div style="margin-top:16px;width:120px;height:34px;background:#222;border-radius:8px"></div></div></div></body>`);
    const sketch = await sk.screenshot({ type: "png" });
    await sk.close();
    const b64 = sketch.toString("base64");
    const staged = () => (existsSync(join(scratch, "state", "staged-attachments")) ? readdirSync(join(scratch, "state", "staged-attachments")) : []);
    const thumbs = (pg: Page) => pg.locator("[aria-label='Attached images'] img");
    const synth = (pg: Page, kind: "drop" | "paste") =>
      pg.evaluate(({ data, kind }) => {
        const bytes = Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0));
        const dt = new DataTransfer();
        dt.items.add(new File([bytes], `${kind}.png`, { type: "image/png" }));
        const area = document.querySelector("textarea[aria-label='Describe your app']")!;
        area.dispatchEvent(kind === "drop" ? new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }) : new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      }, { data: b64, kind });
    const seen0 = turnInputs.length;
    for (const theme of ["light", "dark"] as const) {
      const c5 = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: theme });
      await c5.addInitScript((t) => localStorage.setItem("builder.theme", t), theme);
      const pg = await c5.newPage();
      // Never let Home start a real agent from here.
      let createBody: { harness?: string; images?: string[] } | null = null;
      await pg.route("**/api/projects", async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        createBody = route.request().postDataJSON();
        if (createBody?.harness !== "replay") return route.abort();
        return route.continue();
      });
      await pg.goto(`${core.SERVER_ORIGIN}/`, { waitUntil: "networkidle" });
      await pg.getByLabel("Describe your app").fill("A booking page for Acme Inc's design studio, laid out like this sketch");
      await pg.locator("input[type='file']").setInputFiles({ name: "sketch.png", mimeType: "image/png", buffer: sketch });
      await thumbs(pg).first().waitFor({ timeout: 10_000 });
      if (theme === "light") {
        check("Home attaches an image from the picker, with a thumbnail", (await thumbs(pg).count()) === 1 && staged().length === 1);
        await synth(pg, "drop");
        await sleep(600);
        await synth(pg, "paste");
        await sleep(600);
        check("Home takes a dropped and a pasted image too", (await thumbs(pg).count()) === 3 && staged().length === 3, `${await thumbs(pg).count()} thumbs`);
        const big = await fetch(`${core.SERVER_ORIGIN}/api/attachments`, { method: "POST", headers: { "content-type": "image/png" }, body: new Uint8Array(8 * 1024 * 1024 + 1) });
        const svg = await fetch(`${core.SERVER_ORIGIN}/api/attachments`, { method: "POST", headers: { "content-type": "image/svg+xml" }, body: "<svg/>" });
        check("the same limits as the composer (8 MB, PNG/JPEG/WebP/GIF)", big.status === 413 && svg.status === 415, `${big.status} ${svg.status}`);
        await pg.locator("[aria-label='Attached images'] span").nth(1).hover();
        await pg.getByRole("button", { name: /^Remove / }).nth(1).click();
        await sleep(500);
        check("removing a thumbnail drops the staged image", (await thumbs(pg).count()) === 2 && staged().length === 2);
        if (!noShots) await pg.screenshot({ path: join(SHOTS5, "home-attached-light-1280.png") });
      } else {
        if (!noShots) await pg.screenshot({ path: join(SHOTS5, "home-attached-dark-1280.png") });
        const before = staged().length;
        await pg.getByLabel("Describe your app").press(`${MOD}+Enter`);
        await pg.waitForURL(/\/p\/p_/, { timeout: 30_000 });
        const newId = pg.url().split("/p/")[1]!.split("/")[0]!;
        await p.turns.idle(newId, 5 * 60_000);
        const np = (await p.workspace.get(newId))!;
        const sent = turnInputs.slice(seen0).find((t) => t.cwd === np.path);
        const att = join(np.path, ".builder", "attachments");
        check("the first turn gets the images attached on Home", createBody?.harness === "replay" && (createBody?.images?.length ?? 0) === 1 && sent?.images?.length === 1 && sent.images.every((f) => f.startsWith(att) && existsSync(f)), `${sent?.images?.length ?? 0} image(s)`);
        check("the staged copy moved into the project's ignored attachments", staged().length === before - 1 && (await core.git.runGit(np.path, ["check-ignore", "-q", ".builder/attachments/x.png"])).ok);
      }
      await c5.close();
    }
    // A prompt saved for after setup keeps its images and sends them with the first turn.
    const up = await fetch(`${core.SERVER_ORIGIN}/api/attachments`, { method: "POST", headers: { "content-type": "image/png" }, body: sketch });
    const { file } = (await up.json()) as { file: string };
    await api("PATCH", "/api/settings", { pendingPrompt: "A waitlist page for Acme Inc", pendingImages: [file, "../config.json"] });
    const s1 = await api<{ settings: { pendingImages?: string[] } }>("GET", "/api/settings");
    const c6 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pg6 = await c6.newPage();
    await pg6.goto(`${core.SERVER_ORIGIN}/`, { waitUntil: "networkidle" });
    await thumbs(pg6).first().waitFor({ timeout: 10_000 }).catch(() => {});
    check("a pending prompt keeps its images on Home", s1.settings.pendingImages?.join(",") === file && (await pg6.getByLabel("Describe your app").inputValue()) === "A waitlist page for Acme Inc" && (await thumbs(pg6).count()) === 1);
    await c6.close();
    const made = await api<{ project: { id: string; path: string }; turn: { id: string } | null }>("POST", "/api/projects", { prompt: "A waitlist page for Acme Inc", harness: "replay", model: "demo", permission: "build", images: s1.settings.pendingImages });
    await p.turns.idle(made.project.id, 5 * 60_000);
    const s2 = await api<{ settings: { pendingPrompt: string | null; pendingImages?: string[] | null } }>("GET", "/api/settings");
    const got = turnInputs.find((t) => t.cwd === made.project.path);
    check("and they reach its first turn once it goes out", got?.images?.length === 1 && !s2.settings.pendingPrompt && !s2.settings.pendingImages?.length);
  }

  // ---- Environment: Access section and Publish's secure rows (scripts/smoke-env.ts has the rest) ----
  for (const theme of onlyConnect ? [] : (["light", "dark"] as const)) {
    const c4 = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: theme, deviceScaleFactor: 2 });
    await c4.addInitScript((t) => localStorage.setItem("builder.theme", t), theme);
    const pg = await c4.newPage();
    await pg.goto(`${core.SERVER_ORIGIN}/p/${pid}/access`, { waitUntil: "networkidle" });
    const envOk = await pg.getByTestId("environment-section").isVisible().catch(() => false);
    if (theme === "light") check("Access has the Environment section", envOk);
    await pg.goto(`${core.SERVER_ORIGIN}/p/${pid}`, { waitUntil: "networkidle" });
    await sleep(500);
    await pg.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await pg.keyboard.press(`${MOD}+Shift+p`);
    await pg.getByRole("dialog").waitFor();
    await pg.getByRole("dialog").getByRole("radio", { name: /Vercel/ }).click().catch(async () => { await pg.getByRole("dialog").getByText("Vercel", { exact: true }).first().click(); });
    const rows = pg.getByTestId("env-row-DATABASE_AUTH_TOKEN");
    const shown = await rows.waitFor({ timeout: 8000 }).then(() => true, () => false);
    if (theme === "light") check("Publish to Vercel offers the secure input for the database token, and no Connect secret field", shown && (await pg.getByTestId("env-row-ONE_CLIENT_SECRET").count()) === 0);
    if (!noShots && shown) {
      mkdirSync(join(ROOT, "docs", "qa", "env-setup"), { recursive: true });
      await rows.scrollIntoViewIfNeeded();
      await sleep(300);
      await pg.screenshot({ path: join(ROOT, "docs", "qa", "env-setup", `publish-env-${theme}-1280.png`) });
    }
    await c4.close();
  }

  // ---- Per-project Connect (CONTRACT 18) -----------------------------------------
  // Builder Settings: One CLI and Connect templates; the project's Settings
  // tab, One Connect (off, the choices, a new Connect app on the secure setup
  // screen at project scope, on); the turn-end card; Access; Publish to
  // Vercel; Home without the old Sign in with One. Shots, light and dark at
  // 1280 (and 1024 for the One Connect tab), in docs/qa/connect/.
  {
    mkdirSync(SHOTS_CONNECT, { recursive: true });
    type PC = import("@builder/core").ProjectConnectResponse;
    type TR = import("@builder/core").ConnectTemplatesResponse;
    const { project: cp } = await api<{ project: { id: string; slug: string; path: string } }>("POST", "/api/projects", { name: "Acme follow-ups", harness: "replay", model: "visitors", permission: "build" });
    // A Gmail send in the code before the turn ends, as the agent's one_add_action would install it.
    await p.scopes.add((await p.workspace.get(cp.id))!, "conn_mod_def::GGXAjWkZO8U::uMc1LQIHTTKzeMm3rLL5gQ");
    await api("POST", `/api/projects/${cp.id}/turns`, { prompt: "Email a follow-up to every Acme Inc lead who has not answered in a week" });
    await sleep(300);
    await p.turns.idle(cp.id, 5 * 60_000);
    const pc0 = await api<PC>("GET", `/api/projects/${cp.id}/connect`);
    check("One Connect is off by default", !pc0.connect.enabled && !pc0.connect.setupId && !pc0.setup);
    check("every project shows the one shared preview redirect URI", pc0.redirectUris.preview === core.PREVIEW_CALLBACK && pc0.redirectUris.preview === "http://127.0.0.1:" + core.PORTS.proxy + "/api/one/callback", pc0.redirectUris.preview);
    check("the production redirect URI is the app's own Vercel address", /^https:\/\/[a-z0-9-]+\.vercel\.app\/api\/one\/callback$/.test(pc0.redirectUris.production ?? ""), pc0.redirectUris.production ?? "none");
    check("the app's One calls are named for the card", pc0.usesOne.some((u) => u.platform === "gmail"), pc0.usesOne.map((u) => u.name).join(","));
    const tr0 = await api<TR>("GET", "/api/connect/templates");
    const sampleT = tr0.templates.find((t) => t.sample);
    check("the keyless sample has its Connect template", !!sampleT && sampleT.configured, sampleT?.name ?? "none");
    const noOrigin = await fetch(`${core.SERVER_ORIGIN}/api/projects/${cp.id}/connect`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: true }) });
    check("only the editor changes a project's One Connect (no Origin is refused)", noOrigin.status === 403 && !(await p.connect.projectConnect(cp.id)).enabled, String(noOrigin.status));

    const themed = async (theme: "light" | "dark", width = 1280) => {
      const c5 = await browser.newContext({ viewport: { width, height: 820 }, colorScheme: theme, deviceScaleFactor: 2 });
      await c5.addInitScript((t) => localStorage.setItem("builder.theme", t), theme);
      const pg = await c5.newPage();
      pg.on("pageerror", (e) => errors.push(e.message));
      return { c5, pg };
    };
    const shot = async (pg: Page, name: string) => { if (!noShots) { await sleep(450); await pg.screenshot({ path: join(SHOTS_CONNECT, `${name}.png`) }); } };

    // Builder Settings: One CLI, Connect templates; Home; a new template.
    for (const theme of ["light", "dark"] as const) {
      const { c5, pg } = await themed(theme);
      await pg.goto(`${core.SERVER_ORIGIN}/settings/one`, { waitUntil: "networkidle" });
      const cli = pg.getByTestId("settings-onecli");
      await cli.waitFor({ timeout: 10_000 }).catch(() => {});
      if (theme === "light") check("Settings, One CLI shows the CLI, its state and what Builder uses it for", (await cli.getByText("What Builder uses it for").isVisible().catch(() => false)) && (await cli.getByText("Sample", { exact: true }).isVisible().catch(() => false)));
      await shot(pg, `settings-onecli-${theme}-1280`);
      await pg.goto(`${core.SERVER_ORIGIN}/settings/templates`, { waitUntil: "networkidle" });
      const tpl = pg.getByTestId("settings-templates");
      await tpl.waitFor({ timeout: 10_000 }).catch(() => {});
      if (theme === "light") check("Settings, Connect templates lists the saved templates with used by", (await tpl.getByText(sampleT?.name ?? "?").first().isVisible().catch(() => false)) && (await tpl.getByTestId("used-by").first().isVisible().catch(() => false)));
      await shot(pg, `settings-templates-${theme}-1280`);
      await pg.goto(`${core.SERVER_ORIGIN}/setup/connect?new=template`, { waitUntil: "networkidle" });
      await pg.getByTestId("connect-form").waitFor({ timeout: 10_000 }).catch(() => {});
      if (theme === "light") check("a new template opens the secure setup screen with the shared redirect URI", (await pg.getByTestId("redirect-uri").first().textContent()) === core.PREVIEW_CALLBACK && (await pg.getByLabel("Template name").isVisible()));
      await shot(pg, `setup-template-${theme}-1280`);
      await pg.goto(`${core.SERVER_ORIGIN}/`, { waitUntil: "networkidle" });
      await sleep(400);
      if (theme === "light") check("Home has no Builder-level Sign in with One", (await pg.getByRole("button", { name: "Sign in with One", exact: true }).count()) === 0 && (await pg.getByTestId("setup-connect-link").count()) === 0);
      await c5.close();
    }

    // The turn-end card and the One Connect tab while off, then a new Connect app at project scope.
    for (const theme of ["light", "dark"] as const) {
      const { c5, pg } = await themed(theme);
      await pg.goto(`${core.SERVER_ORIGIN}/p/${cp.id}`, { waitUntil: "networkidle" });
      const card = pg.getByTestId("connect-offer");
      await card.waitFor({ timeout: 15_000 }).catch(() => {});
      if (theme === "light") check("the turn ends with This app uses Gmail. Turn on One Connect for it?", (await card.getByText("This app uses Gmail. Turn on One Connect for it?").isVisible().catch(() => false)) && (await card.getByRole("button", { name: "Not now" }).isVisible().catch(() => false)));
      await card.scrollIntoViewIfNeeded().catch(() => {});
      await shot(pg, `turn-card-${theme}-1280`);
      for (const width of [1280, 1024]) {
        await pg.setViewportSize({ width, height: 820 });
        await pg.goto(`${core.SERVER_ORIGIN}/p/${cp.id}/settings`, { waitUntil: "networkidle" });
        await pg.getByTestId("project-settings").waitFor({ timeout: 10_000 }).catch(() => {});
        if (theme === "light" && width === 1280) check("the project's Settings tab has One Connect, Off, with the four choices", (await pg.getByTestId("connect-status").textContent()) === "Off" && (await pg.getByRole("radio").count()) === 4);
        await shot(pg, `project-connect-off-${theme}-${width}`);
      }
      await pg.setViewportSize({ width: 1280, height: 820 });
      await pg.getByTestId("connect-choice-template").click();
      await pg.getByTestId(`reuse-${sampleT?.id}`).waitFor({ timeout: 5000 }).catch(() => {});
      if (theme === "light") check("Use a template lists it with Link and Copy", (await pg.getByTestId(`reuse-${sampleT?.id}`).getByRole("button", { name: "Link" }).isVisible().catch(() => false)) && (await pg.getByTestId(`reuse-${sampleT?.id}`).getByRole("button", { name: "Copy" }).isVisible().catch(() => false)));
      await shot(pg, `project-connect-template-${theme}-1280`);
      if (theme === "light") {
        await pg.getByTestId("connect-choice-new").click();
        await pg.getByTestId("connect-new").click();
        await pg.waitForURL(/\/setup\/connect\/[^/?]+\?project=/, { timeout: 10_000 }).catch(() => {});
        await pg.getByTestId("connect-form").waitFor({ timeout: 10_000 }).catch(() => {});
        const own = await p.connect.projectConnect(cp.id);
        check("New Connect app makes the project's own setup, left off, and opens the setup screen at project scope", own.via === "new" && !!own.setupId && !own.enabled && pg.url().includes(`/setup/connect/${own.setupId}?project=${cp.id}`), pg.url());
        check("the setup screen shows the preview and the production redirect URIs", (await pg.getByTestId("redirect-uri").first().textContent()) === core.PREVIEW_CALLBACK && /vercel\.app\/api\/one\/callback$/.test((await pg.getByTestId("redirect-uri-production").textContent()) ?? ""));
      } else {
        await pg.goto(`${core.SERVER_ORIGIN}/setup/connect/${(await p.connect.projectConnect(cp.id)).setupId}?project=${cp.id}`, { waitUntil: "networkidle" });
        await pg.getByTestId("connect-form").waitFor({ timeout: 10_000 }).catch(() => {});
      }
      await shot(pg, `setup-project-${theme}-1280`);
      await c5.close();
    }

    // Turn on from the card (the one sample template), then the tab, Access and Publish while on.
    {
      const { c5, pg } = await themed("light");
      await pg.goto(`${core.SERVER_ORIGIN}/p/${cp.id}`, { waitUntil: "networkidle" });
      const card = pg.getByTestId("connect-offer");
      await card.waitFor({ timeout: 15_000 }).catch(() => {});
      await card.getByRole("button", { name: "Turn on" }).click();
      await card.getByText(/One Connect is on/).waitFor({ timeout: 10_000 }).catch(() => {});
      const on = await p.connect.projectConnect(cp.id);
      check("Turn on links the template and turns One Connect on", on.enabled && on.via === "template" && on.setupId === sampleT?.id, JSON.stringify(on));
      check("the card says it is on", await card.getByText(/One Connect is on/).isVisible().catch(() => false));
      const pv = (await p.connect.previewEnv(cp.id));
      check("the preview gets the app's own Connect app and the shared callback", pv.ONE_MODE === "connect" && pv.ONE_REDIRECT_URI === core.PREVIEW_CALLBACK && !!pv.ONE_CLIENT_ID);
      await shot(pg, `turn-card-on-light-1280`);
      await c5.close();
    }
    for (const theme of ["light", "dark"] as const) {
      const { c5, pg } = await themed(theme);
      for (const width of [1280, 1024]) {
        await pg.setViewportSize({ width, height: 820 });
        await pg.goto(`${core.SERVER_ORIGIN}/p/${cp.id}/settings`, { waitUntil: "networkidle" });
        await pg.getByTestId("project-settings").waitFor({ timeout: 10_000 }).catch(() => {});
        if (theme === "light" && width === 1280) {
          check("the One Connect tab says On, with the template's name", (await pg.getByTestId("connect-status").textContent()) === "On" && (await pg.getByTestId("connect-setup-name").textContent()) === sampleT?.name);
          await pg.getByRole("button", { name: "Check", exact: true }).click();
          await pg.getByTestId("check-result").waitFor({ timeout: 8000 }).catch(() => {});
          check("Check answers for the linked Connect app", await pg.getByTestId("check-result").isVisible().catch(() => false));
        }
        await shot(pg, `project-connect-on-${theme}-${width}`);
      }
      await pg.setViewportSize({ width: 1280, height: 820 });
      await pg.goto(`${core.SERVER_ORIGIN}/p/${cp.id}/access`, { waitUntil: "networkidle" });
      const acc = pg.getByTestId("access-connect");
      await acc.waitFor({ timeout: 10_000 }).catch(() => {});
      if (theme === "light") check("Access shows the app's own One Connect and the preview sign-in", (await acc.getByText("One Connect on").isVisible().catch(() => false)) && (await pg.getByText("In preview, you are the user").isVisible().catch(() => false)));
      await acc.scrollIntoViewIfNeeded().catch(() => {});
      await shot(pg, `access-signin-${theme}-1280`);
      await pg.goto(`${core.SERVER_ORIGIN}/p/${cp.id}`, { waitUntil: "networkidle" });
      await sleep(500);
      await pg.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await pg.keyboard.press(`${MOD}+Shift+p`);
      await pg.getByRole("dialog").waitFor();
      await pg.getByRole("dialog").getByRole("radio", { name: /Vercel/ }).click().catch(async () => { await pg.getByRole("dialog").getByText("Vercel", { exact: true }).first().click(); });
      const pub = pg.getByTestId("publish-connect");
      await pub.waitFor({ timeout: 10_000 }).catch(() => {});
      if (theme === "light") {
        check("Publish says it runs on your One account through the One CLI", await pg.getByRole("dialog").getByText("Runs on your One account through the One CLI.").isVisible().catch(() => false));
        check("Publish to Vercel names the app's Connect app and the production redirect URI to add", (await pub.getByText(sampleT?.name ?? "?").first().isVisible().catch(() => false)) && /vercel\.app\/api\/one\/callback$/.test((await pub.getByTestId("redirect-uri").textContent().catch(() => "")) ?? ""));
      }
      await pub.scrollIntoViewIfNeeded().catch(() => {});
      await shot(pg, `publish-vercel-${theme}-1280`);
      await c5.close();
    }
    const tr1 = await api<TR>("GET", "/api/connect/templates");
    check("the template counts the project that uses it", (tr1.templates.find((t) => t.id === sampleT?.id)?.usedBy ?? []).some((u) => u.id === cp.id));
    for (const theme of ["light", "dark"] as const) {
      const { c5, pg } = await themed(theme);
      await pg.goto(`${core.SERVER_ORIGIN}/settings/templates`, { waitUntil: "networkidle" });
      await pg.getByTestId("settings-templates").waitFor({ timeout: 10_000 }).catch(() => {});
      await shot(pg, `settings-templates-used-${theme}-1280`);
      await c5.close();
    }
  }

  // ---- Screenshots -------------------------------------------------------------
  if (!noShots && !only5 && !onlyConnect) {
    mkdirSync(SHOTS, { recursive: true });
    const screens: [string, string, ((pg: Page) => Promise<void>) | null][] = [
      ["home", "/", null],
      ["editor-preview", `/p/${pid}`, async (pg) => { await pg.frameLocator("iframe[title^='Preview of']").locator("[data-builder-loc]").first().waitFor({ timeout: 20_000 }).catch(() => {}); }],
      ["editor-code", `/p/${pid}/code`, async (pg) => { await pg.getByText("App.tsx").first().click().catch(() => {}); await sleep(500); }],
      ["editor-history", `/p/${pid}/history`, null],
      ["editor-access", `/p/${pid}/access`, null],
      ["settings", "/settings", null],
    ];
    for (const theme of ["light", "dark"] as const) {
      for (const width of [1024, 1280, 1536]) {
        const c2 = await browser.newContext({ viewport: { width, height: Math.round(width * 0.625) }, colorScheme: theme });
        await c2.addInitScript((t) => localStorage.setItem("builder.theme", t), theme);
        const pg = await c2.newPage();
        for (const [name, path, prep] of screens) {
          await pg.goto(`${core.SERVER_ORIGIN}${path}`, { waitUntil: "networkidle" });
          if (prep) await prep(pg);
          await sleep(700);
          await pg.screenshot({ path: join(SHOTS, `${name}-${theme}-${width}.png`) });
        }
        if (width === 1280) {
          await pg.goto(`${core.SERVER_ORIGIN}/p/${pid}`, { waitUntil: "networkidle" });
          await sleep(600);
          await pg.keyboard.press(`${MOD}+k`);
          await sleep(400);
          await pg.screenshot({ path: join(SHOTS, `palette-${theme}-1280.png`) });
          await pg.keyboard.press("Escape");
          await pg.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
          await pg.keyboard.press("?");
          await sleep(400);
          await pg.screenshot({ path: join(SHOTS, `cheatsheet-${theme}-1280.png`) });
          await pg.keyboard.press("Escape");
        }
        await c2.close();
      }
    }
    check("screenshots written", readdirSync(SHOTS).filter((f) => f.endsWith(".png")).length >= 36, `${readdirSync(SHOTS).length} files in docs/qa/ui`);
  }
  check("no page errors in the editor", errors.length === 0, errors.slice(0, 3).join(" | "));
  await ctx.close();
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
