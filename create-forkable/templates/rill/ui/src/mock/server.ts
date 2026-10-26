// In-browser mock of the Rill server. Installed only when VITE_MOCK === "1".
// Serves docs/CONTRACT.md "Server API" from ./data.ts so the UI can be built
// before the real server exists. State lives in memory; a flag in
// localStorage remembers that the sample mailbox exists across reloads.
import type {
  AccessResponse, ApiDraft, ApiGoal, ApiMailbox, ApiSettings, ApiVip, AskResponse, BriefResponse, EnginesResponse,
  InboxResponse, InboxRow, LedgerRow, MailboxEvent, MeResponse, OnboardingSuggestions, PaletteResponse, ThreadAction,
  ThreadResponse, VipInput, GoalInput,
} from "@rill/core/api-types";
import type { Lane } from "@rill/core/types";
import { LANES } from "@rill/core/types";
import * as D from "./data";

const MAILBOX_ID = "mb_sample";
const PERSIST = "rill.mock";
const JUDGE_MS = 380; // one thread judged every 380ms during the live sort

interface Persisted { hasSample: boolean; onboarded: boolean; judgeStart: number | null }

function readPersisted(): Persisted {
  try {
    const raw = localStorage.getItem(PERSIST);
    if (raw) return JSON.parse(raw) as Persisted;
  } catch { /* ignore */ }
  return { hasSample: false, onboarded: false, judgeStart: null };
}
const persisted = readPersisted();
const persist = () => { try { localStorage.setItem(PERSIST, JSON.stringify(persisted)); } catch { /* ignore */ } };

type ThreadState = {
  done: boolean; snoozedUntil: string | null; replyLater: boolean; lane: Lane; unread: boolean;
  draft: ApiDraft | null; vip: InboxRow["vip"];
};

const state = {
  goals: structuredClone(D.goals) as ApiGoal[],
  vips: structuredClone(D.vips) as ApiVip[],
  settings: { ...D.settings, onboarded: persisted.onboarded } as ApiSettings,
  ledger: [...D.ledger] as LedgerRow[],
  senderStatus: new Map<string, "let_in" | "screened_out">(),
  threads: new Map<string, ThreadState>(),
  disconnected: false,
};

for (const t of D.threads) {
  state.threads.set(t.id, {
    done: false, snoozedUntil: null, replyLater: false, lane: t.lane, unread: t.unread, vip: t.vip,
    draft: t.draft ? D.mkDraft(t, t.draft) : null,
  });
}

// ---- judging progress ---------------------------------------------------------
function judgedCount(): number {
  if (persisted.judgeStart == null) return 0;
  const n = Math.floor((Date.now() - persisted.judgeStart) / JUDGE_MS);
  return Math.max(0, Math.min(D.judgeOrder.length, n));
}
const judgedSet = () => new Set(D.judgeOrder.slice(0, judgedCount()));
const isJudged = (id: string) => judgedSet().has(id);

// ---- rows ---------------------------------------------------------------------
function row(t: D.MockThread): InboxRow {
  const s = state.threads.get(t.id)!;
  return {
    threadId: t.id,
    lane: s.lane,
    subject: t.subject,
    snippet: t.messages[t.messages.length - 1]!.body.replace(/\s+/g, " ").slice(0, 140),
    from: t.from,
    lastMessageAt: t.at,
    messageCount: t.messages.length,
    priority: t.priority,
    confidence: t.confidence,
    check: t.check,
    goal: t.goal,
    vip: s.vip,
    kind: t.kind,
    needsReply: t.needsReply,
    urgency: t.urgency,
    summary: t.summary,
    hasDraft: !!s.draft && s.draft.status !== "sent" && s.draft.status !== "discarded",
    screen: t.screen,
    snoozedUntil: s.snoozedUntil,
    replyLater: s.replyLater,
    unread: s.unread,
    invite: null,
  };
}

function visible(includeDone: boolean) {
  const now = Date.now();
  return D.threads.filter((t) => {
    const s = state.threads.get(t.id)!;
    if (!isJudged(t.id)) return false;
    if (!includeDone && s.done) return false;
    if (s.snoozedUntil && new Date(s.snoozedUntil).getTime() > now) return false;
    return true;
  });
}

