import { ROUTE } from "./env";
import type { PreviewBeacon } from "./types";

// Error capture: window errors, rejections, console.error/warn, failing
// same-origin /api calls, and a blank-screen check. Everything goes to
// /__<slug>/events in small batches with sendBeacon.

const MAX = 2048;
const queue: PreviewBeacon[] = [];
const seen = new Set<string>();
let timer: number | null = null;

const page = () => location.pathname + location.search;

function flush(): void {
  timer = null;
  if (queue.length === 0) return;
  const body = JSON.stringify(queue.splice(0, queue.length));
  const url = `${ROUTE}/events`;
  const blob = new Blob([body], { type: "application/json" });
  if (!(navigator.sendBeacon && navigator.sendBeacon(url, blob))) {
    void originalFetch(url, { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true }).catch(() => {});
  }
}

export function report(b: Omit<PreviewBeacon, "page" | "at">): void {
  const key = `${b.kind}|${b.message}|${b.file ?? ""}:${b.line ?? ""}|${b.status ?? ""}|${b.path ?? ""}`;
  if (seen.has(key)) return; // once per page load
  seen.add(key);
  queue.push({ ...b, message: b.message.slice(0, MAX), stack: b.stack?.slice(0, MAX), page: page(), at: Date.now() });
  if (timer === null) timer = window.setTimeout(flush, 200);
}

/** First frame that points into the app's own source, as file:line:col. */
function where(stack: string | undefined): { file?: string; line?: number; col?: number } {
  if (!stack) return {};
  for (const raw of stack.split("\n")) {
    const m = /(?:https?:\/\/[^/]+)?\/((?:src|server)\/[^?:)\s]+)(?:\?[^:)\s]*)?:(\d+):(\d+)/.exec(raw);
    if (m) return { file: m[1], line: Number(m[2]), col: Number(m[3]) };
  }
  return {};
}

function trimStack(stack: string | undefined): string | undefined {
  if (!stack) return undefined;
  return stack
    .split("\n")
    .filter((l) => !/node_modules|\/@vite\/|\/@react-refresh|__[a-z]+\/client\.js/.test(l))
    .slice(0, 12)
    .join("\n");
}

function text(v: unknown): string {
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

const originalFetch = window.fetch.bind(window);

function isOwnApi(url: URL): boolean {
  return url.origin === location.origin && url.pathname.startsWith("/api/");
}

async function inspectResponse(url: URL, method: string, res: Response): Promise<void> {
  if (res.ok || !isOwnApi(url)) return;
  let refusal: PreviewBeacon["refusal"];
  let message = `${method} ${url.pathname} answered ${res.status}`;
  try {
    if ((res.headers.get("content-type") ?? "").includes("json")) {
      const body = (await res.clone().json()) as { refusal?: { source?: string; code?: string }; error?: { message?: string } };
      if (body?.refusal?.source) refusal = { source: String(body.refusal.source), code: String(body.refusal.code ?? "") };
      if (body?.error?.message) message += `: ${body.error.message}`;
    }
  } catch {
    /* not JSON */
  }
  if (refusal?.source === "held") heldToast();
  report({ kind: "network", level: res.status >= 500 ? "error" : "warning", message, status: res.status, path: url.pathname, refusal });
}

/** A write the local check held while a turn runs shows this, once per few seconds. */
let toastAt = 0;
function heldToast(): void {
  if (Date.now() - toastAt < 4000) return;
  toastAt = Date.now();
  const el = document.createElement("div");
  el.textContent = "Writes pause while the agent works";
  el.setAttribute("role", "status");
  el.style.cssText =
    "position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:2147483647;padding:8px 14px;border-radius:8px;font:500 13px/1.4 Inter,system-ui,sans-serif;background:#1c1a17;color:#faf9f7;box-shadow:0 6px 24px rgba(0,0,0,.18);pointer-events:none;opacity:0;transition:opacity .15s";
  document.body.appendChild(el);
  requestAnimationFrame(() => (el.style.opacity = "1"));
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 200);
  }, 2600);
}

