// Mirrors packages/core/src/api-types.ts (PreviewBeacon, PreviewToEditor,
// EditorToPreview, Selection). Kept local so the browser bundle has no
// workspace imports; the server's typecheck excludes this folder.

export interface Selection {
  loc: string;
  tag: string;
  text?: string;
  classes?: string;
  rect?: { x: number; y: number; width: number; height: number };
}

export interface PreviewBeacon {
  kind: "runtime" | "console" | "network" | "blank" | "unhandledrejection";
  level: "error" | "warning";
  message: string;
  stack?: string;
  file?: string;
  line?: number;
  col?: number;
  status?: number;
  path?: string;
  refusal?: { source: string; code: string };
  page: string;
  at: number;
}

export type Mode = "none" | "select" | "text" | "comment";

export type PreviewToEditor =
  | { kind: "hello"; path: string; title: string }
  | { kind: "route"; path: string }
  | { kind: "hmr"; ok: boolean; message?: string }
  | { kind: "select"; selections: Selection[]; additive: boolean; ancestors: string[] }
  | { kind: "hover"; loc: string | null }
  | { kind: "key"; key: string; meta: boolean; shift: boolean; alt: boolean }
  | { kind: "mode"; mode: Mode }
  | { kind: "edit-text"; loc: string; tag: string; before: string; after: string }
  | { kind: "comment"; selection: Selection };

export type EditorToPreview =
  | { kind: "mode"; mode: Mode }
  | { kind: "highlight"; loc: string | null }
  | { kind: "clear" }
  | { kind: "scroll-to"; loc: string }
  | { kind: "apply-class"; loc: string; remove: string[]; add: string[] }
  | { kind: "pending"; locs: string[] };
