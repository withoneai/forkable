import type { Context } from "hono";
import { streamSSE, type SSEStreamingApi } from "hono/streaming";
import type { MailboxEvent } from "@rill/core";

const HEARTBEAT_MS = 25_000;

/** One set of open SSE streams per mailbox. */
export interface Hub {
  emit(mailboxId: string, event: MailboxEvent): void;
  subscribe(c: Context, mailboxId: string): Response;
  listeners(mailboxId: string): number;
  closeAll(): void;
}

export function createHub(): Hub {
  const streams = new Map<string, Set<SSEStreamingApi>>();
  let seq = 0;

  const remove = (mailboxId: string, s: SSEStreamingApi) => {
    const set = streams.get(mailboxId);
    if (!set) return;
    set.delete(s);
    if (set.size === 0) streams.delete(mailboxId);
  };

  return {
    emit(mailboxId, event) {
      const set = streams.get(mailboxId);
      if (!set || set.size === 0) return;
      const data = JSON.stringify(event);
      const id = String(++seq);
      for (const s of set) {
        s.writeSSE({ event: event.type, data, id }).catch(() => remove(mailboxId, s));
      }
    },

    subscribe(c, mailboxId) {
      return streamSSE(c, async (stream) => {
        const set = streams.get(mailboxId) ?? new Set<SSEStreamingApi>();
        set.add(stream);
        streams.set(mailboxId, set);
        await stream.writeSSE({ event: "hello", data: JSON.stringify({ mailboxId }), id: String(++seq) });

        let open = true;
        const close = () => {
          open = false;
          remove(mailboxId, stream);
        };
        stream.onAbort(close);

        while (open && !stream.closed && !stream.aborted) {
          await stream.sleep(HEARTBEAT_MS);
          if (!open || stream.closed || stream.aborted) break;
          try {
            await stream.writeSSE({ event: "heartbeat", data: new Date().toISOString() });
          } catch {
            close();
          }
        }
        close();
      });
    },

    listeners(mailboxId) {
      return streams.get(mailboxId)?.size ?? 0;
    },

    closeAll() {
      for (const [, set] of streams) for (const s of set) s.close().catch(() => {});
      streams.clear();
    },
  };
}
