import { useEffect, useSyncExternalStore } from "react";

export type Theme = "light" | "dark" | "system";
const KEY = "search.theme";
const listeners = new Set<() => void>();

function read(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function resolvedDark(theme: Theme): boolean {
  return theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
}

export function applyTheme(theme = read()) {
  document.documentElement.classList.toggle("dark", resolvedDark(theme));
}

export function setTheme(theme: Theme) {
  try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
  applyTheme(theme);
  listeners.forEach((l) => l());
}

export function toggleTheme() {
  setTheme(resolvedDark(read()) ? "light" : "dark");
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const theme = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    read,
    () => "system" as Theme,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return [theme, setTheme];
}
