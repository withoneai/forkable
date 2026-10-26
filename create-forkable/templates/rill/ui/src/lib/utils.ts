import { useEffect, useState } from "react";
import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
import type { Lane, VipTier } from "@rill/core/types";

// The type ladder (design/SPACING.md) adds text-8 ... text-28. Without telling
// tailwind-merge they are font sizes it reads them as colors, so
// cn("text-11", "text-muted-foreground") silently dropped the size.
const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: ["8", "9", "10", "11", "13", "15", "28"] }] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const LANE_LABEL: Record<Lane, string> = {
  vip: "VIPs",
  goals: "Goals",
  reply: "Needs reply",
  other: "Other",
  screener: "New senders",
};

export const LANE_KEY: Record<Lane, string> = { vip: "V", goals: "G", reply: "R", other: "O", screener: "S" };

export const TIER_LABEL: Record<VipTier, string> = {
  inner: "Inner circle",
  key: "Key account",
  team: "Team",
};

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Superhuman-style short relative time: "now", "18m", "3h", "Mon", "Oct 3". */
export function fmtRelative(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = now - t;
  if (diff < MIN) return "now";
  if (diff < HOUR) return `${Math.floor(diff / MIN)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  if (diff < 7 * DAY) return new Date(t).toLocaleDateString(undefined, { weekday: "short" });
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function fmtClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function fmtBytes(n: number | null): string {
  if (n == null) return "unknown";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function pct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? "⌘" : "Ctrl";

/** Snooze targets for the menu. */
export function snoozeTargets(now = new Date()): { key: string; label: string; until: string }[] {
  const later = new Date(now);
  later.setHours(now.getHours() + 3, 0, 0, 0);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(8, 0, 0, 0);
  const monday = new Date(now);
  const day = now.getDay();
  const add = day === 0 ? 1 : day === 1 ? 7 : 8 - day;
  monday.setDate(now.getDate() + add);
  monday.setHours(8, 0, 0, 0);
  return [
    { key: "later", label: "Later today", until: later.toISOString() },
    { key: "tomorrow", label: "Tomorrow", until: tomorrow.toISOString() },
    { key: "monday", label: "Monday", until: monday.toISOString() },
  ];
}

export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}
