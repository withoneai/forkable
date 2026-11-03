// The verifier: after each turn, load the preview headless, wait
// for network idle or 8 s, collect console and page errors, check for a
// blank screen, save a screenshot. playwright-core on the installed Chrome;
// when no browser is available the step is skipped with a note.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Browser } from "playwright-core";
import type { ErrorInput } from "./errors.js";

/**
 * How the verifier signs in to a preview with One Connect on: the
 * developer's own session cookie for that preview (the proxy saw it), or, on
 * the sample One, its own Sign in with One (the stub One approves at once).
 * Without either it sees the app signed out, like a first visitor.
 */
export interface VerifySession {
  cookies?: { name: string; value: string }[];
  signIn?: boolean;
}

export interface VerifyResult {
  ran: boolean;
  note?: string;
  errors: ErrorInput[];
  blank: boolean;
  shot: string | null;
  ms: number;
}

export class Verifier {
  private browser: Promise<Browser | null> | null = null;
  private unavailable: string | null = null;

  private async launch(): Promise<Browser | null> {
    if (this.unavailable) return null;
    if (!this.browser) {
      this.browser = (async () => {
        const { chromium } = await import("playwright-core");
        for (const opts of [{ channel: "chrome" }, {}] as const) {
          try {
            return await chromium.launch({ headless: true, ...opts });
          } catch {
            /* try the next */
          }
        }
        this.unavailable = "No Chrome found, so the preview check after each step was skipped. Install Google Chrome to turn it on.";
        return null;
      })();
    }
    return this.browser;
  }

  async check(url: string, shotPath: string | null, opts: { mobile?: boolean; timeoutMs?: number; session?: VerifySession | null } = {}): Promise<VerifyResult> {
    const t0 = Date.now();
    const browser = await this.launch();
    if (!browser) return { ran: false, note: this.unavailable ?? undefined, errors: [], blank: false, shot: null, ms: 0 };
    const ctx = await browser.newContext({
      viewport: opts.mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    const errors: ErrorInput[] = [];
    const seen = new Set<string>();
    const push = (e: ErrorInput) => {
      const k = `${e.source}|${e.message}`;
      if (seen.has(k)) return;
      seen.add(k);
      errors.push(e);
    };
    page.on("pageerror", (err) => {
      const frame = /\((.*?):(\d+):(\d+)\)/.exec(err.stack ?? "") ?? /at (.*?):(\d+):(\d+)/.exec(err.stack ?? "");
      push({ source: "runtime", message: err.message, stack: err.stack ?? null, file: frame?.[1] ?? null, line: frame ? Number(frame[2]) : null, col: frame ? Number(frame[3]) : null });
    });
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const text = msg.text();
      if (/Download the React DevTools|\[vite\] connect/.test(text)) return;
      const loc = msg.location();
      push({ source: "runtime", message: text.slice(0, 2000), file: loc.url || null, line: loc.lineNumber ? loc.lineNumber + 1 : null, col: loc.columnNumber ? loc.columnNumber + 1 : null });
    });
    page.on("response", (res) => {
      const u = new URL(res.url());
      if (res.status() >= 400 && u.pathname.startsWith("/api/") && !u.pathname.startsWith("/api/one/")) {
        push({ source: "network", message: `${res.request().method()} ${u.pathname} answered ${res.status()}` });
      }
    });
    let blank = false;
    try {
      const origin = new URL(url).origin;
      if (opts.session?.cookies?.length) await ctx.addCookies(opts.session.cookies.map((c) => ({ name: c.name, value: c.value, url: origin, httpOnly: true, sameSite: "Lax" as const })));
      if (opts.session?.signIn) {
        const back = new URL(url);
        await page.goto(`${origin}/api/one/authorize?one_return_to=${encodeURIComponent(back.pathname + back.search)}`, { waitUntil: "load", timeout: opts.timeoutMs ?? 20_000 }).catch(() => {});
      }
      await page.goto(url, { waitUntil: "load", timeout: opts.timeoutMs ?? 20_000 });
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      blank = await page
        .evaluate(() => {
          const root = document.getElementById("root");
          return !!root && root.innerText.trim() === "" && root.children.length === 0;
        })
        .catch(() => false);
      if (blank) {
        await page.waitForTimeout(3000);
        blank = await page.evaluate(() => {
          const root = document.getElementById("root");
          return !!root && root.children.length === 0;
        }).catch(() => false);
      }
      if (blank) push({ source: "runtime", message: "The page is blank: #root is still empty 3 seconds after load." });
      if (shotPath) {
        mkdirSync(dirname(shotPath), { recursive: true });
        await page.screenshot({ path: shotPath, type: "png" });
      }
    } catch (err) {
      push({ source: "runtime", message: `The preview did not load: ${(err as Error).message.split("\n")[0]}` });
    } finally {
      await ctx.close().catch(() => {});
    }
    return { ran: true, errors, blank, shot: shotPath, ms: Date.now() - t0 };
  }

  async close(): Promise<void> {
    const b = await this.browser?.catch(() => null);
    this.browser = null;
    await b?.close().catch(() => {});
  }
}
