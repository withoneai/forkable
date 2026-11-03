// Smoke check://   pnpm exec tsx scripts/smoke-preview.ts
// Scratch BUILDER_HOME, scaffold, dev server on 52000+, Playwright on
// http://smoke.localhost:51990/: client script injected, a planted runtime
// error lands in `errors` within 3 s, clicking a tagged element reports
// src/App.tsx:<line>:<col>, an edit to App.tsx shows through HMR via the
// proxy. Prints time from scaffold to first paint; fails over 15 s on a warm
// cache.

// Its own server ports (an editor may hold 51989 and 51990, the eval 51979
// and 51980). Core reads the ports at load, so this re-runs itself with them.
import { spawnSync as respawn } from "node:child_process";
if (!process.env.BUILDER_SMOKE_PORTS) {
  const r = respawn(process.execPath, ["--import", "tsx", ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, BUILDER_SMOKE_PORTS: "1", BUILDER_SERVER_PORT: process.env.BUILDER_SERVER_PORT ?? "51959", BUILDER_PROXY_PORT: process.env.BUILDER_PROXY_PORT ?? "51960" },
  });
  process.exit(r.status ?? 1);
}
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { BRAND, LOC_ATTR, PREVIEW_ROUTE, previewUrl, SERVER_ORIGIN, linkScratchTemplateCache } from "@builder/core";
import { startServer } from "@builder/server";

const results: [string, boolean, string][] = [];
const check = (name: string, pass: boolean, detail = "") => {
  results.push([name, pass, detail]);
  console.log(`${pass ? "pass" : "FAIL"}  ${name}${detail ? `   (${detail})` : ""}`);
};
const until = async <T>(fn: () => Promise<T | null | undefined | false>, ms: number, every = 100): Promise<T | null> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, every));
  }
  return null;
};

async function main(): Promise<number> {
  const scratch = mkdtempSync(join(tmpdir(), `${BRAND.slug}-smoke-preview-`));
  linkScratchTemplateCache(scratch);
  const server = await startServer({ home: scratch, log: () => {} });
  const p = server.platform;
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    await p.workspace.ensureTemplate();
    const t0 = Date.now();
    const { row, ms: scaffoldMs } = await p.workspace.create({ name: "smoke", harness: "replay", model: "demo", permission: "build", autoFix: false });
    check("scaffold", row.slug === "smoke", `${scaffoldMs} ms`);
    // A known home page with a literal heading, so the click and HMR checks do not depend on the template's start page.
    writeFileSync(
      join(row.path, "src", "App.tsx"),
      `import { AppShell } from "@/components/shell/AppShell";\n\nexport default function App() {\n  return (\n    <AppShell>\n      <h1 className="text-xl font-semibold">Acme Inc smoke</h1>\n      <p className="text-13 text-muted-foreground">Checked by smoke-preview.</p>\n    </AppShell>\n  );\n}\n`,
    );
    const target = { id: row.id, path: row.path, devUrl: `${SERVER_ORIGIN}/api/dev/${row.id}`, devToken: p.workspace.devToken(row) };
    const devStart = Date.now();
    const up = await p.devservers!.ensure(target);
    check(`dev server on ${p.devservers!.readyPort(row.id)}`, up && (p.devservers!.readyPort(row.id) ?? 0) >= 52000, `${Date.now() - devStart} ms`);

    // The editor stands in: a page on the editor origin with the preview in an iframe.
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(`${SERVER_ORIGIN}/api/health`);
    await page.evaluate((src) => {
      document.documentElement.innerHTML = "<body style='margin:0'></body>";
      (window as unknown as { msgs: unknown[] }).msgs = [];
      window.addEventListener("message", (e) => (window as unknown as { msgs: unknown[] }).msgs.push(e.data));
      const f = document.createElement("iframe");
      f.id = "preview";
      f.src = src;
      f.style.cssText = "width:1280px;height:780px;border:0";
      document.body.appendChild(f);
    }, previewUrl(row.slug));
    const frame = await until(async () => page.frames().find((f) => f.url().startsWith(previewUrl(row.slug))) ?? null, 10_000);
    if (!frame) throw new Error("The preview iframe did not load");
    await frame.waitForSelector(`[${LOC_ATTR}]`, { timeout: 15_000 });
    const firstPaint = Date.now() - t0;
    check("scaffold to first paint under 15 s", firstPaint < 15_000, `${(firstPaint / 1000).toFixed(1)} s from scaffold, ${((Date.now() - devStart) / 1000).toFixed(1)} s from dev server start`);

    const injected = await frame.evaluate((route) => !!document.querySelector(`script[src="${route}/client.js"]`), PREVIEW_ROUTE);
    check("client script injected", injected);

    // Planted runtime error.
    const planted = `smoke planted error ${Date.now()}`;
    const tErr = Date.now();
    await frame.evaluate((m) => setTimeout(() => {
      throw new Error(m);
    }, 0), planted);
    const landed = await until(async () => (await p.errors.open(row.id)).find((e) => e.message.includes(planted)), 3000);
    check("planted runtime error lands in errors within 3 s", !!landed, landed ? `${Date.now() - tErr} ms, source ${landed.source}` : "not seen");

    // Select mode and a click on a tagged element.
    await page.evaluate((slug) => {
      const f = document.getElementById("preview") as HTMLIFrameElement;
      f.contentWindow!.postMessage({ source: `${slug}-editor`, kind: "mode", mode: "select" }, "*");
    }, BRAND.slug);
    await page.waitForTimeout(200);
    const h1 = frame.locator("h1").first();
    await h1.click();
    const sel = await until(
      async () =>
        ((await page.evaluate(() => (window as unknown as { msgs: { kind?: string }[] }).msgs.filter((m) => m && m.kind === "select"))) as {
          selections: { loc: string; tag: string }[];
        }[])[0] ?? null,
      3000,
    );
    const loc = sel?.selections?.[0]?.loc ?? "";
    const app = readFileSync(join(row.path, "src", "App.tsx"), "utf8").split("\n");
    const lineNo = app.findIndex((l) => l.includes("<h1")) + 1;
    check("click reports src/App.tsx:<line>:<col>", new RegExp(`^src/App\\.tsx:${lineNo}:\\d+$`).test(loc), `${loc || "nothing"} (h1 is on line ${lineNo})`);

    // HMR through the proxy.
    const before = readFileSync(join(row.path, "src", "App.tsx"), "utf8");
    const heading = /<h1[^>]*>([^<]*)<\/h1>/.exec(before)![1]!;
    const tHmr = Date.now();
    writeFileSync(join(row.path, "src", "App.tsx"), before.replace(heading, "Hello from HMR"));
    const shown = await until(async () => (await frame.locator("h1").first().textContent())?.includes("Hello from HMR"), 8000);
    const reloaded = frame.isDetached();
    check("App.tsx edit shows through HMR via the proxy", !!shown && !reloaded, `${Date.now() - tHmr} ms`);
    await ctx.close();
  } finally {
    await browser.close();
    await server.stop();
    if (!process.argv.includes("--keep")) rmSync(scratch, { recursive: true, force: true });
  }
  const failed = results.filter((r) => !r[1]);
  console.log(failed.length ? `${failed.length} check(s) failed` : "all checks passed");
  return failed.length ? 1 : 0;
}

main().then(
  (c) => process.exit(c),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
