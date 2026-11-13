// POST /api/v1/chat (CONTRACT 7.1): text/event-stream of ChatEvent, read with
// fetch so the request can carry a body and be aborted.
import type { AnswerRequest, AnswerResponse, ChatEvent, ChatStep, ChatTurnInput } from "@/contract/api-types";
import { API_BASE, ApiError, browserZone } from "./api";

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

/**
 * POST /api/v1/answer as a stream: `onStep` hears each step (reading, searching, writing) while the
 * answer is made, and the promise ends with the answer. A server that answers plain JSON (the mock)
 * works the same, with no steps.
 */
export async function streamAnswer(body: AnswerRequest, onStep: (s: ChatStep) => void, signal?: AbortSignal): Promise<AnswerResponse> {
  const res = await fetch(`${API_BASE}/answer`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream, application/json" },
    body: JSON.stringify({ tz: browserZone(), ...body }),
    credentials: "same-origin",
    signal,
  });
  const fail = (code: string, message: string) => new ApiError(res.status || 500, code, message);
  if (!res.ok) {
    let message = res.statusText, code = "internal";
    try { const j = (await res.json()) as { error?: { code: string; message: string } }; message = j.error?.message ?? message; code = j.error?.code ?? code; } catch { /* not json */ }
    throw fail(code, message);
  }
  if (!(res.headers.get("content-type") ?? "").includes("text/event-stream") || !res.body) return (await res.json()) as AnswerResponse;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let answer: AnswerResponse | null = null;
  let error: { code: string; message: string } | null = null;
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
      let e: ChatEvent;
      try { e = JSON.parse(data) as ChatEvent; } catch { continue; }
      if (e.type === "step") onStep(e.step);
      else if (e.type === "answer") answer = { text: e.text, citations: e.citations, grounded: e.grounded, model: e.model };
      else if (e.type === "error") error = e.error;
    }
  }
  if (error) throw fail(error.code, error.message);
  if (!answer) throw fail("internal", "The answer stopped before it was written.");
  return answer;
}
