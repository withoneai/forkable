import { useSyncExternalStore } from "react";

export interface Toast {
  id: number;
  title: string;
  detail?: string;
  action?: { label: string; onClick: () => void };
  tone?: "neutral" | "destructive";
  ttl: number;
}

let toasts: Toast[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(input: Omit<Toast, "id" | "ttl"> & { ttl?: number }): number {
  const id = ++seq;
  const t: Toast = { ttl: 5000, ...input, id };
  toasts = [...toasts.slice(-3), t];
  emit();
  if (t.ttl > 0) setTimeout(() => dismissToast(id), t.ttl);
  return id;
}

export function dismissToast(id: number) {
  if (!toasts.some((t) => t.id === id)) return;
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => toasts,
    () => toasts,
  );
}
