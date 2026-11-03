// The preview client. Injected by the preview proxy into every HTML page of a
// project's dev server (never part of the generated repo). It reports errors
// to /__<slug>/events and talks to the editor over postMessage.

import { isEmbedded, onEditor, toEditor } from "./channel";
import { installCapture, report } from "./capture";
import { SLUG } from "./env";
import { applyClass, clearSelection, getMode, highlight, installSelect, scrollTo, setMode, setPending } from "./select";

declare global {
  interface Window {
    [key: `__${string}_preview__`]: boolean | undefined;
  }
}

const FLAG = `__${SLUG}_preview__` as const;

function editable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

/** Editor shortcuts typed while the preview has focus are handed to the editor. */
function forwardKey(e: KeyboardEvent): void {
  if (!isEmbedded) return;
  const meta = e.metaKey || e.ctrlKey;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const plain = !meta && !e.altKey && !editable(e.target);
  const editorCombo =
    (meta && ["k", ".", "b", "1", "2", "3", "4", "s"].includes(k)) ||
    (meta && e.shiftKey && k === "p") ||
    (e.altKey && (k === "r" || e.code === "KeyR"));
  const single = plain && (["s", "t", "c", "?"].includes(k) || k === "Escape");
  if (!editorCombo && !single) return;
  if (editorCombo) e.preventDefault();
  toEditor({ kind: "key", key: e.code === "KeyR" && e.altKey ? "r" : k, meta, shift: e.shiftKey, alt: e.altKey });
}

/** Route changes, so the editor's URL field follows the app. */
function installRoutes(): void {
  let last = location.pathname + location.search + location.hash;
  const check = () => {
    const now = location.pathname + location.search + location.hash;
    if (now === last) return;
    last = now;
    toEditor({ kind: "route", path: now });
  };
  for (const name of ["pushState", "replaceState"] as const) {
    const orig = history[name].bind(history);
    history[name] = ((...args: Parameters<History["pushState"]>) => {
      const r = orig(...args);
      check();
      return r;
    }) as History["pushState"];
  }
  window.addEventListener("popstate", check);
  window.addEventListener("hashchange", check);
}

/**
 * HMR status. An injected classic script has no import.meta.hot, so it
 * imports the page's own /@vite/client module (same URL, same instance and
 * socket) and opens a hot context on it.
 */
async function installHmr(): Promise<void> {
  try {
    const url = "/@vite/client";
    const mod = (await import(/* @vite-ignore */ url)) as {
      createHotContext?: (path: string) => { on(event: string, cb: (payload: unknown) => void): void };
    };
    const hot = mod.createHotContext?.(`/__${SLUG}/client.js`);
    if (!hot) return;
    hot.on("vite:afterUpdate", () => toEditor({ kind: "hmr", ok: true }));
    hot.on("vite:error", (payload) => {
      const err = (payload as { err?: { message?: string } })?.err;
      // Vite's message names the absolute path; the editor wants src/... like everywhere else.
      const message = err?.message?.replace(/\/[^\s:"']*?\/((?:src|server)\/)/g, "$1").slice(0, 500);
      toEditor({ kind: "hmr", ok: false, message });
    });
    hot.on("vite:ws:disconnect", () => toEditor({ kind: "hmr", ok: false, message: "Lost the connection to the preview server" }));
  } catch {
    /* not a Vite page (the "Starting preview" page, a built app) */
  }
}

if (!window[FLAG]) {
  window[FLAG] = true;
  installCapture();
  installRoutes();
  installSelect(forwardKey);
  void installHmr();
  onEditor((msg) => {
    switch (msg.kind) {
      case "mode":
        setMode(msg.mode);
        break;
      case "highlight":
        highlight(msg.loc);
        break;
      case "clear":
        clearSelection();
        highlight(null);
        break;
      case "scroll-to":
        scrollTo(msg.loc);
        break;
      case "apply-class":
        applyClass(msg.loc, msg.remove, msg.add);
        break;
      case "pending":
        setPending(msg.locs);
        break;
      case "receipt-test":
        // Access, Ask One: the app runs the ticket's call on the developer's own sign-in (same origin, its cookie).
        void fetch("/api/one/dev/receipt-test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticket: msg.ticket }), credentials: "same-origin" })
          .then(async (r) => {
            const j = (await r.json().catch(() => ({}))) as { status?: number; blockedByGrant?: boolean; message?: string };
            toEditor({ kind: "receipt-test", ticket: msg.ticket, status: Number(j.status ?? r.status), blockedByGrant: Boolean(j.blockedByGrant), ...(j.message ? { message: j.message } : {}) });
          })
          .catch(() => toEditor({ kind: "receipt-test", ticket: msg.ticket, status: 502, blockedByGrant: false, message: "The preview did not answer." }));
        break;
    }
  });
  const hello = () => toEditor({ kind: "hello", path: location.pathname + location.search + location.hash, title: document.title });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hello, { once: true });
  else hello();
  void getMode;
  void report;
}
