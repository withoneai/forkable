import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { MessageSquare, MousePointer2, RefreshCw, Type } from "lucide-react";
import type { Project } from "@builder/core/types";
import type { PreviewMode } from "@builder/core/api-types";
import { humanError } from "@/lib/api";
import { api } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { keys } from "@/lib/queries";
import { hint } from "@/lib/keymap";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Button, Spinner, Tooltip } from "@/components/ui";

export type Device = "desktop" | "tablet" | "mobile";
export const DEVICE_WIDTH: Record<Device, number> = { desktop: 1280, tablet: 768, mobile: 390 };

/** Frame size for a pane of w x h. Desktop fills the pane, never narrower than 1280 (it scales down below that). */
export function frameFit(device: Device, w: number, h: number) {
  const width = device === "desktop" ? Math.max(DEVICE_WIDTH.desktop, w) : DEVICE_WIDTH[device];
  const pad = device === "desktop" ? 0 : 24;
  const scale = w > 0 ? Math.min(1, (w - pad * 2) / width) : 1;
  const height = device === "desktop" ? h / scale : Math.min((h - pad * 2) / scale, device === "mobile" ? 844 : 1024);
  return { width, height, scale };
}

export function useSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e!.contentRect.width, h: e!.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

export function GettingReady({ step }: { step: string }) {
  return (
    <div role="status" aria-live="polite" className="slide-up pointer-events-none absolute left-1/2 top-3 z-10 flex h-8 -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-card/95 pl-2.5 pr-3.5 text-xs font-medium shadow-pop backdrop-blur">
      <Spinner className="size-3.5 text-accent" />
      <span className="text-muted-foreground">Getting ready</span>
      <span className="max-w-[320px] truncate">{step}</span>
    </div>
  );
}

function ToolButton({ label, keyId, active, disabled, onClick, children, note }: {
  label: string; keyId: "select" | "editText" | "comment"; active?: boolean; disabled?: boolean; onClick?: () => void; children: React.ReactNode; note?: string;
}) {
  return (
    <Tooltip side="top" label={<>{note ?? label}<span className="ml-0.5 rounded-sm bg-background/20 px-1 font-normal opacity-90">{hint(keyId)}</span></>}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors duration-100 [&>svg]:size-3.5 [&>svg]:stroke-[1.75]",
          active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-card-hover hover:text-foreground",
          disabled && "opacity-40",
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

const MODE_HINT: Record<Exclude<PreviewMode, "none">, string> = {
  select: "Click an element to select it. Cmd-click adds. Esc leaves.",
  text: "Click any text to edit it. Enter keeps it, Esc undoes.",
  comment: "Click an element to comment on it. Esc leaves.",
};

export function PreviewPane({ project, frame, src, reloadKey, device, mode, onMode, readyStep, onLoad, overlay }: {
  project: Project;
  frame: RefObject<HTMLIFrameElement | null>;
  src: string;
  reloadKey: number;
  device: Device;
  mode: PreviewMode;
  onMode: (m: PreviewMode) => void;
  /** Style panel, comment box and the edits bar. */
  overlay?: React.ReactNode;
  /** Non-null shows the Getting ready pill. */
  readyStep: string | null;
  onLoad: () => void;
}) {
  const qc = useQueryClient();
  const box = useRef<HTMLDivElement>(null);
  const { w, h } = useSize(box);
  const [restarting, setRestarting] = useState(false);
  const { width, height: frameH, scale } = frameFit(device, w, h);
  // Keep the dev server warm while the preview is on screen.
  useEffect(() => {
    void api.previewViewed(project.id).catch(() => {});
    const t = setInterval(() => void api.previewViewed(project.id).catch(() => {}), 60_000);
    return () => clearInterval(t);
  }, [project.id]);

  const restart = async () => {
    setRestarting(true);
    try {
      const r = await api.restartPreview(project.id);
      qc.setQueryData(keys.project(project.id), r.project);
    } catch (e) {
      toast({ title: "Could not restart the preview", detail: humanError(e), tone: "destructive" });
    } finally {
      setRestarting(false);
    }
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-frame">
      <div ref={box} className={cn("relative min-h-0 flex-1 overflow-hidden", device !== "desktop" && "flex items-start justify-center")}>
        {w > 0 && (
          <div
            className={cn("origin-top-left overflow-hidden bg-white", device !== "desktop" && "mt-6 rounded-xl border border-border shadow-float")}
            style={{
              width,
              height: frameH,
              transform: `scale(${scale})`,
              transformOrigin: device === "desktop" ? "top left" : "top center",
              ...(device !== "desktop" ? { marginLeft: 0 } : {}),
            }}
          >
            <iframe
              key={reloadKey}
              ref={frame}
              src={src}
              title={`Preview of ${project.name}`}
              onLoad={onLoad}
              className="size-full border-0 bg-white"
              allow="clipboard-read; clipboard-write"
            />
          </div>
        )}
        {readyStep && project.preview !== "error" && <GettingReady step={readyStep} />}
        {project.preview === "error" && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <div className="pop-in flex max-w-[380px] flex-col items-center gap-2 rounded-xl border border-border bg-card p-5 text-center shadow-float">
              <p className="text-13 font-semibold">The preview stopped</p>
              <p className="text-xs text-muted-foreground">{project.previewStep ?? "The dev server exited. The console strip below has what it printed."}</p>
              <Button size="sm" className="mt-1" icon={<RefreshCw />} loading={restarting} onClick={restart}>Restart preview</Button>
            </div>
          </div>
        )}
        {mode !== "none" && !readyStep && (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center">
            <span className="fade-in mt-3 rounded-full bg-accent px-3 py-1 text-11 font-medium text-accent-foreground shadow-pop">{MODE_HINT[mode]}</span>
          </div>
        )}
        {overlay}
        <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-border bg-card/95 p-0.5 shadow-float backdrop-blur" role="toolbar" aria-label="Preview tools">
          <ToolButton label="Select" keyId="select" active={mode === "select"} onClick={() => onMode(mode === "select" ? "none" : "select")}><MousePointer2 />Select</ToolButton>
          <ToolButton label="Edit text" keyId="editText" active={mode === "text"} onClick={() => onMode(mode === "text" ? "none" : "text")}><Type />Edit</ToolButton>
          <ToolButton label="Comment" keyId="comment" active={mode === "comment"} onClick={() => onMode(mode === "comment" ? "none" : "comment")}><MessageSquare />Comment</ToolButton>
        </div>
      </div>
    </div>
  );
}
