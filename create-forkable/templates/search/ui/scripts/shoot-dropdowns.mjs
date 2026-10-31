#!/usr/bin/env node
// QA screenshots of the new Select dropdown, open and closed, light and dark.
// Spins its own mock Vite instance so it never touches a running `pnpm dev`.
//   node scripts/shoot-dropdowns.mjs [outDir]      default ../docs/qa/dropdowns
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const uiDir = resolve(here, "..");
const out = resolve(process.argv[2] ?? resolve(uiDir, "../docs/qa/dropdowns"));
mkdirSync(out, { recursive: true });

let base = process.env.SHOOT_URL;
let child = null;
async function up(u) { try { return (await fetch(u)).ok; } catch { return false; } }
if (!base) {
  base = "http://localhost:5683";
  child = spawn("npx", ["vite", "--port", "5683", "--strictPort"], { cwd: uiDir, env: { ...process.env, VITE_MOCK: "1", NODE_ENV: "development" }, stdio: "ignore" });
  for (let i = 0; i < 60 && !(await up(base)); i++) await new Promise((r) => setTimeout(r, 500));
}

const shots = [
  { name: "assistant-chat-model", path: "/settings/assistant", trigger: { label: "Chat model" } },
  { name: "search-embedding-model", path: "/settings/search", trigger: { label: "Embedding model" } },
  { name: "search-add-vip", path: "/settings/search", trigger: { label: "Add a VIP" } },
];

const browser = await chromium.launch();
for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: theme, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  for (const s of shots) {
    await page.goto(`${base}/start`);
    await page.evaluate((t) => { localStorage.setItem("search.theme", t); localStorage.setItem("search.mock", JSON.stringify({ signedIn: true, setup: {} })); localStorage.setItem("search.dock.open", "0"); }, theme);
    await page.goto(`${base}${s.path}`);
    await page.waitForTimeout(1200);
    const trigger = page.getByRole("combobox", { name: s.trigger.label });
    await trigger.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}/${s.name}-closed-${theme}.png` });
    await trigger.click();
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${out}/${s.name}-open-${theme}.png` });
    await page.keyboard.press("Escape");
  }
  await ctx.close();
}
await browser.close();
if (child) child.kill();
console.log(`wrote ${out}`);
