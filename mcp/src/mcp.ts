import canvasHtml from "../dist-view/canvas.html";
import { CANVAS_URI, RENDER_UI_DESCRIPTION } from "./generative.js";
import { runTool, type ToolContext } from "./tools.js";

export type McpContext = ToolContext;

// A small, stateless MCP server over Streamable HTTP: JSON-RPC in, JSON out.
// The agent writes its own UI (render_ui) and it renders in one ui://
// resource, the canvas. `run_action` is app-only: the canvas's data calls
// arrive through it.

// Chat apps cache a ui:// resource by its URI, so a view that changed under
// the same URI keeps running the old copy (a UI built on the new kit then
// failed inside the old frame). Each URI carries a hash of its HTML: a new
// build is a new URI, and hosts fetch it fresh. Old URIs still resolve.
const fnv = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
};
const CANVAS_V = CANVAS_URI.replace(".html", `-${fnv(canvasHtml)}.html`);
// The first prototype shipped a Gmail Inbox view, a show_gmail_inbox tool
// and the app-only blocks_api behind it.
// Both are gone; a host that cached them gets a short note, not an error.
const REMOVED = "This tool was removed. Ask for the UI you want and it will be built with render_ui.";
const REMOVED_HTML = `<!doctype html><meta charset="utf-8"><p style="font:14px system-ui;margin:16px">${REMOVED}</p>`;
const viewFor = (uri: string) =>
  /^ui:\/\/forkable\/canvas(-[a-z0-9]+)?\.html$/.test(uri) ? canvasHtml : /^ui:\/\/forkable\/gmail-inbox(-[a-z0-9]+)?\.html$/.test(uri) ? REMOVED_HTML : null;
const UI_MIME = "text/html;profile=mcp-app";
const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];

// No outside network for our views: data only through tools.
const CSP = { connectDomains: [] as string[], resourceDomains: [] as string[] };
const CANVAS_META = {
  ui: { resourceUri: CANVAS_V, visibility: ["model", "app"] },
  "ui/resourceUri": CANVAS_V,
  "openai/outputTemplate": CANVAS_V,
};

// What every chat app hands its model with this server. The One MCP is the
// deeper source of action knowledge; this server works without it.
const INSTRUCTIONS = `Forkable blocks shows the user's own tools as live UI in the chat and saves each UI to their account (blocks.forkable.dev). Everything runs on the user's One sign-in; writes always wait for the user's confirmation.

To learn actions: if the One MCP is connected here (find_one_actions), use it; it has the deepest docs and the same action ids render_ui takes. Otherwise use list_connections, find_actions and action_docs. If it is not connected, tell the user once, in one short sentence, that adding One's MCP (https://mcp.withone.ai/mcp, same sign-in) helps you build better UIs and do work outside them.

Call ui_guide before writing your first UI in a chat.`

type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: any };

