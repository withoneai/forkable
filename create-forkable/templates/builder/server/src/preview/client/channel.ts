import { EDITOR_ORIGINS, SOURCE_EDITOR, SOURCE_PREVIEW } from "./env";
import type { EditorToPreview, PreviewToEditor } from "./types";

const embedded = window.parent !== window;

/** Posts to the editor. Only the origin that matches the parent receives it. */
export function toEditor(msg: PreviewToEditor): void {
  if (!embedded) return;
  for (const origin of EDITOR_ORIGINS) {
    try {
      window.parent.postMessage({ source: SOURCE_PREVIEW, ...msg }, origin);
    } catch {
      /* origin mismatch is silent in browsers; this guards odd hosts */
    }
  }
}

export function onEditor(handler: (msg: EditorToPreview) => void): void {
  window.addEventListener("message", (event) => {
    if (!EDITOR_ORIGINS.includes(event.origin)) return;
    const data = event.data as ({ source?: string } & EditorToPreview) | null;
    if (!data || typeof data !== "object" || data.source !== SOURCE_EDITOR) return;
    handler(data);
  });
}

export const isEmbedded = embedded;
