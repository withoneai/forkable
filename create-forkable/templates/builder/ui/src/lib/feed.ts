// Fold a turn's event rows into what the chat renders.
import type { TurnEventRow, Usage } from "@builder/core/types";
import type { ToolKind } from "@builder/harness/types";
import { describeTool, type Described } from "./describe";

export interface ToolItem {
  type: "tool";
  id: string;
  name: string;
  kind: ToolKind;
  detail?: string;
  files?: string[];
  ok: boolean | null; // null while running
  preview?: string;
  d: Described;
  at: string;
}

export type FeedItem =
  | { type: "text"; id: string; text: string; streaming: boolean }
  | { type: "thinking"; id: string; ms: number; text: string; live: boolean }
  | ToolItem
  | { type: "reads"; id: string; tools: ToolItem[] }
  | { type: "denied"; id: string; tool: string; reason?: string }
  | { type: "note"; id: string; text: string; tone: "info" | "warn" | "error" };

export interface Folded {
  items: FeedItem[];
  usage: Usage | null;
  checkpoint: { sha: string; subject: string; additions: number; deletions: number; files: number } | null;
  fixPlan: { errors: number; attempt: number; max: number } | null;
  step: string | null;
  mcpFailed: string | null;
  sessionId: string | null;
  /** The code calls platforms and the app has no One Connect yet ("This app uses Gmail. Turn on One Connect for it?"), and the answer. */
  connectOffer: { platforms: { platform: string; name: string }[]; answer: "on" | "later" | null } | null;
  /** "Gmail · send (write)" lines when this version asks for more. */
  asksMore: string[];
  /** Messages sent while the turn ran, and whether the agent has read them. */
  steers: { text: string; read: boolean }[];
  /** Owner-run actions the builder has not allowed for visitors (the Allow card), and their answer. */
  visitors: { actions: { actionId: string; line: string }[]; answer: "allow" | "keep" | null } | null;
  /** Environment names the code reads with no value yet (the "This app needs X" card). */
  envNeeded: { name: string; why: string | null; sites: { file: string; line: number }[] }[];
}

