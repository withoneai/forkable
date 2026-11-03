// The keyboard table. One source for the bindings
// and the cheatsheet, so a letter never means two things.
import { MOD } from "./utils";

export type KeyId =
  | "palette" | "send" | "stop" | "toggleChat" | "tabPreview" | "tabCode" | "tabHistory" | "tabAccess" | "tabSettings"
  | "publish" | "reload" | "select" | "editText" | "comment" | "escape" | "next" | "prev" | "open" | "previewVersion" | "save" | "cheatsheet";

export interface KeyDef {
  id: KeyId;
  /** Chord strings understood by lib/keys.ts. The first one is shown. */
  chords: string[];
  /** Rendered with <Keys>; space separated parts. */
  display: string;
  label: string;
  group: "Everywhere" | "Editor" | "Preview" | "Lists" | "Code";
  /** Only fires when focus is not in a text field (single letters). */
  letter?: boolean;
}

export const KEYMAP: KeyDef[] = [
  { id: "palette", chords: ["mod+k"], display: `${MOD} K`, label: "Command palette", group: "Everywhere" },
  { id: "cheatsheet", chords: ["?"], display: "?", label: "Keyboard shortcuts", group: "Everywhere", letter: true },
  { id: "send", chords: ["mod+enter"], display: `${MOD} Enter`, label: "Send the message", group: "Editor" },
  { id: "stop", chords: ["mod+."], display: `${MOD} .`, label: "Stop the running turn", group: "Editor" },
  { id: "toggleChat", chords: ["mod+b"], display: `${MOD} B`, label: "Hide or show chat", group: "Editor" },
  { id: "tabPreview", chords: ["mod+1"], display: `${MOD} 1`, label: "Preview", group: "Editor" },
  { id: "tabCode", chords: ["mod+2"], display: `${MOD} 2`, label: "Code", group: "Editor" },
  { id: "tabHistory", chords: ["mod+3"], display: `${MOD} 3`, label: "History", group: "Editor" },
  { id: "tabAccess", chords: ["mod+4"], display: `${MOD} 4`, label: "Access", group: "Editor" },
  { id: "tabSettings", chords: ["mod+5"], display: `${MOD} 5`, label: "Project settings", group: "Editor" },
  { id: "publish", chords: ["mod+shift+p"], display: `${MOD} Shift P`, label: "Open Publish", group: "Editor" },
  { id: "reload", chords: ["alt+r"], display: "Alt R", label: "Reload the preview", group: "Preview" },
  { id: "select", chords: ["s"], display: "S", label: "Select an element", group: "Preview", letter: true },
  { id: "editText", chords: ["t"], display: "T", label: "Edit text in place", group: "Preview", letter: true },
  { id: "comment", chords: ["c"], display: "C", label: "Comment on an element", group: "Preview", letter: true },
  { id: "escape", chords: ["escape"], display: "Esc", label: "Leave the tool, clear the selection", group: "Preview" },
  { id: "next", chords: ["j"], display: "J", label: "Next item", group: "Lists", letter: true },
  { id: "prev", chords: ["k"], display: "K", label: "Previous item", group: "Lists", letter: true },
  { id: "open", chords: ["enter"], display: "Enter", label: "Open", group: "Lists" },
  { id: "previewVersion", chords: ["v"], display: "V", label: "Preview the version, or back to current", group: "Lists", letter: true },
  { id: "save", chords: ["mod+s"], display: `${MOD} S`, label: "Save the file", group: "Code" },
];

export const KEY: Record<KeyId, KeyDef> = Object.fromEntries(KEYMAP.map((k) => [k.id, k])) as Record<KeyId, KeyDef>;

/** Build a lib/keys.ts map from ids. */
export function bind(handlers: Partial<Record<KeyId, (e: KeyboardEvent) => void | boolean>>): Record<string, (e: KeyboardEvent) => void | boolean> {
  const out: Record<string, (e: KeyboardEvent) => void | boolean> = {};
  for (const [id, h] of Object.entries(handlers)) {
    if (!h) continue;
    for (const c of KEY[id as KeyId].chords) out[c] = h;
  }
  return out;
}

/** "⌘ K" for tooltips. */
export const hint = (id: KeyId) => KEY[id].display.replace(/ /g, "");
