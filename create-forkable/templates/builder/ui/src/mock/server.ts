// In-browser mock of the platform server. Installed only when VITE_MOCK === "1".
// Serves docs/CONTRACT.md section 9 from ./data.ts so the editor can be built
// and screenshotted without the server. ?mock=<scenario> picks a state:
// default (live turn streaming), failed, noagent, signedout, starting, finish.
import type { ProjectEvent } from "@builder/core/api-types";
import type { Checkpoint, Project, Turn, TurnEventRow } from "@builder/core/types";
import { addSteered } from "@/lib/steered";
import * as D from "./data";

const KEY = "builder.mock";
const scenario = (() => {
  const q = new URLSearchParams(window.location.search).get("mock");
  if (q) sessionStorage.setItem(KEY, q);
  return sessionStorage.getItem(KEY) ?? "live";
})();

const state = {
  settings: { ...D.settings },
  projects: D.projects(scenario),
  turns: new Map<string, Turn[]>([["p_tasks", D.turnsTasks.map((t) => ({ ...t }))], ["p_invoices", D.turnsInvoices], ["p_new", D.turnsNew], ["p_booking", []]]),
  events: { ...D.eventsTasks, ...D.eventsInvoices, ...D.eventsNew } as Record<string, TurnEventRow[]>,
  checkpoints: new Map<string, Checkpoint[]>([["p_tasks", D.checkpointsTasks.map((c) => ({ ...c }))], ["p_new", D.checkpointsNew], ["p_invoices", [{ ...D.checkpointsTasks[4]!, sha: "aa11bb22cc33dd44ee55ff6600112233445566778", shortSha: "aa11bb2", projectId: "p_invoices", turnId: "i1", subject: "An invoices page for Acme Inc with a status column and totals", additions: 180, deletions: 6, shot: "p_invoices-c1.png", harness: "codex" }, { ...D.checkpointsNew[0]!, projectId: "p_invoices" }]], ["p_booking", []]]),
  files: { ...D.fileContent },
};

