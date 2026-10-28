import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { code } from "./canvas.mjs";

// QA screenshots of the website, light and dark, into docs/qa/.
// Needs `wrangler dev --port 52290` (sample) and, for the signed-out landing,
// a second `wrangler dev --port 52292 --var AUTH:one` with no Connect secrets.
// Seeds a few saved UIs on the local sample and removes old test leftovers.
const BASE = process.env.BASE ?? "http://127.0.0.1:52290";
const AUTH_BASE = process.env.AUTH_BASE ?? "http://127.0.0.1:52292";
const OUT = new URL("../docs/qa/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const GET_THREADS = "conn_mod_def::GGSNlnppgZ0::qk3CudDWTVKPY7hpPVCqLQ";
const SEND = "conn_mod_def::GGXAjWkZO8U::uMc1LQIHTTKzeMm3rLL5gQ";
const rpc = async (name, args) =>
  (await (await fetch(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })).json()).result;

const seed = [
  ["Follow ups", "Threads waiting on your reply, with a one-click nudge", [GET_THREADS, SEND]],
  ["Unread from VIPs", "Only the people you marked as VIPs, newest first", [GET_THREADS]],
  ["Top senders this week", "Who emails you most, with unread counts per person", [GET_THREADS]],
];
for (const u of (await rpc("list_my_uis", {})).structuredContent.uis) {
  if (/^(Inbox by sender|Web test) \d+$/.test(u.title) || seed.some(([t]) => t === u.title)) await rpc("delete_ui", { uiId: u.id });
}
let featured;
for (const [title, description, actions] of seed) {
  const made = await rpc("render_ui", { title, description, code, actions: actions.map((actionId) => ({ actionId })) });
  if (title === "Follow ups") {
    featured = made.structuredContent.uiId;
    await rpc("update_ui", { uiId: featured, code: code.replace("Threads<", "All threads<"), actions: actions.map((actionId) => ({ actionId })) });
  }
}

const b = await chromium.launch();
for (const theme of ["light", "dark"]) {
  const p = await b.newPage({ viewport: { width: 1280, height: 860 }, colorScheme: theme });
  await p.goto(AUTH_BASE + "/");
  await p.screenshot({ path: `${OUT}landing-${theme}.png`, fullPage: true });
  await p.goto(BASE + "/");
  await p.screenshot({ path: `${OUT}blocks-${theme}.png`, fullPage: true });
  await p.goto(BASE + "/?q=calendar");
  await p.screenshot({ path: `${OUT}blocks-nomatch-${theme}.png` });
  await p.goto(`${BASE}/u/${featured}`);
  const ui = p.frameLocator("iframe");
  await ui.getByText("All threads").waitFor({ timeout: 20000 });
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}ui-${theme}.png` });
  await ui.getByRole("button", { name: "Send" }).click();
  await p.getByTestId("fb-confirm").waitFor();
  await p.waitForTimeout(200);
  await p.screenshot({ path: `${OUT}confirm-${theme}.png` });
  await p.getByRole("button", { name: "Cancel" }).click();
  await p.getByRole("button", { name: "Delete", exact: true }).click();
  await p.getByTestId("fb-delete").waitFor();
  await p.screenshot({ path: `${OUT}delete-${theme}.png` });
  await p.close();

  const m = await b.newPage({ viewport: { width: 390, height: 844 }, colorScheme: theme, deviceScaleFactor: 2 });
  await m.goto(AUTH_BASE + "/");
  await m.screenshot({ path: `${OUT}landing-390-${theme}.png`, fullPage: true });
  await m.goto(BASE + "/");
  await m.screenshot({ path: `${OUT}blocks-390-${theme}.png`, fullPage: true });
  await m.goto(`${BASE}/u/${featured}`);
  await m.frameLocator("iframe").getByText("All threads").waitFor({ timeout: 20000 });
  await m.screenshot({ path: `${OUT}ui-390-${theme}.png` });
  await m.close();
}
await b.close();
console.log("wrote", OUT);