const TOOLS = [
  {
    name: "list_connections",
    title: "List connections",
    description: "Lists the platforms the user's One grant reaches and the access on each.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: "find_actions",
    title: "Find One actions",
    description: "Searches One's catalog for actions on a platform that fit an intent, best first: ids, titles, methods, paths. Prefer the One MCP's find_one_actions when connected.",
    inputSchema: {
      type: "object",
      properties: { platform: { type: "string", description: "Platform key, for example gmail, google-calendar, stripe, hubspot." }, query: { type: "string", description: "What the UI needs, in words." } },
      required: ["platform", "query"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "action_docs",
    title: "Read action docs",
    description: "One's docs for one action: every input field and what it returns. Read before calling it from a UI.",
    inputSchema: { type: "object", properties: { actionId: { type: "string" } }, required: ["actionId"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "ui_guide",
    title: "UI guide",
    description: "The component kit, style rules and a full example for render_ui. Read once per chat before your first UI.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: "render_ui",
    title: "Render a UI",
    description: RENDER_UI_DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short, recognisable later." },
        description: { type: "string", description: "One line." },
        code: { type: "string", description: "The TSX module." },
        actions: {
          type: "array",
          description: "Every One action the UI calls.",
          items: { type: "object", properties: { platform: { type: "string" }, actionId: { type: "string" } }, required: ["actionId"] },
        },
        temporary: { type: "boolean", description: "True for a throwaway render. Saved by default." },
      },
      required: ["title", "code", "actions"],
    },
    _meta: CANVAS_META,
  },
  {
    name: "update_ui",
    title: "Update a saved UI",
    description: "Saves and shows a new version of a saved UI. Earlier versions stay. Same rules as render_ui.",
    inputSchema: {
      type: "object",
      properties: {
        uiId: { type: "string" },
        code: { type: "string" },
        actions: { type: "array", items: { type: "object", properties: { platform: { type: "string" }, actionId: { type: "string" } }, required: ["actionId"] } },
        title: { type: "string" },
        description: { type: "string" },
      },
      required: ["uiId", "code", "actions"],
    },
    _meta: CANVAS_META,
  },
  {
    name: "list_my_uis",
    title: "List my saved UIs",
    description: "Lists the user's saved UIs, newest first. Use when they mention something built before, then show_ui.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Words to match." } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: "show_ui",
    title: "Show a saved UI",
    description: "Opens a saved UI in the chat, live. Latest version unless one is given.",
    inputSchema: { type: "object", properties: { uiId: { type: "string" }, version: { type: "number" } }, required: ["uiId"] },
    annotations: { readOnlyHint: true },
    _meta: CANVAS_META,
  },
  {
    name: "rename_ui",
    title: "Rename a saved UI",
    description: "Changes a saved UI's title and description.",
    inputSchema: { type: "object", properties: { uiId: { type: "string" }, title: { type: "string" }, description: { type: "string" } }, required: ["uiId", "title"] },
  },
  {
    name: "delete_ui",
    title: "Delete a saved UI",
    description: "Removes a saved UI. Only when the user asks.",
    inputSchema: { type: "object", properties: { uiId: { type: "string" } }, required: ["uiId"] },
    annotations: { destructiveHint: true },
  },
  {
    name: "run_action",
    title: "Run a declared action",
    description: "For rendered UIs only. Not for the model.",
    inputSchema: {
      type: "object",
      properties: { renderId: { type: "string" }, actionId: { type: "string" }, input: { type: "object" }, confirmToken: { type: "string" } },
      required: ["renderId", "actionId"],
    },
    _meta: { ui: { visibility: ["app"] } },
  },
];

export async function handleMcp(req: Request, ctx: McpContext): Promise<Response> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { allow: "POST" } });
  let payload: Rpc | Rpc[];
  try {
    payload = await req.json();
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  }
  const batch = Array.isArray(payload) ? payload : [payload];
  const replies = (await Promise.all(batch.map((m) => dispatch(m, ctx)))).filter((r) => r !== null);
  if (replies.length === 0) return new Response(null, { status: 202 });
  return json(Array.isArray(payload) ? replies : replies[0]);
}

async function dispatch(m: Rpc, ctx: McpContext) {
  if (m.id === undefined || m.id === null) return null; // notifications
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id: m.id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id: m.id, error: { code, message } });
  try {
    switch (m.method) {
      case "initialize": {
        const asked = m.params?.protocolVersion;
        return ok({
          protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[1],
          capabilities: { tools: {}, resources: {} },
          serverInfo: {
            name: "forkable-blocks",
            title: "Forkable blocks",
            version: "0.1.0",
            websiteUrl: ctx.publicUrl,
            icons: [
              { src: `${ctx.publicUrl}/icon.svg`, mimeType: "image/svg+xml", sizes: ["any"] },
              { src: `${ctx.publicUrl}/icon-512.png`, mimeType: "image/png", sizes: ["512x512"] },
              { src: `${ctx.publicUrl}/icon-180.png`, mimeType: "image/png", sizes: ["180x180"] },
            ],
          },
          instructions: INSTRUCTIONS,
        });
      }
      case "ping":
        return ok({});
      case "tools/list":
        return ok({ tools: TOOLS });
      case "resources/list":
        return ok({
          resources: [
            { uri: CANVAS_V, name: "Canvas for UIs the agent writes", mimeType: UI_MIME },
          ],
        });
      case "resources/templates/list":
        return ok({ resourceTemplates: [] });
      case "resources/read": {
        const uri = m.params?.uri;
        const text = typeof uri === "string" ? viewFor(uri) : null;
        if (!text) return fail(-32002, "Resource not found");
        return ok({
          contents: [
            {
              uri,
              mimeType: UI_MIME,
              text,
              _meta: { ui: { prefersBorder: true, csp: CSP }, "openai/widgetCSP": { connect_domains: [], resource_domains: [] } },
            },
          ],
        });
      }
      case "tools/call":
        return ok(await callTool(m.params?.name, m.params?.arguments ?? {}, ctx));
      default:
        return fail(-32601, `Method not found: ${m.method}`);
    }
  } catch (e) {
    return fail(-32603, String((e as Error)?.message ?? e));
  }
}

async function callTool(name: string, args: any, ctx: McpContext) {
  if (name === "show_gmail_inbox" || name === "blocks_api") return { content: [{ type: "text", text: REMOVED }] };
  return runTool(name, args, ctx);
}

const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } });
