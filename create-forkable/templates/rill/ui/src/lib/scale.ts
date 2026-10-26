import { useSyncExternalStore } from "react";

/** The Size setting from design/SPACING.md: multiplies the root font-size via
 *  --ui-scale, so every rem value (type ladder, spacing, radii) grows together. */
export type UiSize = "small" | "default" | "large";
export const UI_SCALE: Record<UiSize, number> = { small: 0.875, default: 1, large: 1.125 };
const KEY = "rill.size";
const listeners = new Set<() => void>();

function read(): UiSize {
  try {
    const v = localStorage.getItem(KEY);
    return v === "small" || v === "large" ? v : "default";
  } catch {
    return "default";
  }
}

export function applyScale(size = read()) {
  document.documentElement.style.setProperty("--ui-scale", String(UI_SCALE[size]));
}

export function setSize(size: UiSize) {
  try { localStorage.setItem(KEY, size); } catch { /* ignore */ }
  applyScale(size);
  listeners.forEach((l) => l());
}

export function useSize(): [UiSize, (s: UiSize) => void] {
  const size = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    read,
    () => "default" as UiSize,
  );
  return [size, setSize];
}
