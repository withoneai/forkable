// POST /api/v1/chat (CONTRACT 7.1): text/event-stream of ChatEvent, read with
// fetch so the request can carry a body and be aborted.
import type { ChatEvent, ChatTurnInput } from "@/contract/api-types";
import { API_BASE } from "./api";

export async function streamChat(input: ChatTurnInput, onEvent: (e: ChatEvent) => void, signal?: AbortSignal): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(input),
      credentials: "same-origin",
      signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    onEvent({ type: "error", error: { code: "internal", message: (e as Error).message } });
    onEvent({ type: "done" });
    return;
  }
  if (!res.ok || !res.body) {
    let message = res.statusText;
    let code = "internal";
    try { const j = (await res.json()) as { error?: { code: string; message: string } }; message = j.error?.message ?? message; code = j.error?.code ?? code; } catch { /* not json */ }
    onEvent({ type: "error", error: { code: code as never, message } });
    onEvent({ type: "done" });
    return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
        if (!data) continue;
        try { onEvent(JSON.parse(data) as ChatEvent); } catch { /* skip a bad frame */ }
      }
    }
  } catch (e) {
    if ((e as Error).name !== "AbortError") onEvent({ type: "error", error: { code: "internal", message: (e as Error).message } });
  }
}
