// Screens register palette commands while mounted; the palette lists them.
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";

export interface Command {
  id: string;
  group: "Project" | "Go to" | "Versions" | "Agent" | "App";
  label: string;
  detail?: string;
  icon?: ReactNode;
  keys?: string;
  disabled?: boolean;
  run: () => void;
}

const sources = new Map<number, () => Command[]>();
let seq = 0;
let version = 0;
const listeners = new Set<() => void>();
const bump = () => { version++; listeners.forEach((l) => l()); };

export function useCommands(list: Command[], deps: unknown[]) {
  const ref = useRef(list);
  ref.current = list;
  useEffect(() => {
    const id = ++seq;
    sources.set(id, () => ref.current);
    bump();
    return () => { sources.delete(id); bump(); };
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { bump(); }, deps);
}

export function useCommandList(): Command[] {
  useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => version);
  return [...sources.values()].flatMap((f) => f());
}
