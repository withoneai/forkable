import type { JSX } from "react";
// Everything the gallery shows comes from the registry folder itself: each
// block.json, and the raw source of every file it ships.

export interface BlockFile { from: string; to: string; alsoTo?: string }
export interface BlockAction { platform: string; actionId: string; title: string; access: "read" | "write"; reason: string; optional?: boolean }
export interface Block {
  name: string;
  title: string;
  description: string;
  kind: "component" | "app" | "lib";
  group?: string;
  route?: string;
  files: BlockFile[];
  requires: string[];
  routes: { method: string; path: string }[];
  actions: BlockAction[];
  mount?: string;
  usage?: string;
}

const manifests = import.meta.glob<Block>("../../registry/*/block.json", { eager: true, import: "default" });
const sources = import.meta.glob<string>("../../registry/**/*.{ts,tsx}", { eager: true, query: "?raw", import: "default" });

export const BLOCKS: Record<string, Block> = Object.fromEntries(Object.values(manifests).map((b) => [b.name, b]));

export function source(from: string): string {
  return sources[`../../registry/${from}`] ?? "";
}

/** Every block a block pulls in, itself last, in install order. */
export function closure(name: string, seen = new Set<string>()): Block[] {
  if (seen.has(name)) return [];
  seen.add(name);
  const b = BLOCKS[name];
  if (!b) return [];
  return [...b.requires.flatMap((r) => closure(r, seen)), b];
}

/** The grant a block adds, with every dependency's actions, deduped. */
export function grantOf(name: string): BlockAction[] {
  const out = new Map<string, BlockAction>();
  for (const b of closure(name)) for (const a of b.actions) if (!out.has(a.actionId)) out.set(a.actionId, a);
  return [...out.values()];
}

export function routesOf(name: string) {
  return closure(name).flatMap((b) => b.routes);
}

const previews = import.meta.glob<{ default: () => JSX.Element }>("../../registry/*/preview.tsx", { eager: true });
export function previewOf(name: string) {
  return previews[`../../registry/${name}/preview.tsx`]?.default ?? null;
}

// Sidebar groups, in this order; blocks inside a group by name.
const GROUP_ORDER = ["Auth", "Gmail", "Google Calendar", "Apps", "Rill", "Brief", "Lead", "Builder"];
export const NAV: { group: string; items: string[] }[] = GROUP_ORDER.map((group) => ({
  group,
  items: Object.values(BLOCKS)
    .filter((b) => b.group === group)
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "app" ? 1 : -1) || a.name.localeCompare(b.name))
    .map((b) => b.name),
})).filter((g) => g.items.length > 0);

export const GROUP_LOGO: Record<string, string> = { Gmail: "gmail", "Google Calendar": "google-calendar" };

// Blocks lifted out of a Forkable business carry that business's letter mark.
import rillMark from "../../brand/rill-mark-current.svg?raw";
import briefMark from "../../brand/brief-mark-current.svg?raw";
import leadMark from "../../brand/lead-mark-current.svg?raw";
export const GROUP_MARK: Record<string, string> = { Rill: rillMark, Brief: briefMark, Lead: leadMark };
export const BUSINESS_GROUPS = new Set(["Rill", "Brief", "Lead", "Builder"]);
