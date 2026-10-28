import { chromium } from "playwright";
import { code } from "./canvas.mjs";

// blocks.forkable.dev as a website, in sample mode (wrangler dev, AUTH=off,
// everyone is the Acme sample): the home lists saved UIs, /u/<id> runs one
// live under the page's CSP, a write still waits for Confirm, versions
// switch, and the data door refuses anything but this page.
const BASE = process.env.BASE ?? "http://localhost:52290";
const GET_THREADS = "conn_mod_def::GGSNlnppgZ0::qk3CudDWTVKPY7hpPVCqLQ";
const SEND = "conn_mod_def::GGXAjWkZO8U::uMc1LQIHTTKzeMm3rLL5gQ";
const theme = process.env.THEME ?? "dark";
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) process.exitCode = 1; };
const rpc = async (name, args) => (await (await fetch(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })).json()).result;

const title = `Web test ${Date.now()}`;
const made = await rpc("render_ui", { title, description: "Made by the web test", code, actions: [{ actionId: GET_THREADS }, { actionId: SEND }] });
const { uiId } = made.structuredContent;
await rpc("update_ui", { uiId, code: code.replace("Threads<", "All threads<"), actions: [{ actionId: GET_THREADS }, { actionId: SEND }] });

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1100, height: 900 }, colorScheme: theme });
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
p.on("console", (m) => m.type() === "error" && errs.push(m.text()));

await p.goto(BASE + "/");
ok(await p.getByRole("heading", { name: "Your blocks" }).isVisible(), "home shows Your blocks");
const card = p.locator(`a.card[href="/u/${uiId}"]`);
ok(await card.isVisible(), "the saved UI is listed");
ok((await card.innerText()).includes("v2") && (await card.innerText()).includes("write"), "card shows its version and that it writes");
await p.screenshot({ path: `/tmp/fb-web-home-${theme}.png`, fullPage: false });

const csp0 = (await (await fetch(`${BASE}/`)).headers.get("content-security-policy")) ?? "";
const dir = (csp, name) => (csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(name + " ")) ?? "").split(/\s+/).slice(1);
const scripts0 = dir(csp0, "script-src");
ok(scripts0.length === 2 && /^'sha256-[A-Za-z0-9+/=]+'$/.test(scripts0[0]) && scripts0[1] === "https://static.cloudflareinsights.com", "the home page allows only its own script by hash, plus Cloudflare's analytics beacon");
const themeOf = () => p.evaluate(() => document.documentElement.getAttribute("data-theme"));
ok((await themeOf()) === theme, `home follows the system theme (${theme})`);
await p.getByRole("button", { name: "Switch light or dark theme" }).click();
const flipped = theme === "dark" ? "light" : "dark";
ok((await themeOf()) === flipped && (await p.evaluate(() => localStorage.getItem("fb-theme"))) === flipped, "the toggle switches and is remembered");
await p.reload();
ok((await themeOf()) === flipped, "the choice holds after a reload");
await p.evaluate(() => localStorage.removeItem("fb-theme"));
await p.reload();
await card.click();
await p.waitForURL(`**/u/${uiId}`);
const ui = p.frameLocator("iframe");
await ui.getByText("All threads").waitFor({ timeout: 20000 });
ok(Number(await ui.getByTestId("total").innerText()) > 0, "the UI runs live on the web page");
ok(await p.getByText("Your blocks").first().isVisible(), "web bar links back home");
const frameDark = () => ui.locator("html").evaluate((el) => el.classList.contains("dark"));
ok((await frameDark()) === (theme === "dark"), "the UI frame follows the system theme");
await p.getByRole("button", { name: "Switch light or dark theme" }).click();
await p.waitForTimeout(200);
ok((await frameDark()) === (theme !== "dark") && (await p.evaluate(() => localStorage.getItem("fb-theme"))) === flipped, "the toggle on a UI page switches the frame too and is remembered");
await p.getByRole("button", { name: "Switch light or dark theme" }).click();
await p.evaluate(() => localStorage.removeItem("fb-theme"));
await ui.getByRole("button", { name: "Send" }).click();
await p.getByTestId("fb-confirm").waitFor({ timeout: 5000 });
ok((await p.getByTestId("fb-confirm").innerText()).includes("dana@acme.test"), "a write waits for Confirm on the web too");
ok((await p.evaluate(() => document.activeElement?.textContent)) === "Cancel", "Cancel has focus in the confirm dialog");
await p.screenshot({ path: `/tmp/fb-web-ui-${theme}.png` });
await p.getByTestId("fb-confirm-ok").click();
await ui.getByTestId("out").filter({ hasText: "sent sample-" }).waitFor({ timeout: 5000 });
ok(true, "confirmed write runs");
await ui.getByRole("button", { name: "Summarize" }).click();
ok(await p.getByText("works when this UI is open in a chat").isVisible(), "ask() explains it needs a chat");

