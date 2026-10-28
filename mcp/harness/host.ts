import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";

// A minimal MCP Apps host, to check views render and their tool calls work
// before trying a real chat app. Talks to the local Worker's /mcp directly.
// window.__start(name, args) runs any UI tool (render_ui, show_ui, ...).
const params = new URLSearchParams(location.search);
const MCP = params.get("mcp") ?? "/mcp";
const theme = (params.get("theme") ?? "dark") as "dark" | "light";
const log = (s: string) => ((document.getElementById("log")!.textContent = s), console.log(s));
const w = window as any;
let n = 0;
async function rpc(method: string, p?: unknown) {
  const r = await fetch(MCP, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method, params: p }) });
  const j: any = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}
const tools = (await rpc("tools/list")).tools;
w.__rpc = rpc;

async function start(name: string, args: Record<string, unknown>) {
  const tool = tools.find((t: any) => t.name === name);
  const html = (await rpc("resources/read", { uri: tool._meta.ui.resourceUri })).contents[0].text;
  const result = await rpc("tools/call", { name, arguments: args });
  w.__result = result;
  w.__calls = [];
  w.__ready = false;
  w.__context = undefined;
  const old = document.getElementById("f");
  const iframe = document.createElement("iframe");
  iframe.id = "f";
  iframe.setAttribute("sandbox", "allow-scripts");
  old ? old.replaceWith(iframe) : document.body.appendChild(iframe);
  const bridge = new AppBridge(null, { name: "test-host", version: "0" }, { serverTools: {}, updateModelContext: { text: {} }, openLinks: {}, message: { text: {} } }, { hostContext: { theme } });
  bridge.oncalltool = async (p) => {
    const t = tools.find((x: any) => x.name === p.name);
    if (!t?._meta?.ui?.visibility?.includes("app")) throw new Error("not callable by the app");
    w.__calls.push(`${p.name} ${JSON.stringify(p.arguments).slice(0, 600)}`);
    return rpc("tools/call", p);
  };
  bridge.onupdatemodelcontext = async (p: any) => ((w.__context = p), {});
  bridge.onmessage = async (p: any) => ((w.__message = p), {});
  bridge.oninitialized = () => {
    bridge.sendToolInput({ arguments: args });
    bridge.sendToolResult(result);
    log(`${name} initialized`);
    w.__ready = true;
  };
  iframe.srcdoc = html;
  await new Promise((r) => (iframe.onload = r));
  await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!));
}
w.__start = start;
