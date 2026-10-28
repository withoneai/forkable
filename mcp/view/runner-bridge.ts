// Inside the sandboxed frame that runs the agent's code. It has no host
// bridge, no session and no network: it can only ask the shell (its parent)
// to call a tool, and the shell decides. Confirmation of writes happens in
// the shell, where this frame's code cannot reach.

type Pending = { resolve: (v: any) => void };
const pending = new Map<number, Pending>();
let seq = 0;

export function post(msg: Record<string, unknown>) {
  parent.postMessage({ fb: 1, ...msg }, "*");
}

export function callTool(name: "run_action", args: Record<string, unknown>): Promise<any> {
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, { resolve });
    post({ type: "call", id, name, args });
  });
}

export function onShellMessage(handler: (msg: any) => void) {
  window.addEventListener("message", (e) => {
    if (e.source !== parent || !e.data || e.data.fb !== 1) return;
    if (e.data.type === "result") {
      pending.get(e.data.id)?.resolve(e.data.result);
      pending.delete(e.data.id);
      return;
    }
    handler(e.data);
  });
}
