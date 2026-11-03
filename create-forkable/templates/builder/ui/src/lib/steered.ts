// Messages sent while a turn runs on a harness that can steer (Claude Code).
// They have no row on the server; the chat keeps them next to their turn.
import { useSyncExternalStore } from "react";

export interface Steered { id: number; text: string; at: number }
const byTurn = new Map<string, Steered[]>();
let seq = 0;
let version = 0;
const listeners = new Set<() => void>();

export function addSteered(turnId: string, text: string) {
  byTurn.set(turnId, [...(byTurn.get(turnId) ?? []), { id: ++seq, text, at: Date.now() }]);
  version++;
  listeners.forEach((l) => l());
}

export function useSteered(turnId: string): Steered[] {
  useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => version);
  return byTurn.get(turnId) ?? [];
}