function counts(): Record<Lane, number> {
  const c = Object.fromEntries(LANES.map((l) => [l, 0])) as Record<Lane, number>;
  for (const t of visible(false)) c[state.threads.get(t.id)!.lane] += 1;
  return c;
}

function mailbox(): ApiMailbox {
  return {
    id: MAILBOX_ID,
    source: "sample",
    mode: "fixture",
    label: "Acme sample inbox",
    address: D.ME.email,
    status: state.disconnected ? "reconnect_required" : "active",
    lastSyncAt: new Date(Date.now() - 4 * 60_000).toISOString(),
    onboarded: state.settings.onboarded,
    counts: counts(),
    mailProvider: "gmail",
    calendarProvider: null,
  };
}

// ---- SSE ----------------------------------------------------------------------
type Listener = (e: MailboxEvent) => void;
const listeners = new Set<Listener>();
export function emit(e: MailboxEvent) { listeners.forEach((l) => l(e)); }

class MockEventSource extends EventTarget {
  static readonly CONNECTING = 0 as const;
  static readonly OPEN = 1 as const;
  static readonly CLOSED = 2 as const;
  readonly CONNECTING = 0 as const;
  readonly OPEN = 1 as const;
  readonly CLOSED = 2 as const;
  readonly url: string;
  readonly withCredentials = false;
  readyState: 0 | 1 | 2 = 0;
  onopen: ((this: EventSource, ev: Event) => unknown) | null = null;
  onmessage: ((this: EventSource, ev: MessageEvent) => unknown) | null = null;
  onerror: ((this: EventSource, ev: Event) => unknown) | null = null;
  private listener: Listener;
  private timer: ReturnType<typeof setInterval> | null = null;
  private seen = 0;
  private syncing = false;

  constructor(url: string | URL) {
    super();
    this.url = String(url);
    this.listener = (e) => this.push(e);
    listeners.add(this.listener);
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.call(this as unknown as EventSource, new Event("open"));
      this.seen = judgedCount();
      if (this.seen < D.judgeOrder.length) { this.syncing = true; this.push({ type: "sync", phase: "start" }); }
      this.push({ type: "progress", judged: this.seen, total: D.judgeOrder.length });
      this.timer = setInterval(() => this.tick(), 120);
    }, 10);
  }
  private tick() {
    const n = judgedCount();
    while (this.seen < n) {
      const id = D.judgeOrder[this.seen]!;
      const t = D.threads.find((x) => x.id === id)!;
      this.seen += 1;
      this.push({ type: "judged", threadId: id, lane: t.lane, priority: t.priority });
      this.push({ type: "progress", judged: this.seen, total: D.judgeOrder.length });
    }
    if (this.syncing && n >= D.judgeOrder.length) {
      this.syncing = false;
      this.push({ type: "sync", phase: "done", imported: D.judgeOrder.length });
    }
  }
  private push(e: MailboxEvent) {
    if (this.readyState === 2) return;
    this.onmessage?.call(this as unknown as EventSource, new MessageEvent("message", { data: JSON.stringify(e) }));
  }
  close() {
    this.readyState = 2;
    listeners.delete(this.listener);
    if (this.timer) clearInterval(this.timer);
  }
}

// ---- router -------------------------------------------------------------------
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const noContent = () => new Response(null, { status: 204 });
const error = (status: number, code: string, message: string) => json({ error: { code, message } }, status);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const nextId = (() => { let n = 100; return (p: string) => `${p}${++n}`; })();

function threadResponse(t: D.MockThread): ThreadResponse {
  const s = state.threads.get(t.id)!;
  const other = t.from.email === D.ME.email ? { name: t.messages[0]!.to[0]!.split("@")[0]!, email: t.messages[0]!.to[0]! } : t.from;
  const vip = state.vips.find((vv) => vv.id === s.vip?.id) ?? null;
  const withThem = D.threads
    .filter((x) => x.id !== t.id && (x.from.email === other.email || x.messages.some((m) => m.to.includes(other.email))))
    .map((x) => ({ threadId: x.id, subject: x.subject, lastMessageAt: x.at }));
  return {
    thread: { id: t.id, subject: t.subject, lastMessageAt: t.at, participants: [...new Map([t.from, ...t.messages.map((m) => m.from), ...(t.from.email === D.ME.email ? [other] : [])].map((p) => [p.email, p])).values()] },
    state: row(t),
    messages: t.messages,
    why: t.why,
    rule: t.rule,
    judgedBy: D.MODEL_JEV,
    ask: t.ask,
    draft: s.draft,
    person: {
      name: other.name,
      email: other.email,
      vip: vip ? { id: vip.id, name: vip.name, tier: vip.tier, rules: vip.rules } : null,
      senderStatus: state.senderStatus.get(other.email) ?? (t.firstTime ? "unknown" : "let_in"),
      threadsWithThem: withThem,
    },
    invite: null,
  };
}

