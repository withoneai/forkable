import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Eye, RefreshCw, RotateCcw } from "lucide-react";
import type { VersionPreview } from "@builder/core/types";
import { api } from "@/lib/api";
import { hint } from "@/lib/keymap";
import { cn } from "@/lib/utils";
import { Button, Tooltip } from "@/components/ui";
import { frameFit, GettingReady, useSize, type Device } from "./PreviewPane";

/**
 * Preview this version: an older checkpoint on its own
 * dev server and host, in the Preview pane, under a banner that says which
 * version it is. The live app keeps running untouched behind it.
 */
export function VersionPane({ version, src, reloadKey, device, onRestore, onBack, onRetry, restoreDisabled }: {
  version: VersionPreview;
  src: string;
  reloadKey: number;
  device: Device;
  onRestore: () => void;
  onBack: () => void;
  onRetry: () => void;
  restoreDisabled?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const { w, h } = useSize(box);
  const { width, height: frameH, scale } = frameFit(device, w, h);
  const ready = version.state === "ready";
  const down = version.state === "error" || version.state === "stopped";
  // Keep the version's dev server warm while it is on screen (it stops after 5 idle minutes).
  useEffect(() => {
    const t = setInterval(() => void api.versionViewed(version.projectId).catch(() => {}), 60_000);
    return () => clearInterval(t);
  }, [version.projectId]);
  // The iframe loads once the server answers, so it never shows the proxy's waiting page for long.
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { if (!ready) setLoaded(false); }, [ready]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-frame" data-testid="version-preview">
      <div role="region" aria-label="Version preview" className="@container flex h-11 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-warning-text/12 text-warning-text">
          <Eye className="size-3.5 stroke-[1.75]" />
        </span>
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="shrink-0 text-13 font-semibold">Previewing an older version</span>
          <span className="min-w-0 truncate text-xs text-muted-foreground" title={version.subject}>{version.subject}</span>
          <span className="shrink-0 font-mono text-11 text-muted-foreground">{version.shortSha}</span>
        </div>
        <Tooltip side="bottom" label="This version runs on its own copy with a fresh database. Reads on your grant run; writes are held on your computer.">
          <span className="hidden shrink-0 cursor-default text-11 text-muted-foreground @min-[52rem]:inline">Own database, writes held</span>
        </Tooltip>
        <Button size="sm" icon={<RotateCcw />} onClick={onRestore} disabled={restoreDisabled}>Restore this version</Button>
        <Button size="sm" variant="primary" icon={<ArrowLeft />} onClick={onBack} title={`Back to current (${hint("previewVersion")})`}>Back to current</Button>
      </div>
      <div ref={box} className={cn("relative min-h-0 flex-1 overflow-hidden", device !== "desktop" && "flex items-start justify-center")}>
        {w > 0 && ready && (
          <div
            className={cn("origin-top-left overflow-hidden bg-white", device !== "desktop" && "mt-6 rounded-xl border border-border shadow-float")}
            style={{ width, height: frameH, transform: `scale(${scale})`, transformOrigin: device === "desktop" ? "top left" : "top center" }}
          >
            <iframe
              key={`${version.sha}-${reloadKey}`}
              src={src}
              title={`Version ${version.shortSha} of the app`}
              onLoad={() => setLoaded(true)}
              className={cn("size-full border-0 bg-white transition-opacity duration-150", loaded ? "opacity-100" : "opacity-0")}
            />
          </div>
        )}
        {!down && (!ready || !loaded) && <GettingReady step={version.step ?? (ready ? "Loading this version" : "Starting this version")} />}
        {down && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <div className="pop-in flex max-w-[400px] flex-col items-center gap-2 rounded-xl border border-border bg-card p-5 text-center shadow-float">
              <p className="text-13 font-semibold">{version.state === "error" ? "This version did not start" : "This version stopped"}</p>
              <p className="line-clamp-4 whitespace-pre-line text-xs text-muted-foreground">{version.message ?? "Its preview server is not running. Start it again, or go back to the current version."}</p>
              <div className="mt-1 flex gap-2">
                <Button size="sm" icon={<RefreshCw />} onClick={onRetry}>Start it again</Button>
                <Button size="sm" variant="primary" icon={<ArrowLeft />} onClick={onBack}>Back to current</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
