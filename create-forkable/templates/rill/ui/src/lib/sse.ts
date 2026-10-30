import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { MailboxEvent } from "@rill/core/api-types";
import { API_BASE } from "./api";
import { keys } from "./queries";

export interface MailboxLive {
  connected: boolean;
  syncing: boolean;
  progress: { judged: number; total: number } | null;
  reconnectRequired: boolean;
  last: MailboxEvent | null;
}

const initial: MailboxLive = { connected: false, syncing: false, progress: null, reconnectRequired: false, last: null };

/**
 * Opens the mailbox event stream and keeps the query cache fresh.
 * Invalidation is debounced so a burst of `judged` events costs one refetch.
 */
export function useMailboxEvents(mailboxId: string | null, onEvent?: (e: MailboxEvent) => void): MailboxLive {
  const qc = useQueryClient();
  const [live, setLive] = useState<MailboxLive>(initial);
  const cb = useRef(onEvent);
  cb.current = onEvent;

  useEffect(() => {
    if (!mailboxId) { setLive(initial); return; }
    const es = new EventSource(`${API_BASE}/mailboxes/${mailboxId}/events`);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const dirty = new Set<string>();
    const flush = () => {
      timer = null;
      if (dirty.has("inbox")) qc.invalidateQueries({ queryKey: keys.inboxAll(mailboxId) });
      if (dirty.has("thread")) qc.invalidateQueries({ queryKey: keys.threads(mailboxId) });
      if (dirty.has("ledger")) {
        qc.invalidateQueries({ queryKey: keys.access(mailboxId) });
        qc.invalidateQueries({ queryKey: keys.ledger(mailboxId) });
      }
      if (dirty.has("me")) qc.invalidateQueries({ queryKey: keys.me });
      dirty.clear();
    };
    const mark = (...what: string[]) => {
      what.forEach((w) => dirty.add(w));
      if (!timer) timer = setTimeout(flush, 250);
    };

    es.onopen = () => setLive((l) => ({ ...l, connected: true }));
    es.onerror = () => setLive((l) => ({ ...l, connected: false }));
    es.onmessage = (m) => {
      let ev: MailboxEvent;
      try { ev = JSON.parse(m.data) as MailboxEvent; } catch { return; }
      cb.current?.(ev);
      setLive((l) => {
        const next: MailboxLive = { ...l, last: ev };
        switch (ev.type) {
          case "sync": next.syncing = ev.phase === "start"; break;
          case "progress": next.progress = { judged: ev.judged, total: ev.total }; break;
          case "reconnect_required": next.reconnectRequired = true; break;
          default: break;
        }
        return next;
      });
      switch (ev.type) {
        case "sync": if (ev.phase !== "start") mark("inbox", "me"); break;
        case "judged": mark("inbox", "thread", "me"); break;
        case "draft": mark("thread", "inbox"); break;
        case "ledger": mark("ledger"); break;
        case "reconnect_required": mark("me", "inbox"); break;
        case "progress": if (ev.judged >= ev.total) mark("inbox", "me"); break;
        case "health": mark("inbox", "me"); break;
        default: break;
      }
    };
    return () => {
      es.close();
      if (timer) clearTimeout(timer);
    };
  }, [mailboxId, qc]);

  return live;
}