function access(): AccessResponse {
  const today = state.ledger.filter((r) => Date.now() - new Date(r.at).getTime() < 86_400_000);
  return {
    grant: {
      mode: "fixture",
      holder: D.ME.email,
      status: state.disconnected ? "revoked" : "active",
      scopes: D.scopes,
      oneActivityUrl: "https://app.withone.ai/activity",
    },
    activity: [...state.ledger].sort((a, b) => b.at.localeCompare(a.at)),
    today: { calls: today.length, declined: today.filter((r) => r.blockedByGrant).length },
  };
}

function addLedger(partial: Omit<LedgerRow, "id" | "at">): LedgerRow {
  const r: LedgerRow = { id: 1000 + state.ledger.length, at: new Date().toISOString(), ...partial };
  state.ledger.push(r);
  emit({ type: "ledger", row: r });
  return r;
}

async function handle(method: string, url: URL, body: unknown): Promise<Response> {
  const path = url.pathname;
  const seg = path.split("/").filter(Boolean); // ["api","v1",...]

  if (path === "/api/health") return json({ ok: true, version: "0.1.0-mock" });
  if (seg[0] !== "api" || seg[1] !== "v1") return error(404, "not_found", `No route ${path}`);
  const rest = seg.slice(2);

  if (rest[0] === "me" && method === "GET") {
    const me: MeResponse = {
      user: persisted.hasSample ? { id: "u_1", name: D.ME.name, email: D.ME.email, avatarUrl: null } : null,
      mailboxes: persisted.hasSample ? [mailbox()] : [],
      connect: { configured: false, connected: false },
      // Seeded scenario: a grant that reaches Gmail and Jev. Fresh and onboarding: not connected yet.
      grant: { platforms: persisted.hasSample && persisted.onboarded ? ["gmail", "typesafe"] : [] },
      local: true,
    };
    return json(me);
  }
  if (rest[0] === "signout" && method === "POST") {
    persisted.hasSample = false; persisted.onboarded = false; persisted.judgeStart = null; persist();
    state.settings.onboarded = false;
    return noContent();
  }
  if (rest[0] === "connect" && rest[1] === "disconnect" && method === "POST") {
    state.disconnected = true;
    emit({ type: "reconnect_required" });
    return noContent();
  }
  if (rest[0] === "engines" && method === "GET") {
    const current = state.settings.writerEngine
      ? { engine: state.settings.writerEngine, provider: state.settings.writerProvider ?? "", model: state.settings.writerModel ?? "" }
      : null;
    const res: EnginesResponse = { options: D.engines, current, local: true };
    return json(res);
  }
  if (rest[0] === "mailboxes" && rest[1] === "sample" && method === "POST") {
    if (!persisted.hasSample) {
      persisted.hasSample = true;
      persisted.judgeStart = Date.now();
      persist();
    }
    return json(mailbox());
  }
  if (rest[0] !== "mailboxes" || !rest[1]) return error(404, "not_found", `No route ${path}`);
  if (rest[1] !== MAILBOX_ID || !persisted.hasSample) return error(404, "mailbox_not_found", "No such mailbox");
  if (state.disconnected && rest[2] !== "settings" && rest[2] !== "access" && rest[2] !== "ledger") {
    return error(403, "reconnect_required", "Your access was revoked in One.");
  }
  const sub = rest[2];
  const id3 = rest[3];
  const sub4 = rest[4];

  switch (sub) {
    case "inbox": {
      const lane = (url.searchParams.get("lane") ?? "vip") as Lane;
      const includeDone = url.searchParams.get("includeDone") === "1";
      const rows = visible(includeDone).map(row).filter((r) => r.lane === lane)
        .sort((a, b) => b.priority - a.priority || b.lastMessageAt.localeCompare(a.lastMessageAt));
      const res: InboxResponse = { rows, counts: counts(), syncing: judgedCount() < D.judgeOrder.length, judging: D.judgeOrder.length - judgedCount() };
      return json(res);
    }
    case "threads": {
      const t = D.threads.find((x) => x.id === id3);
      if (!t) return error(404, "thread_not_found", "No such thread");
      const s = state.threads.get(t.id)!;
      if (method === "GET") { s.unread = false; return json(threadResponse(t)); }
      if (sub4 === "actions" && method === "POST") {
        const a = body as ThreadAction;
        switch (a.action) {
          case "done": s.done = true; break;
          case "undo": s.done = false; s.snoozedUntil = null; s.replyLater = false; break;
          case "snooze": s.snoozedUntil = a.until; break;
          case "reply_later": s.replyLater = !s.replyLater; break;
          case "let_in": state.senderStatus.set(t.from.email, "let_in"); s.lane = t.goal ? "goals" : t.needsReply ? "reply" : "other"; break;
          case "screen_out": state.senderStatus.set(t.from.email, "screened_out"); s.lane = "other"; s.done = true; break;
          case "add_vip": {
            const vip: ApiVip = { id: nextId("v"), name: t.from.name, matchKind: "address", match: t.from.email, tier: a.tier ?? "key", rules: {}, matched7d: 1 };
            state.vips.push(vip);
            s.vip = { id: vip.id, name: vip.name, tier: vip.tier };
            s.lane = "vip";
            break;
          }
          case "move": s.lane = a.lane; break;
        }
        if (a.action !== "undo") addLedger({ platform: "gmail", action: "gmail.modify-thread-labels", method: "POST", path: `/gmail/v1/users/me/threads/${t.id}/modify`, mode: "fixture", level: "write", status: 200, ok: true, blockedByGrant: false, refusal: null, engine: null, model: null, ms: 120 + Math.round(Math.random() * 80), summary: `${a.action} · ${t.subject}`, note: null });
        emit({ type: "judged", threadId: t.id, lane: s.lane, priority: t.priority });
        return json(row(t));
      }
      if (sub4 === "draft" && method === "POST") {
        const instr = (body as { instructions?: string } | null)?.instructions?.trim();
        await sleep(900);
        const base = t.draft ?? `Hi ${t.from.name.split(" ")[0]},\n\nThanks for your note. I will come back to you on this by Friday.\n\nDana`;
        const text = instr ? `${base.split("\n\n").slice(0, -1).join("\n\n")}\n\n(${instr})\n\nDana` : base;
        s.draft = { ...D.mkDraft(t, text), id: s.draft?.id ?? D.mkDraft(t, text).id, status: "proposed" };
        if (instr && /link|url/i.test(instr)) s.draft.validator = { ok: false, reasons: ["Contains a URL that was not in the thread"] };
        addLedger({ platform: "claude-code", action: "writer.draft", method: "LOCAL", path: "claude -p --tools \"\"", mode: "local", level: "read", status: 200, ok: true, blockedByGrant: false, refusal: null, engine: "local", model: "sonnet", ms: 3900, summary: `Draft for ${t.id}${instr ? ", rewritten" : ""}`, note: null });
        emit({ type: "draft", threadId: t.id, draftId: s.draft.id });
        return json(s.draft);
      }
      return error(404, "not_found", `No route ${path}`);
    }
    case "drafts": {
      const entry = [...state.threads.entries()].find(([, s]) => s.draft?.id === id3);
      if (!entry) return error(404, "draft_not_found", "No such draft");
      const [tid, s] = entry;
      const t = D.threads.find((x) => x.id === tid)!;
      const d = s.draft!;
      if (method === "PUT") { s.draft = { ...d, body: (body as { body: string }).body, status: "edited", updatedAt: new Date().toISOString() }; return json(s.draft); }
      if (sub4 === "save") {
        s.draft = { ...d, status: "saved", updatedAt: new Date().toISOString() };
        addLedger({ platform: "gmail", action: "gmail.create-draft", method: "POST", path: "/v1/gmail/create-draft", mode: "fixture", level: "write", status: 200, ok: true, blockedByGrant: false, refusal: null, engine: null, model: null, ms: 210, summary: `Draft to ${d.to.join(", ")}`, note: null });
        return json(s.draft);
      }
      if (sub4 === "send") {
        await sleep(250);
        s.draft = { ...d, status: "sent", updatedAt: new Date().toISOString() };
        s.done = true;
        addLedger({ platform: "gmail", action: "gmail.send-email", method: "POST", path: "/v1/gmail/send-email", mode: "fixture", level: "write", status: 200, ok: true, blockedByGrant: false, refusal: null, engine: null, model: null, ms: 340, summary: `Sent to ${d.to.join(", ")} · your keypress`, note: null });
        emit({ type: "judged", threadId: t.id, lane: s.lane, priority: t.priority });
        return json(s.draft);
      }
      if (sub4 === "discard") { s.draft = null; return noContent(); }
      return error(404, "not_found", `No route ${path}`);
    }
    case "goals": {
      if (method === "GET") return json(state.goals);
      if (method === "POST") {
        const g = body as GoalInput;
        const goal: ApiGoal = { id: nextId("g"), title: g.title, detail: g.detail ?? "", weight: g.weight ?? 5, paused: g.paused ?? false, position: state.goals.length, matched7d: 0 };
        state.goals.push(goal);
        return json(goal);
      }
      const goal = state.goals.find((g) => g.id === id3);
      if (!goal) return error(404, "goal_not_found", "No such goal");
      if (method === "PUT") { Object.assign(goal, body as Partial<GoalInput>); return json(goal); }
      if (method === "DELETE") { state.goals = state.goals.filter((g) => g.id !== id3); return noContent(); }
      break;
    }
    case "vips": {
      if (id3 === "suggest" && method === "POST") { await sleep(600); return json(D.vipSuggestions); }
      if (method === "GET") return json(state.vips);
      if (method === "POST") {
        const v = body as VipInput;
        const vip: ApiVip = { id: nextId("v"), name: v.name, matchKind: v.matchKind, match: v.match, tier: v.tier ?? "key", rules: v.rules ?? {}, matched7d: 0 };
        state.vips.push(vip);
        return json(vip);
      }
      const vip = state.vips.find((x) => x.id === id3);
      if (!vip) return error(404, "vip_not_found", "No such VIP");
      if (method === "PUT") { Object.assign(vip, body as Partial<VipInput>); return json(vip); }
      if (method === "DELETE") { state.vips = state.vips.filter((x) => x.id !== id3); return noContent(); }
      break;
    }
    case "onboarding": {
      const res: OnboardingSuggestions = { goals: D.goalSuggestions, vips: D.vipSuggestions };
      return json(res);
    }
    case "brief": { await sleep(300); const b: BriefResponse = D.brief(); return json(b); }
    case "ask": {
      await sleep(1100);
      const q = String((body as { q?: string })?.q ?? "");
      const hits = D.threads.filter((t) => /globex|pricing|elena|pilot/i.test(q) ? /pilot|pricing/i.test(t.subject + t.summary) : /priya|term/i.test(q) ? t.id === "t01" : t.needsReply).slice(0, 3);
      const res: AskResponse = {
        answer: hits.length
          ? `Here is what the inbox says about "${q}". ${hits.map((h) => h.summary).join(" ")}`
          : `Nothing in the last 7 days matches "${q}".`,
        citations: hits.map((h) => ({ threadId: h.id, subject: h.subject, from: h.from.name, date: h.at, quote: h.messages[h.messages.length - 1]!.body.split("\n").find((l) => l.trim().length > 30) ?? h.summary })),
        engine: "local", model: "claude-code · sonnet",
      };
      addLedger({ platform: "claude-code", action: "writer.ask", method: "LOCAL", path: "claude -p --tools \"\"", mode: "local", level: "read", status: 200, ok: true, blockedByGrant: false, refusal: null, engine: "local", model: "sonnet", ms: 2100, summary: `Ask: ${q.slice(0, 60)}`, note: null });
      return json(res);
    }
    case "access": {
      if (id3 === "receipt-demo" && method === "POST") {
        await sleep(350);
        const r = addLedger(D.receiptRow());
        return json(r);
      }
      return json(access());
    }
    case "ledger": {
      const limit = Number(url.searchParams.get("limit") ?? 100);
      return json([...state.ledger].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit));
    }
    case "sync": {
      addLedger({ platform: "gmail", action: "gmail.get-threads", method: "POST", path: "/v1/gmail/get-threads", mode: "fixture", level: "read", status: 200, ok: true, blockedByGrant: false, refusal: null, engine: null, model: null, ms: 360, summary: "0 new threads", note: null });
      emit({ type: "sync", phase: "start" });
      setTimeout(() => emit({ type: "sync", phase: "done", imported: 0 }), 1500);
      return json({ started: true });
    }
    case "events": return error(400, "use_eventsource", "Open this with EventSource");
    case "palette": {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const people = new Map<string, PaletteResponse["contacts"][number]>();
      for (const t of D.threads) {
        if (t.from.email === D.ME.email) continue;
        const vip = state.threads.get(t.id)!.vip;
        if (!q || t.from.name.toLowerCase().includes(q) || t.from.email.toLowerCase().includes(q)) {
          people.set(t.from.email, { name: t.from.name, email: t.from.email, vip: vip?.tier ?? null });
        }
      }
      const res: PaletteResponse = {
        contacts: [...people.values()].slice(0, 5),
        threads: visible(true)
          .filter((t) => !q || (t.subject + " " + t.from.name + " " + t.summary).toLowerCase().includes(q))
          .slice(0, 8)
          .map((t) => ({ threadId: t.id, subject: t.subject, from: t.from.name, lane: state.threads.get(t.id)!.lane, lastMessageAt: t.at })),
      };
      return json(res);
    }
    case "settings": {
      if (method === "PUT") {
        Object.assign(state.settings, body as Partial<ApiSettings>);
        if ((body as Partial<ApiSettings>).onboarded !== undefined) { persisted.onboarded = !!(body as Partial<ApiSettings>).onboarded; persist(); }
        return json(state.settings);
      }
      return json(state.settings);
    }
    default:
      break;
  }
  return error(404, "not_found", `No route ${method} ${path}`);
}

