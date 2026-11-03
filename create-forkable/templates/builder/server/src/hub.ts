import type { Context } from "hono";
import { streamSSE, type SSEStreamingApi } from "hono/streaming";
import type { ProjectEvent } from "@builder/core";

const HEARTBEAT_MS = 25_000;

/** Open SSE streams per project. */
export interface Hub {
  emit(projectId: string, event: ProjectEvent): void;
  subscribe(c: Context, projectId: string, replay: () => Promise<ProjectEvent[]>): Response;
  closeAll(): void;
}

export function createHub(): Hub {
  const streams = new Map<string, Set<SSEStreamingApi>>();
  let seq = 0;
  const remove = (id: string, s: SSEStreamingApi) => {
    const set = streams.get(id);
    if (!set) return;
    set.delete(s);
    if (set.size === 0) streams.delete(id);
  };
  const write = (s: SSEStreamingApi, e: ProjectEvent) => s.writeSSE({ event: e.type, data: JSON.stringify(e), id: String(++seq) });
  return {
    emit(projectId, event) {
      const set = streams.get(projectId);
      if (!set) return;
      for (const s of set) write(s, event).catch(() => remove(projectId, s));
    },
    subscribe(c, projectId, replay) {
      return streamSSE(c, async (stream) => {
        await write(stream, { type: "hello", projectId });
        // Replay first, then join the live set, so a late client sees the running turn whole.
        for (const e of await replay()) await write(stream, e);
        const set = streams.get(projectId) ?? new Set<SSEStreamingApi>();
        set.add(stream);
        streams.set(projectId, set);
        let open = true;
        stream.onAbort(() => {
          open = false;
          remove(projectId, stream);
        });
        while (open && !stream.closed && !stream.aborted) {
          await stream.sleep(HEARTBEAT_MS);
          if (!open || stream.closed || stream.aborted) break;
          try {
            await stream.writeSSE({ event: "heartbeat", data: new Date().toISOString() });
          } catch {
            break;
          }
        }
        remove(projectId, stream);
      });
    },
    closeAll() {
      for (const set of streams.values()) for (const s of set) s.close().catch(() => {});
      streams.clear();
    },
  };
}
