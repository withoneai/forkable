import { transform } from "sucrase";
import type { OneConnectClient, PlatformAction } from "@withone/connect/server";
import { GMAIL } from "./sample/actions.js";
import { sampleThreads } from "./sample/sample.js";
import { toSummary } from "./sample/map.js";

// The agent builds its own UI. It reads One's catalog through the user's
// grant (find_actions, action_docs), writes a React component, and calls
// render_ui with the code and the One actions the UI may run. The Worker
// compiles it, saves it, and the canvas runs it in the chat. The UI's data
// calls go through run_action, which refuses anything the render did not
// declare, and holds every write until the person confirms it in a dialog
// the UI's own code cannot reach. The grant still decides the rest.

export const CANVAS_URI = "ui://forkable/canvas.html";

export interface DeclaredAction {
  platform: string;
  actionId: string;
  title: string;
  method: string;
  path: string;
  /** Anything that changes data, sends, pays or deletes. Unknown counts as a write. */
  write: boolean;
}

export type ActionInput = {
  query?: Record<string, string>;
  body?: unknown;
  pathParams?: Record<string, string | number | boolean>;
  headers?: Record<string, string>;
};

const KNOWN: Record<string, Omit<DeclaredAction, "write">> = Object.fromEntries(
  Object.entries(GMAIL).map(([, a]) => [a.actionId, { platform: a.platform, actionId: a.actionId, title: titleOf(a.path), method: a.method, path: a.path }]),
);
function titleOf(path: string) {
  const last = path.split("/").filter((s) => s && !s.startsWith("{{")).pop() ?? path;
  return last.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** Reads that use POST. One's own helpers and search endpoints, by id. */
const READ_POSTS = new Set<string>([GMAIL.getThreads.actionId]);
const READ_TITLE = /^(get|list|search|find|query|retrieve|lookup|look up|fetch|read|count|check|preview|describe)\b/i;

export function isWrite(a: { actionId: string; method: string; title: string }): boolean {
  const m = a.method.toUpperCase();
  if (m === "GET" || m === "HEAD") return false;
  if (READ_POSTS.has(a.actionId)) return false;
  if (m === "POST" && READ_TITLE.test(a.title.trim())) return false;
  return true;
}

export const RENDER_UI_DESCRIPTION = `Renders a React component you write as a live UI in the chat, on the user's own One grant, and saves it to their account (reopen later with list_my_uis and show_ui, or at blocks.forkable.dev). Call ui_guide before your first UI in a chat: it has the component kit, the style rules and a full example.

Before calling, learn each action's input and output (find_one_actions from the One MCP if connected, else find_actions and action_docs). Declare every action the UI calls in "actions"; nothing else can run. Declare only what it needs.

Writes (send, create, update, delete, pay) wait for the person's Confirm in a dialog the UI cannot reach; say so in the UI.

Code: one TSX module with a default-exported component, no network. Imports: react, @forkable/ui, lucide-react, clsx. Style issues and runtime errors come back to you; fix them with update_ui.`;

export function compile(code: string): { js: string } | { error: string } {
  // The ready-made blocks left the canvas: all data goes through run_action.
  if (/from\s*["']@forkable\/blocks["']|require\(\s*["']@forkable\/blocks["']\s*\)/.test(code)) {
    return { error: `"@forkable/blocks" is not available. Build the UI with @forkable/ui and load data with useAction/runAction (run_action) on declared actions; see ui_guide.` };
  }
  try {
    const out = transform(code, { transforms: ["typescript", "jsx", "imports"], jsxRuntime: "automatic", production: true, filePath: "ui.tsx" });
    return { js: out.code };
  } catch (e) {
    return { error: String((e as Error).message ?? e) };
  }
}

export async function findActions(connect: OneConnectClient | null, userId: string, platform: string, query: string): Promise<PlatformAction[]> {
  if (!connect) return Object.values(KNOWN).filter((a) => a.platform === platform).map((a) => ({ _id: a.actionId, title: a.title, method: a.method, path: a.path }));
  return connect.searchActions(userId, platform, query, { limit: 8 });
}

export async function actionDocs(connect: OneConnectClient | null, userId: string, actionId: string) {
  if (!connect) {
    const a = KNOWN[actionId];
    if (!a) throw new Error("Unknown action in sample mode.");
    return {
      ...a,
      knowledge:
        "Sample mode: the Acme Inc sample. get-threads takes body { query, numberOfThreads } and answers { threads: [{ id, subject, from: { name, email }, snippet, date, unread, starred, count }] }. create-draft and send-email take body { to, subject, body } and answer { id } in the sample.",
    };
  }
  return connect.getActionKnowledge(userId, actionId);
}

/** Resolves the declared actions to their method, path and read/write, once, at render time. */
export async function resolveActions(connect: OneConnectClient | null, userId: string, declared: { platform?: string; actionId: string }[]): Promise<DeclaredAction[]> {
  const out: DeclaredAction[] = [];
  for (const d of declared.slice(0, 20)) {
    if (!connect) {
      const a = KNOWN[d.actionId];
      if (!a) throw new Error(`Unknown action ${d.actionId} in sample mode.`);
      out.push({ ...a, write: isWrite(a) });
      continue;
    }
    const k = await connect.getActionKnowledge(userId, d.actionId);
    const a = { platform: k.platform ?? d.platform ?? "", actionId: d.actionId, title: k.title, method: k.method, path: k.path };
    out.push({ ...a, write: isWrite(a) });
  }
  return out;
}

// ---- Confirming writes -------------------------------------------------

/** What the person sees before a write runs. Written here, never by the UI. */
export function summarize(action: DeclaredAction, input: ActionInput): { headline: string; fields: { label: string; value: string }[] } {
  const body = input.body && typeof input.body === "object" ? (input.body as Record<string, unknown>) : {};
  const show = (v: unknown) => {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return s.length > 280 ? `${s.slice(0, 280)}…` : s;
  };
  const platform = action.platform.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  const fields: { label: string; value: string }[] = [];
  const pick = (label: string, ...keys: string[]) => {
    for (const k of keys) if (body[k] !== undefined && body[k] !== "") return void fields.push({ label, value: show(body[k]) });
  };
  if (action.platform === "gmail" && /send|draft/i.test(action.title + action.path)) {
    pick("To", "to", "recipient", "recipients");
    pick("Cc", "cc");
    pick("Bcc", "bcc");
    pick("Subject", "subject");
    pick("Message", "body", "text", "message", "html");
  }
  if (fields.length === 0) {
    for (const [k, v] of Object.entries({ ...input.pathParams, ...input.query, ...body })) {
      if (k === "connectionKey" || fields.length >= 8) continue;
      fields.push({ label: k, value: show(v) });
    }
  }
  const verb = /send/i.test(action.title + action.path) ? "Send" : /delete|remove|trash/i.test(action.title + action.path) ? "Delete" : "Run";
  return { headline: `${verb} with ${platform}: ${action.title}`, fields };
}

async function hashInput(actionId: string, input: ActionInput) {
  const data = new TextEncoder().encode(JSON.stringify([actionId, input.query ?? null, input.body ?? null, input.pathParams ?? null, input.headers ?? null]));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A one-time token for exactly this user, render, action and input. Two minutes. */
export async function issueConfirm(kv: KVNamespace, userId: string, renderId: string, actionId: string, input: ActionInput) {
  const token = crypto.randomUUID();
  await kv.put(`confirm:${token}`, JSON.stringify({ userId, renderId, hash: await hashInput(actionId, input) }), { expirationTtl: 120 });
  return token;
}

export async function redeemConfirm(kv: KVNamespace, token: string, userId: string, renderId: string, actionId: string, input: ActionInput) {
  const raw = await kv.get(`confirm:${token}`);
  if (!raw) return false;
  await kv.delete(`confirm:${token}`);
  const t = JSON.parse(raw) as { userId: string; renderId: string; hash: string };
  return t.userId === userId && t.renderId === renderId && t.hash === (await hashInput(actionId, input));
}

// ---- Running ----------------------------------------------------------

export async function runDeclared(connect: OneConnectClient | null, userId: string, action: DeclaredAction, input: ActionInput) {
  if (!connect) {
    if (action.actionId === GMAIL.getThreads.actionId) {
      const n = Number((input.body as { numberOfThreads?: number })?.numberOfThreads ?? 10);
      return { status: 200, mode: "sample", data: { threads: sampleThreads().slice(0, n).map(toSummary) }, refused: null };
    }
    if (action.actionId === GMAIL.createDraft.actionId || action.actionId === GMAIL.sendEmail.actionId) {
      return { status: 200, mode: "sample", data: { id: `sample-${crypto.randomUUID().slice(0, 8)}`, sample: true }, refused: null };
    }
    return { status: 401, refused: "not_connected", message: "Sign in with One to run this." };
  }
  const conns = await connect.listConnections(userId);
  const conn = conns.find((c) => c.platform === action.platform);
  if (!conn) return { status: 401, refused: "not_connected", message: `${action.platform} is not in your grant.` };
  // One's own helpers (paths under /v1/) take the connection key in the body.
  // Ours goes last: a key the UI's code made up never reaches One.
  const asObject = input.body && typeof input.body === "object" ? { ...(input.body as Record<string, unknown>) } : null;
  if (asObject) delete asObject.connectionKey;
  const body = action.path.startsWith("/v1/") && asObject ? { ...asObject, connectionKey: conn.key } : (asObject ?? input.body);
  const res = await connect.runAction(userId, {
    connectionKey: conn.key,
    actionId: action.actionId,
    method: action.method,
    path: action.path,
    pathParams: input.pathParams,
    query: input.query,
    headers: input.headers,
    body,
  });
  if (res.blockedByGrant || res.refusal === "grant") {
    return {
      status: 403,
      refused: "outside_grant",
      message: `"${action.title}" on ${action.platform} is outside your grant. Ask the app's owner to add it to the permission set, then sign in again.`,
    };
  }
  if (res.refusal) return { status: res.status, refused: res.refusal, message: `One declined the call (${res.refusal}).` };
  if (!res.ok) {
    const detail = typeof res.data === "string" ? res.data : JSON.stringify(res.data ?? "");
    return { status: res.status, refused: null, message: `${action.platform} answered ${res.status}: ${detail.slice(0, 300)}` };
  }
  return { status: res.status, mode: "grant", data: res.data, refused: null };
}