export function installMockServer() {
  // Dev switches: ?mock=seeded lands on a sorted, onboarded inbox; ?mock=fresh starts over.
  const sw = new URLSearchParams(window.location.search).get("mock");
  if (sw === "seeded") { Object.assign(persisted, { hasSample: true, onboarded: true, judgeStart: Date.now() - 60_000 }); state.settings.onboarded = true; persist(); }
  if (sw === "onboarding") { Object.assign(persisted, { hasSample: true, onboarded: false, judgeStart: Date.now() - 2_000 }); state.settings.onboarded = false; persist(); }
  if (sw === "fresh") { Object.assign(persisted, { hasSample: false, onboarded: false, judgeStart: null }); state.settings.onboarded = false; persist(); }
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : null;
    const urlStr = req ? req.url : String(input);
    const url = new URL(urlStr, window.location.origin);
    if (!url.pathname.startsWith("/api/")) return realFetch(input, init);
    const method = (init?.method ?? req?.method ?? "GET").toUpperCase();
    let body: unknown = undefined;
    const raw = init?.body ?? (req ? await req.text() : undefined);
    if (typeof raw === "string" && raw) { try { body = JSON.parse(raw); } catch { body = raw; } }
    await sleep(25 + Math.random() * 45);
    try {
      return await handle(method, url, body);
    } catch (e) {
      console.error("[mock]", e);
      return error(500, "mock_error", (e as Error).message);
    }
  };
  const RealES = window.EventSource;
  window.EventSource = class extends EventTarget {
    constructor(url: string | URL, init?: EventSourceInit) {
      super();
      const u = new URL(String(url), window.location.origin);
      if (/^\/api\/v1\/mailboxes\/[^/]+\/events$/.test(u.pathname)) return new MockEventSource(url) as unknown as EventSource & typeof this;
      return new RealES(url, init) as unknown as EventSource & typeof this;
    }
  } as unknown as typeof EventSource;
  console.info("[rill] mock server installed (VITE_MOCK=1)");
}
