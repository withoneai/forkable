// The editor side of the preview channel (docs/CONTRACT.md section 6).
import { useCallback, useEffect, useRef } from "react";
import type { EditorToPreview, PreviewToEditor } from "@builder/core/api-types";
import { EDITOR_SOURCE, PREVIEW_SOURCE } from "./brand";

export function originOf(url: string): string | null {
  try {
    return new URL(url, window.location.href).origin;
  } catch {
    return null;
  }
}

/**
 * Listens for messages from the preview iframe (only from its own origin and
 * only with the preview source tag) and returns a sender for editor messages.
 */
export function usePreviewChannel(previewUrl: string, onMessage: (m: PreviewToEditor) => void) {
  const frame = useRef<HTMLIFrameElement>(null);
  const origin = originOf(previewUrl);
  const cb = useRef(onMessage);
  cb.current = onMessage;

  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (!origin || e.origin !== origin) return;
      const d = e.data as (PreviewToEditor & { source?: string }) | null;
      if (!d || typeof d !== "object" || d.source !== PREVIEW_SOURCE) return;
      cb.current(d);
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [origin]);

  const post = useCallback(
    (m: EditorToPreview) => {
      const w = frame.current?.contentWindow;
      if (!w || !origin) return;
      w.postMessage({ ...m, source: EDITOR_SOURCE }, origin);
    },
    [origin],
  );

  return { frame, post, origin };
}