export function fold(rows: TurnEventRow[] | undefined, live: boolean): Folded {
  const items: FeedItem[] = [];
  const tools = new Map<string, ToolItem>();
  let usage: Usage | null = null;
  let checkpoint: Folded["checkpoint"] = null;
  let fixPlan: Folded["fixPlan"] = null;
  let step: string | null = null;
  let mcpFailed: string | null = null;
  let sessionId: string | null = null;
  let connectOffer: Folded["connectOffer"] = null;
  let asksMore: string[] = [];
  const steers: { text: string; read: boolean }[] = [];
  let visitors: Folded["visitors"] = null;
  let envNeeded: Folded["envNeeded"] = [];
  let text: { type: "text"; id: string; text: string; streaming: boolean } | null = null;
  let think: { type: "thinking"; id: string; ms: number; text: string; live: boolean; start: number } | null = null;

  const closeThinking = (at: string) => {
    if (think) {
      think.ms = Math.max(0, new Date(at).getTime() - think.start);
      think.live = false;
      think = null;
    }
  };

  for (const r of rows ?? []) {
    const e = r.event;
    if (e.t !== "thinking") closeThinking(r.at);
    if (e.t !== "text_delta" && e.t !== "text" && e.t !== "usage" && e.t !== "session" && text) {
      text.streaming = false;
      text = null;
    }
    switch (e.t) {
      case "session": sessionId = e.id; break;
      case "text_delta":
        if (!text) { text = { type: "text", id: `x${r.seq}`, text: "", streaming: true }; items.push(text); }
        text.text += e.text;
        break;
      case "text":
        if (text) { text.text = e.text; text.streaming = false; text = null; }
        else items.push({ type: "text", id: `x${r.seq}`, text: e.text, streaming: false });
        break;
      case "thinking":
        if (!think) {
          const t = { type: "thinking" as const, id: `h${r.seq}`, ms: 0, text: "", live: true, start: new Date(r.at).getTime() };
          think = t;
          items.push(t);
        }
        think.text = e.delta ? think.text + e.text : e.text || think.text;
        break;
      case "tool_start": {
        const t: ToolItem = { type: "tool", id: e.id, name: e.name, kind: e.kind, detail: e.detail, files: e.files, ok: null, d: describeTool({ ...e, input: (e as { input?: Record<string, unknown> }).input }), at: r.at };
        tools.set(e.id, t);
        items.push(t);
        break;
      }
      case "tool_end": {
        const t = tools.get(e.id);
        if (t) { t.ok = e.ok; t.preview = e.preview; }
        break;
      }
      case "denied": items.push({ type: "denied", id: `d${r.seq}`, tool: e.tool, reason: e.reason }); break;
      case "usage": usage = e.total || !usage ? e.usage : addUsage(usage, e.usage); break;
      case "limit": items.push({ type: "note", id: `l${r.seq}`, tone: "warn", text: e.resetsAt ? `Your plan's usage limit was reached. It resets ${new Date(e.resetsAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}.` : "Your plan's usage limit was reached." }); break;
      case "retry": items.push({ type: "note", id: `r${r.seq}`, tone: "info", text: `The model was busy, trying again (attempt ${e.attempt}).` }); break;
      case "mcp": if (e.status === "failed") mcpFailed = e.error ?? "The catalog tool did not start."; break;
      case "error": items.push({ type: "note", id: `e${r.seq}`, tone: "error", text: e.message }); break;
      case "step": step = e.step; break;
      case "note": items.push({ type: "note", id: `n${r.seq}`, tone: e.tone ?? "info", text: e.text }); break;
      case "checkpoint": checkpoint = { sha: e.sha, subject: e.subject, additions: e.additions, deletions: e.deletions, files: e.files }; break;
      case "fix_plan": fixPlan = { errors: e.errors, attempt: e.attempt, max: e.max }; break;
      // connect_needed: old feeds from the builder-level grant, nothing to offer now.
      case "connect_offer": connectOffer = { platforms: e.platforms, answer: null }; break;
      case "connect_answer": if (connectOffer) connectOffer.answer = e.choice; break;
      case "asks_more": asksMore = e.lines; break;
      case "steer": steers.push({ text: e.text, read: false }); break;
      case "steer_read": for (const x of steers) x.read = true; break;
      case "visitors_needed": visitors = { actions: e.actions, answer: null }; break;
      case "visitors_answer": if (visitors) visitors.answer = e.choice; break;
      case "env_needed": envNeeded = e.vars; break;
      default: break;
    }
  }
  if (!live) {
    if (text) text.streaming = false;
    if (think) think.live = false;
    for (const t of tools.values()) if (t.ok === null) t.ok = true;
  }
  return { items: coalesce(items), usage, checkpoint, fixPlan, step, mcpFailed, sessionId, connectOffer, asksMore, steers, visitors, envNeeded };
}

/** Consecutive quiet, finished reads become one row ("Read 4 files"). */
function coalesce(items: FeedItem[]): FeedItem[] {
  const out: FeedItem[] = [];
  let run: ToolItem[] = [];
  const flush = () => {
    if (run.length >= 2) out.push({ type: "reads", id: `g${run[0]!.id}`, tools: run });
    else out.push(...run);
    run = [];
  };
  for (const it of items) {
    if (it.type === "tool" && it.d.salience === "quiet" && it.ok !== null) { run.push(it); continue; }
    flush();
    out.push(it);
  }
  flush();
  return out;
}

export function addUsage(a: Usage, b: Usage): Usage {
  return { input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite };
}

export const totalTokens = (u: Usage | null | undefined) => (u ? u.input + u.output + u.cacheRead + u.cacheWrite : 0);

/** "Read 3 files, searched twice" */
export function readsSummary(tools: ToolItem[]): string {
  const reads = tools.filter((t) => t.d.icon === "read").length;
  const searches = tools.filter((t) => t.d.icon === "search").length;
  const other = tools.length - reads - searches;
  const parts: string[] = [];
  if (reads) parts.push(`Read ${reads} ${reads === 1 ? "file" : "files"}`);
  if (searches) parts.push(`${parts.length ? "searched" : "Searched"} ${searches === 1 ? "once" : searches === 2 ? "twice" : `${searches} times`}`);
  if (other) parts.push(`${parts.length ? "looked" : "Looked"} at ${other} more`);
  return parts.join(", ");
}