if (scenario === "failed") {
  const list = state.turns.get("p_tasks")!.filter((t) => t.id !== "t4" && t.id !== "t3");
  state.turns.set("p_tasks", list);
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const error = (status: number, code: string, message: string) => json({ error: { code, message } }, status);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const project = (id: string) => state.projects.find((p) => p.id === id);

/** A drawn stand-in for a verifier screenshot. */
function shotSvg(file: string): string {
  const variant = file.includes("c1") ? 1 : file.includes("c3") ? 3 : file.includes("booking") ? 4 : 2;
  const accent = variant === 4 ? "#0f766e" : "#6d4ae0";
  const rows = Array.from({ length: 6 }, (_, i) => {
    const y = 150 + i * 46;
    const late = variant !== 1 && i === 2;
    return `<rect x="96" y="${y}" width="1088" height="38" rx="6" fill="#fff" stroke="#ebe8e4"/>
      <rect x="112" y="${y + 13}" width="12" height="12" rx="3" fill="none" stroke="#b9b4ad" stroke-width="1.5"/>
      <rect x="140" y="${y + 14}" width="${260 - (i % 3) * 40}" height="10" rx="5" fill="#2b2926" opacity=".82"/>
      <circle cx="${820}" cy="${y + 19}" r="9" fill="${["#f4b183", "#9ec5fe", "#b5e3c4", "#f2c6de", "#ffe08a", "#c7c2f5"][i]}"/>
      <rect x="900" y="${y + 14}" width="90" height="10" rx="5" fill="${late ? "#dc2626" : "#a8a29e"}" opacity="${late ? 0.9 : 0.6}"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 800" width="1280" height="800">
    <rect width="1280" height="800" fill="#faf9f7"/>
    <rect x="96" y="56" width="70" height="9" rx="4" fill="#a8a29e"/>
    <rect x="96" y="74" width="${variant === 4 ? 260 : 150}" height="24" rx="6" fill="#1c1a17"/>
    ${variant === 4 ? `<rect x="96" y="130" width="520" height="560" rx="10" fill="#fff" stroke="#ebe8e4"/><rect x="660" y="130" width="524" height="300" rx="10" fill="${accent}" opacity=".1"/>` : rows}
    ${variant >= 2 && variant !== 4 ? `<rect x="1060" y="78" width="124" height="28" rx="6" fill="${accent}"/>` : ""}
  </svg>`;
}

class MockEventSource extends EventTarget {
  readonly url: string;
  readyState = 0;
  onopen: ((ev: Event) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  onmessage: ((ev: MessageEvent) => unknown) | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private projectId: string;

  constructor(url: string) {
    super();
    this.url = url;
    this.projectId = /\/projects\/([^/]+)\/events/.exec(url)?.[1] ?? "";
    this.timers.push(setTimeout(() => {
      this.readyState = 1;
      this.onopen?.(new Event("open"));
      this.emit({ type: "hello", projectId: this.projectId });
      this.play();
    }, 30));
  }

  private emit(e: ProjectEvent) {
    this.dispatchEvent(new MessageEvent(e.type, { data: JSON.stringify(e) }));
  }

  private play() {
    if (this.projectId !== "p_tasks" || scenario === "failed") return;
    const turns = state.turns.get("p_tasks")!;
    const t4 = turns.find((t) => t.id === "t4");
    if (!t4) return;
    let delay = 900;
    for (const event of D.liveTasks) {
      this.timers.push(setTimeout(() => {
        const rows = state.events.t4!;
        const row: TurnEventRow = { turnId: "t4", seq: (rows[rows.length - 1]?.seq ?? 1000) + 1, at: new Date().toISOString(), event };
        rows.push(row);
        this.emit({ type: "turn.event", turnId: "t4", seq: row.seq, event, at: row.at });
      }, delay));
      delay += event.t === "text_delta" ? 260 : 650;
    }
    if (scenario === "finish") {
      this.timers.push(setTimeout(() => {
        const cp: Checkpoint = { ...D.checkpointsTasks[0]!, sha: "b0b1b2b3b4b5b6b7b8b9c0c1c2c3c4c5c6c7c8c9", shortSha: "b0b1b2b", turnId: "t4", kind: "user", subject: "Add a filter for overdue tasks, and show them in red", restoredFrom: null, harness: "claude-code", createdAt: new Date().toISOString() };
        state.checkpoints.get("p_tasks")!.unshift(cp);
        Object.assign(t4, { status: "done", exit: "ok", endedAt: new Date().toISOString(), checkpointSha: cp.sha, usage: { input: 9_200, output: 1_800, cacheRead: 61_000, cacheWrite: 2_000 }, costUsd: 0.09 });
        this.emit({ type: "turn.event", turnId: "t4", seq: 5000, at: new Date().toISOString(), event: { t: "tool_end", id: "lb1", ok: true } });
        this.emit({ type: "checkpoint.created", checkpoint: cp });
        this.emit({ type: "turn.ended", turn: { ...t4 } });
      }, delay + 1500));
    }
  }

  close() {
    this.readyState = 2;
    this.timers.forEach(clearTimeout);
  }
}

async function handle(method: string, url: URL, body: unknown): Promise<Response> {
  const parts = url.pathname.replace(/^\/api\//, "").split("/").map(decodeURIComponent);
  const [root, id, sub, a, b] = parts;
  if (root === "health") return json({ ok: true, name: "Builder", version: "0.1.0", ports: { server: 51989, proxy: 51990 }, home: "/Users/acme/.builder" });
  if (root === "me") return json(D.me(scenario));
  if (root === "one" && id === "cli") return json({ cli: sub === "login" ? { ...D.cli(scenario), loginRunning: true } : D.cli(scenario) });
  if (root === "connect") {
    if (id === "templates" && method === "POST") return json({ setup: D.setups[0] });
    if (id === "templates") return json(D.templates());
    if (id === "check" || a === "check") return json({ ok: true, items: [], online: "accepted", onlineMessage: "One knows this client and its secret." });
    if (id === "setups" && method === "DELETE" && !a) return json(D.templates());
    if (id === "setups") return json({ setup: D.setups.find((x) => x.id === sub) ?? D.setups[0] });
    return error(404, "not_found", "No such route in the mock.");
  }
  if (root === "harnesses") {
    const list = D.harnesses(scenario);
    return json({ harnesses: list, defaultId: list.find((h) => h.bin)?.id ?? null });
  }
  if (root === "settings") {
    if (method === "PATCH") Object.assign(state.settings, body);
    return json({ settings: state.settings, paths: { home: "/Users/acme/.builder", projects: "/Users/acme/.builder/projects", db: "/Users/acme/.builder/db", cache: "/Users/acme/.builder/cache" }, ports: { server: 51989, proxy: 51990, devRange: [52000, 52999] } });
  }
  if (root !== "projects") return error(404, "not_found", "No such route in the mock.");
  if (!id) {
    if (method === "POST") {
      const b2 = body as { prompt?: string; harness?: Turn["harness"] };
      const p = { ...state.projects[3]!, id: `p_${Math.random().toString(36).slice(2, 8)}`, name: "New app", slug: "new-app", activeTurnId: "x1", lastShot: null };
      state.projects.unshift(p);
      const t: Turn = { ...D.turnsNew[0]!, id: "x1", projectId: p.id, prompt: b2.prompt ?? "", harness: b2.harness ?? "claude-code", startedAt: new Date().toISOString(), createdAt: new Date().toISOString() };
      state.turns.set(p.id, [t]);
      state.events.x1 = [];
      state.checkpoints.set(p.id, D.checkpointsNew);
      await sleep(600);
      return json({ project: p, turn: t }, 201);
    }
    return json({ projects: state.projects });
  }
  const p = project(id);
  if (!p) return error(404, "not_found", "That project does not exist.");
  if (!sub) {
    if (method === "PATCH") { Object.assign(p, body); return json({ project: p }); }
    return json({ project: p });
  }
  switch (sub) {
    case "turns": {
      const list = state.turns.get(id) ?? [];
      if (!a) {
        if (method === "POST") {
          const b2 = body as { prompt: string; selections?: Turn["selections"] };
          const busy = list.some((t) => t.status === "running");
          const t: Turn = { ...D.turnsNew[0]!, id: `u${Date.now()}`, projectId: id, prompt: b2.prompt, selections: b2.selections ?? [], harness: p.harness, status: busy ? "queued" : "running", startedAt: busy ? null : new Date().toISOString(), createdAt: new Date().toISOString() };
          list.push(t);
          state.events[t.id] = [];
          return json({ turn: t }, 202);
        }
        return json({ turns: [...list].reverse(), nextBefore: null });
      }
      if (b === "events") return json({ events: state.events[a] ?? [] });
      if (b === "cancel") {
        const t = list.find((x) => x.id === a);
        if (t) Object.assign(t, { status: "cancelled", exit: "cancelled", endedAt: new Date().toISOString() });
        return json({ turn: t });
      }
      if (b === "steer") return json({ queued: true });
      return error(404, "not_found", "No such turn route.");
    }
    case "files": return json({ files: D.files });
    case "file": {
      const path = url.searchParams.get("path") ?? (body as { path: string })?.path ?? "";
      if (method === "PUT") state.files[path] = (body as { content: string }).content;
      const content = state.files[path] ?? `// ${path}\n// (mock content)\n`;
      return json({ path, content, generated: path.endsWith("actions.gen.ts") });
    }
    case "checkpoint": return json({ checkpoint: null });
    case "checkpoints": {
      const list = state.checkpoints.get(id) ?? [];
      if (!a) return json({ checkpoints: list });
      const cp = list.find((c) => c.sha === a);
      if (b === "diff") return json({ sha: a, files: (cp?.files ?? []).map((f) => ({ ...f, patch: D.diffPatch(f.path) })) });
      if (b === "bookmark" && cp) { cp.bookmarked = (body as { on: boolean }).on; return json({ checkpoint: cp }); }
      if (b === "restore" && cp) {
        const n: Checkpoint = { ...cp, sha: `r${Date.now().toString(16)}aaaaaaaaaaaaaaaaaaaaaaaaaaaa`.slice(0, 40), kind: "restore", subject: `Restore to ${cp.shortSha}: ${cp.subject}`, restoredFrom: cp.sha, bookmarked: false, createdAt: new Date().toISOString() };
        n.shortSha = n.sha.slice(0, 7);
        list.unshift(n);
        return json({ checkpoint: n });
      }
      return error(404, "not_found", "No such version.");
    }
    case "errors": return json({ errors: id === "p_tasks" ? D.errorsTasks : [] });
    case "fix": return json({ turn: { ...D.turnsNew[0]!, id: `fx${Date.now()}`, projectId: id, kind: "fix", prompt: "Fix these errors", createdAt: new Date().toISOString() } }, 202);
    case "preview":
      if (a === "viewed") return new Response(null, { status: 204 });
      return json({ project: { ...p, preview: "ready" as Project["preview"] } });
    case "scopes": return json(D.scopes(id));
    case "connect": {
      const r = D.projectConnect(id, p.slug);
      if (method === "PUT") {
        const b2 = body as { enabled?: boolean };
        if (typeof b2.enabled === "boolean") r.connect.enabled = b2.enabled;
      }
      return json(r);
    }
    case "activity": return json(D.activity(id));
    case "access": await sleep(300); return json(D.accessTest(a === "test-local" ? "local" : "one"));
    case "shots": return new Response(shotSvg(a ?? ""), { headers: { "content-type": "image/svg+xml" } });
    default: return error(404, "not_found", "No such route in the mock.");
  }
}

export function installMockServer() {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : null;
    const url = new URL(req ? req.url : String(input), window.location.origin);
    if (!url.pathname.startsWith("/api/") || url.origin !== window.location.origin) return realFetch(input, init);
    const method = (init?.method ?? req?.method ?? "GET").toUpperCase();
    let body: unknown;
    const raw = init?.body ?? (req ? await req.text() : undefined);
    if (typeof raw === "string" && raw) { try { body = JSON.parse(raw); } catch { body = raw; } }
    await sleep(20 + Math.random() * 40);
    try {
      return await handle(method, url, body);
    } catch (e) {
      console.error("[mock]", e);
      return error(500, "mock_error", (e as Error).message);
    }
  };
  // Shots load through <img>, which never calls fetch: serve them from a service-free blob swap.
  const RealImage = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src")!;
  Object.defineProperty(HTMLImageElement.prototype, "src", {
    set(v: string) {
      const m = /\/api\/projects\/[^/]+\/shots\/([^/?]+)/.exec(v);
      RealImage.set!.call(this, m ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(shotSvg(decodeURIComponent(m[1]!)))}` : v);
    },
    get() { return RealImage.get!.call(this); },
  });
  const RealES = window.EventSource;
  window.EventSource = function (url: string | URL, init?: EventSourceInit) {
    const u = new URL(String(url), window.location.origin);
    if (/^\/api\/projects\/[^/]+\/events$/.test(u.pathname)) return new MockEventSource(u.pathname) as unknown as EventSource;
    return new RealES(url, init);
  } as unknown as typeof EventSource;
  if (scenario !== "failed") addSteered("t4", "Keep the done ones at the bottom");
  console.info(`[builder] mock server installed (scenario ${scenario})`);
}
