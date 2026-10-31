// Small sticky UI choices (dock open, widths) that survive a reload.
import { useEffect, useState } from "react";

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLocal(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage unavailable: the choice just doesn't stick
  }
}

export function usePersistedBoolean(key: string, fallback: boolean): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(() => readLocal(key) === "1" || (readLocal(key) === null && fallback));
  useEffect(() => writeLocal(key, v ? "1" : "0"), [key, v]);
  return [v, setV];
}

export function usePersistedNumber(key: string, fallback: number): [number, (v: number) => void] {
  const [v, setV] = useState(() => {
    const raw = readLocal(key);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : fallback;
  });
  useEffect(() => writeLocal(key, String(v)), [key, v]);
  return [v, setV];
}
