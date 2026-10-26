// Streams a chat reply over POST + SSE. EventSource cannot carry a POST body,
// so this reads the fetch response body itself and splits it on blank lines
// the way the server's `hono/streaming` writes frames.
import type { ChatContextInput, ChatStreamEvent } from "@rill/core/api-types";
import { API_BASE } from "./api";

export interface ChatMessageBody {
  content: string;
  context?: ChatContextInput;
  engine?: { engine: string; provider: string; model: string };
}

export async function streamChatMessage(
  mailboxId: string,
  chatId: string,
  body: ChatMessageBody,
  onEvent: (ev: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/mailboxes/${mailboxId}/chats/${chatId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
      signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    onEvent({ type: "error", message: e instanceof Error ? e.message : "Could not reach the server." });
    return;
  }
  if (!res.ok || !res.body) {
    let message = res.statusText || "Request failed";
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      message = j.error?.message ?? message;
    } catch {
      // not JSON: keep statusText
    }
    onEvent({ type: "error", message });
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
        if (!dataLine) continue;
        try {
          onEvent(JSON.parse(dataLine.slice(5).trim()) as ChatStreamEvent);
        } catch {
          // a malformed frame: skip it, the stream carries on
        }
      }
    }
  } catch (e) {
    if ((e as Error).name !== "AbortError") onEvent({ type: "error", message: "The connection dropped." });
  }
}
