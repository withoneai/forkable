// GET /api/v1/events (CONTRACT 7.2): one EventSource for the app. Each event
// invalidates the TanStack keys it touches; screens that want the raw stream
// (the New profile progress, the first run) subscribe with useServerEvent.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ServerEvent, SourceHealth } from "@/contract/api-types";
import { API_BASE } from "./api";
import { keys } from "./queries";

type Listener = (e: ServerEvent) => void;
interface Live { connected: boolean; health: Record<string, SourceHealth>; subscribe: (l: Listener) => () => void }
const Ctx = createContext<Live>({ connected: false, health: {}, subscribe: () => () => {} });

export function EventsProvider({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const qc = useQueryClient();
  const listeners = useRef(new Set<Listener>());
  const [connected, setConnected] = useState(false);
  const [health, setHealth] = useState<Record<string, SourceHealth>>({});
  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource(`${API_BASE}/events`, { withCredentials: true });
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (m) => {
      let ev: ServerEvent;
      try { ev = JSON.parse(m.data as string) as ServerEvent; } catch { return; }
      listeners.current.forEach((l) => l(ev));
      switch (ev.type) {
        case "source":
          setHealth((h) => ({ ...h, [ev.sourceId]: ev.health }));
          void qc.invalidateQueries({ queryKey: keys.sources });
          void qc.invalidateQueries({ queryKey: keys.source(ev.sourceId) });
          break;
        case "run":
          void qc.invalidateQueries({ queryKey: keys.runs(ev.sourceId) });
          break;
        case "index":
          // Only refresh results when the page is idle (no key pressed for 4 s).
          if (Date.now() - lastKey > 4000) void qc.invalidateQueries({ queryKey: ["search"] });
          break;
        case "entity":
          void qc.invalidateQueries({ queryKey: keys.entity(ev.entityId) });
          break;
        case "health":
          void qc.invalidateQueries({ queryKey: keys.me });
          break;
        case "ledger":
          void qc.invalidateQueries({ queryKey: ["ledger"] });
          break;
        default:
          break;
      }
    };
    return () => { es.close(); setConnected(false); };
  }, [enabled, qc]);
  const value: Live = { connected, health, subscribe: (l) => { listeners.current.add(l); return () => { listeners.current.delete(l); }; } };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

let lastKey = 0;
if (typeof window !== "undefined") window.addEventListener("keydown", () => { lastKey = Date.now(); }, true);

export const useLive = () => useContext(Ctx);

export function useServerEvent(fn: Listener) {
  const { subscribe } = useLive();
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => subscribe((e) => ref.current(e)), [subscribe]);
}
