// GET /api/v1/events (CONTRACT 7.2): one set of open SSE streams per user. Frames
// carry no event name (`data: <ServerEvent JSON>`), so a browser EventSource
// reads every one through onmessage; the type is inside the JSON.

import type { Context } from "hono";
import { streamSSE, type SSEStreamingApi } from "hono/streaming";
import type { ServerEvent } from "@search/core";

const PING_MS = 25_000;

export interface Hub {
  emit(userId: string, event: ServerEvent): void;
  /** Every connected user (a capability change). */
  broadcast(event: ServerEvent): void;
  subscribe(c: Context, userId: string): Response;
  listeners(userId: string): number;
  closeAll(): void;
  /** Tests and in-process consumers. */
  onEvent(fn: (userId: string, event: ServerEvent) => void): () => void;
}

export function createHub(): Hub {
  const streams = new Map<string, Set<SSEStreamingApi>>();
  const taps = new Set<(userId: string, event: ServerEvent) => void>();
  let seq = 0;

  const remove = (userId: string, s: SSEStreamingApi) => {
    const set = streams.get(userId);
    if (!set) return;
    set.delete(s);
    if (set.size === 0) streams.delete(userId);
  };

  const send = (userId: string, event: ServerEvent) => {
    for (const t of taps) { try { t(userId, event); } catch { /* a tap never breaks emit */ } }
    const set = streams.get(userId);
    if (!set?.size) return;
    const data = JSON.stringify(event);
    const id = String(++seq);
    for (const s of set) s.writeSSE({ data, id }).catch(() => remove(userId, s));
  };

  return {
    emit: send,
    broadcast(event) { for (const u of streams.keys()) send(u, event); },
    subscribe(c, userId) {
      return streamSSE(c, async (stream) => {
        const set = streams.get(userId) ?? new Set<SSEStreamingApi>();
        set.add(stream);
        streams.set(userId, set);
        let open = true;
        const close = () => { open = false; remove(userId, stream); };
        stream.onAbort(close);
        await stream.writeSSE({ data: JSON.stringify({ type: "ping" } satisfies ServerEvent), id: String(++seq) }).catch(close);
        while (open && !stream.closed && !stream.aborted) {
          await stream.sleep(PING_MS);
          if (!open || stream.closed || stream.aborted) break;
          try { await stream.writeSSE({ data: JSON.stringify({ type: "ping" } satisfies ServerEvent) }); } catch { close(); }
        }
        close();
      });
    },
    listeners(userId) { return streams.get(userId)?.size ?? 0; },
    closeAll() {
      for (const [, set] of streams) for (const s of set) s.close().catch(() => {});
      streams.clear();
    },
    onEvent(fn) { taps.add(fn); return () => { taps.delete(fn); }; },
  };
}
