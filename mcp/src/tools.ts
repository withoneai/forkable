import type { OneConnectClient } from "@withone/connect/server";
import { actionDocs, compile, findActions, issueConfirm, redeemConfirm, resolveActions, runDeclared, summarize, type ActionInput } from "./generative.js";
import { GUIDE } from "./guide.js";
import { styleNote } from "./stylecheck.js";
import { addVersion, createUi, deleteUi, listUis, loadRender, renameUi, renderById, type Render } from "./store.js";

// Every tool's behaviour, shared by the MCP server (chat apps) and the web
// app at blocks.forkable.dev. Who is calling is always `userId`, the
// person's One id; nothing here trusts an id sent by the client.

export interface ToolContext {
  userId: string;
  connect: OneConnectClient | null;
  kv: KVNamespace;
  db: D1Database;
  publicUrl: string;
}

export type ToolResult = { content: { type: "text"; text: string }[]; structuredContent?: unknown; isError?: boolean };
const text = (t: string, extra: Partial<ToolResult> = {}): ToolResult => ({ content: [{ type: "text", text: t }], ...extra });

/** What the canvas needs to run a saved version. */
export function renderPayload(r: Render, publicUrl: string) {
  return {
    renderId: r.renderId,
    uiId: r.uiId,
    version: r.version,
    title: r.title,
    js: r.js,
    saved: r.saved,
    url: r.saved ? `${publicUrl}/u/${r.uiId}` : null,
    actions: r.actions.map((a) => ({ actionId: a.actionId, title: a.title, platform: a.platform, write: a.write })),
  };
}

const describeActions = (r: Render) =>
  r.actions.length ? r.actions.map((a) => `${a.title} (${a.platform}, ${a.write ? "write, confirmed by the person each time" : "read"})`).join("; ") : "no actions";

export async function runTool(name: string, args: any, ctx: ToolContext): Promise<ToolResult> {
  const { userId, connect, db, publicUrl } = ctx;
  try {
    switch (name) {
      case "ui_guide":
        return text(GUIDE);
      case "list_connections": {
        if (!connect) return text("Sample mode, not signed in: only gmail (the Acme Inc sample).", { structuredContent: { connections: [{ platform: "gmail", access: "read" }] } });
        const conns = await connect.listConnections(userId);
        const rows = conns.map((c) => ({ platform: c.platform, title: c.title ?? c.name, access: c.access }));
        return text(JSON.stringify(rows), { structuredContent: { connections: rows } });
      }
      case "find_actions": {
        const found = await findActions(connect, userId, String(args.platform ?? ""), String(args.query ?? ""));
        return text(found.map((a) => `${a._id}  ${a.method} ${a.path}  ${a.title}`).join("\n") || "Nothing found.");
      }
      case "action_docs": {
        const k = await actionDocs(connect, userId, String(args.actionId ?? ""));
        return text(`${k.title}\n${k.method} ${k.path}\n\n${k.knowledge}`.slice(0, 20000));
      }
      case "render_ui":
      case "update_ui": {
        const code = String(args.code ?? "");
        const built = compile(code);
        if ("error" in built) return text(`The code did not compile: ${built.error}`, { isError: true });
        const actions = await resolveActions(connect, userId, Array.isArray(args.actions) ? args.actions : []);
        const title = String(args.title ?? "").trim();
        const description = typeof args.description === "string" ? args.description : undefined;
        let r: Render | null;
        if (name === "update_ui") {
          r = await addVersion(db, userId, String(args.uiId ?? ""), { source: code, js: built.js, actions, title, description });
          if (!r) return text("No saved UI with that id. Call list_my_uis.", { isError: true });
        } else {
          r = await createUi(db, { owner: userId, title: title || "Untitled UI", description: description ?? "", source: code, js: built.js, actions, saved: args.temporary !== true });
        }
        const where = r.saved ? ` Saved as ${r.uiId} version ${r.version}; the user can open it again in any chat or at ${publicUrl}/u/${r.uiId}.` : " Not saved (temporary).";
        return text(`Rendered "${r.title}". It may run: ${describeActions(r)}.${where}${styleNote(code)}`, { structuredContent: renderPayload(r, publicUrl) });
      }
      case "show_ui": {
        const r = await loadRender(db, userId, String(args.uiId ?? ""), args.version ? Number(args.version) : undefined);
        if (!r) return text("No saved UI with that id. Call list_my_uis.", { isError: true });
        return text(`Showing "${r.title}" version ${r.version}. It may run: ${describeActions(r)}.`, { structuredContent: renderPayload(r, publicUrl) });
      }
      case "list_my_uis": {
        const rows = await listUis(db, userId, String(args.query ?? ""));
        const lines = rows.map((u) => `${u.id}  "${u.title}" v${u.current_version}, updated ${new Date(u.updated_at).toISOString().slice(0, 10)}${u.description ? ` — ${u.description}` : ""}`);
        return text(lines.join("\n") || "No saved UIs yet.", { structuredContent: { uis: rows.map(({ actions, ...u }) => ({ ...u, actions: actions.map((a) => a.title) })) } });
      }
      case "rename_ui": {
        const ok = await renameUi(db, userId, String(args.uiId ?? ""), String(args.title ?? "").trim() || "Untitled UI", typeof args.description === "string" ? args.description : undefined);
        return text(ok ? "Renamed." : "No saved UI with that id.", { isError: !ok });
      }
      case "delete_ui": {
        const ok = await deleteUi(db, userId, String(args.uiId ?? ""));
        return text(ok ? "Deleted." : "No saved UI with that id.", { isError: !ok });
      }
      case "run_action":
        return runAction(args, ctx);
    }
  } catch (e) {
    return text(String((e as Error)?.message ?? e), { isError: true });
  }
  return text(`Unknown tool ${name}`, { isError: true });
}

// Never isError on run_action: some hosts turn it into an exception and drop
// structuredContent, so the UI would lose the reason. The canvas reads status.
async function runAction(args: any, ctx: ToolContext): Promise<ToolResult> {
  const { userId, connect, kv, db } = ctx;
  const renderId = String(args.renderId ?? "");
  const actionId = String(args.actionId ?? "");
  const input = (args.input ?? {}) as ActionInput;
  const done = (out: Record<string, unknown> & { status: number }) => {
    // Which action and why, never the data or the input.
    console.log("run_action", { actionId, status: out.status, refused: out.refused ?? null });
    return text(out.status >= 400 ? `HTTP ${out.status}: ${String(out.message ?? "")}` : `HTTP ${out.status}`, { structuredContent: out });
  };
  const render = await renderById(db, userId, renderId);
  if (!render) return done({ status: 404, refused: "unknown_render", message: "This UI is gone. Ask for it again." });
  const action = render.actions.find((a) => a.actionId === actionId);
  if (!action) return done({ status: 403, refused: "not_declared", message: `This UI did not declare ${actionId}. Add it to the actions and render again.` });
  if (action.write) {
    if (!args.confirmToken) {
      const token = await issueConfirm(kv, userId, renderId, actionId, input);
      return done({ status: 428, refused: "confirm_required", message: "Waiting for the person to confirm.", confirm: { token, ...summarize(action, input) } });
    }
    if (!(await redeemConfirm(kv, String(args.confirmToken), userId, renderId, actionId, input))) {
      return done({ status: 409, refused: "confirm_expired", message: "That confirmation expired or did not match. Try again." });
    }
  }
  return done(await runDeclared(connect, userId, action, input));
}
