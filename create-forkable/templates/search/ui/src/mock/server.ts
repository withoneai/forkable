// In-browser mock of the Search server, installed only when VITE_MOCK=1.
// Answers every route in CONTRACT 6.2 from the Acme world, plus the two
// streams (POST /chat as SSE, GET /events through a fake EventSource), so the
// UI runs end to end before the server exists. Unset VITE_MOCK and the same
// code talks to the real server on 52289 through Vite's proxy.
import type { ServerEvent } from "@/contract/api-types";
import { HttpError, listeners, routes } from "./http";
import "./routes-core";
import "./routes-account";
import "./routes-drafts";
import "./routes-chat";

async function handle(method: string, url: URL, body: unknown, signal?: AbortSignal | null): Promise<Response> {
  const path = url.pathname.startsWith("/api/v1/") ? url.pathname.slice("/api/v1".length) : url.pathname;
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.re.exec(path);
    if (!m) continue;
    const params = Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1]!)]));
    try {
      const out = await r.handler({ params, url, body, signal });
      if (out instanceof Response) return out;
      return new Response(JSON.stringify(out ?? null), { status: 200, headers: { "content-type": "application/json" } });
    } catch (e) {
      if (e instanceof HttpError) return new Response(JSON.stringify({ error: { code: e.code, message: e.message, data: e.data } }), { status: e.status, headers: { "content-type": "application/json" } });
      console.error("[mock]", method, path, e);
      return new Response(JSON.stringify({ error: { code: "internal", message: (e as Error).message } }), { status: 500, headers: { "content-type": "application/json" } });
    }
  }
  return new Response(JSON.stringify({ error: { code: "not_found", message: `Mock has no route for ${method} ${path}` } }), { status: 404, headers: { "content-type": "application/json" } });
}

class MockEventSource extends EventTarget {
  static readonly CONNECTING = 0 as const;
  static readonly OPEN = 1 as const;
  static readonly CLOSED = 2 as const;
  readonly CONNECTING = 0 as const;
  readonly OPEN = 1 as const;
  readonly CLOSED = 2 as const;
  readonly url: string;
  readonly withCredentials = true;
  readyState: 0 | 1 | 2 = 0;
  onopen: ((this: EventSource, ev: Event) => unknown) | null = null;
  onmessage: ((this: EventSource, ev: MessageEvent) => unknown) | null = null;
  onerror: ((this: EventSource, ev: Event) => unknown) | null = null;
  private listener = (e: ServerEvent) => {
    if (this.readyState === 2) return;
    this.onmessage?.call(this as unknown as EventSource, new MessageEvent("message", { data: JSON.stringify(e) }));
  };
  private ping: ReturnType<typeof setInterval> | null = null;
  constructor(url: string | URL) {
    super();
    this.url = String(url);
    listeners.add(this.listener);
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.call(this as unknown as EventSource, new Event("open"));
      this.ping = setInterval(() => this.listener({ type: "ping" }), 25_000);
    }, 10);
  }
  close() {
    this.readyState = 2;
    listeners.delete(this.listener);
    if (this.ping) clearInterval(this.ping);
  }
}

export function installMockServer() {
  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin);
    if (url.origin !== location.origin || !url.pathname.startsWith("/api")) return real(input, init);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    let body: unknown;
    if (init?.body && typeof init.body === "string") { try { body = JSON.parse(init.body); } catch { body = init.body; } }
    return handle(method, url, body, init?.signal);
  };
  (window as unknown as { EventSource: unknown }).EventSource = MockEventSource;
  // eslint-disable-next-line no-console
  console.info("[search] mock server on: every /api call is answered in the browser from the Acme sample");
}