await p.selectOption("select[aria-label=Version]", "1");
await p.waitForURL(`**/u/${uiId}?v=1`);
await ui.getByTestId("total").waitFor({ timeout: 20000 });
ok(!(await ui.getByText("All threads").count()), "version picker opens v1");

const csp = (await (await fetch(`${BASE}/u/${uiId}`)).headers.get("content-security-policy")) ?? "";
ok(dir(csp, "connect-src").join(" ") === "'self'" && !dir(csp, "script-src").some((v) => v.startsWith("http")) && dir(csp, "img-src").filter((v) => v.startsWith("http")).join(" ") === "https://assets.withone.ai", "the UI page has a no-outside-network CSP (images only from One's logo set)");
ok((await p.goto(BASE + "/"), await p.locator(".who-mail").innerText()) === "dana@acme.test", "the header shows the signed-in email");
const logoOk = await p.locator("a.card .tile img").first().evaluate((img) => img.decode().then(() => img.naturalWidth > 0, () => false));
ok(logoOk, "cards show the app's real logo");
const nullOrigin = await fetch(`${BASE}/api/web/tool`, { method: "POST", headers: { origin: "null", "content-type": "application/json" }, body: JSON.stringify({ name: "run_action", args: {} }) });
const noOrigin = await fetch(`${BASE}/api/web/tool`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "run_action", args: {} }) });
ok(nullOrigin.status === 403 && noOrigin.status === 403, "the data door refuses the sandboxed frame (Origin null) and other callers");
const wrongTool = await fetch(`${BASE}/api/web/tool`, { method: "POST", headers: { origin: BASE, "content-type": "application/json" }, body: JSON.stringify({ name: "delete_ui", args: { uiId } }) });
const oldBlocks = await fetch(`${BASE}/api/web/tool`, { method: "POST", headers: { origin: BASE, "content-type": "application/json" }, body: JSON.stringify({ name: "blocks_api", args: { method: "GET", path: "/api/gmail/threads" } }) });
ok(wrongTool.status === 400 && oldBlocks.status === 400, "only run_action passes the data door (blocks_api refused)");

await p.goto(`${BASE}/u/${uiId}`);
await p.getByRole("button", { name: "Delete", exact: true }).click();
const del = p.getByTestId("fb-delete");
await del.waitFor({ timeout: 5000 });
ok((await del.innerText()).includes(title) && (await p.evaluate(() => document.activeElement?.textContent)) === "Cancel", "delete asks first, names the block, Cancel focused");
await del.getByRole("button", { name: "Cancel" }).click();
ok(!(await del.count()) && p.url().endsWith(`/u/${uiId}`), "cancel keeps it");
await p.getByRole("button", { name: "Delete", exact: true }).click();
await p.getByTestId("fb-delete-ok").click();
await p.waitForURL(BASE + "/");
ok(!(await p.locator(`a.card[href="/u/${uiId}"]`).count()), "delete removes it from the home list");
ok(errs.length === 0, `no page errors ${errs.join(" | ").slice(0, 400)}`);
await b.close();