export function installCapture(): void {
  window.addEventListener("error", (e) => {
    if (e.target && e.target !== window && (e.target as Element).tagName) {
      const el = e.target as HTMLScriptElement & HTMLImageElement & HTMLLinkElement;
      const src = el.src || el.href || "";
      // ?t= is Vite re-importing a module after an edit; a build error already covers it.
      if (src && !/[?&]t=\d+/.test(src)) report({ kind: "runtime", level: "error", message: `Failed to load ${el.tagName.toLowerCase()} ${src}` });
      return;
    }
    const err = e.error as Error | undefined;
    const stack = trimStack(err?.stack);
    const loc = where(err?.stack) ;
    report({
      kind: "runtime",
      level: "error",
      message: err ? text(err) : String(e.message),
      stack,
      ...(loc.file ? loc : e.filename && /\/(src|server)\//.test(e.filename) ? { file: e.filename.replace(/^https?:\/\/[^/]+\//, "").replace(/\?.*$/, ""), line: e.lineno, col: e.colno } : {}),
    });
  }, true);

  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason as Error | undefined;
    report({ kind: "unhandledrejection", level: "error", message: `Unhandled promise rejection: ${text(r)}`, stack: trimStack(r?.stack), ...where(r?.stack) });
  });

  for (const level of ["error", "warn"] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      orig(...args);
      try {
        const msg = args.map(text).join(" ");
        if (/^\[vite\]|^\[hmr\]|Download the React DevTools/i.test(msg)) return;
        const err = args.find((a): a is Error => a instanceof Error);
        report({ kind: "console", level: level === "error" ? "error" : "warning", message: msg, stack: trimStack(err?.stack), ...where(err?.stack ?? new Error().stack?.split("\n").slice(2).join("\n")) });
      } catch {
        /* never break the app's console */
      }
    };
  }

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await originalFetch(input, init);
    try {
      const raw = typeof input === "string" || input instanceof URL ? String(input) : input.url;
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      void inspectResponse(new URL(raw, location.href), method, res);
    } catch {
      /* ignore */
    }
    return res;
  };

  const open = XMLHttpRequest.prototype.open;
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest & { __m?: string; __u?: string }, method: string, url: string | URL, ...rest: unknown[]) {
    this.__m = method;
    this.__u = String(url);
    return (open as (...a: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest & { __m?: string; __u?: string }, body?: Document | XMLHttpRequestBodyInit | null) {
    this.addEventListener("loadend", () => {
      try {
        const url = new URL(this.__u ?? "", location.href);
        if (!isOwnApi(url) || (this.status >= 200 && this.status < 300) || this.status === 0) return;
        let refusal: PreviewBeacon["refusal"];
        try {
          const b = JSON.parse(this.responseText) as { refusal?: { source?: string; code?: string } };
          if (b?.refusal?.source) refusal = { source: String(b.refusal.source), code: String(b.refusal.code ?? "") };
        } catch {
          /* not JSON */
        }
        report({ kind: "network", level: this.status >= 500 ? "error" : "warning", message: `${(this.__m ?? "GET").toUpperCase()} ${url.pathname} answered ${this.status}`, status: this.status, path: url.pathname, refusal });
      } catch {
        /* ignore */
      }
    });
    return send.call(this, body);
  };

  const blankCheck = () =>
    window.setTimeout(() => {
      const root = document.getElementById("root");
      if (root && root.childElementCount === 0 && !(root.textContent ?? "").trim()) {
        report({ kind: "blank", level: "error", message: "The page is blank: #root is still empty 3 s after load." });
      }
    }, 3000);
  if (document.readyState === "complete") blankCheck();
  else window.addEventListener("load", blankCheck, { once: true });

  window.addEventListener("pagehide", flush);
}
