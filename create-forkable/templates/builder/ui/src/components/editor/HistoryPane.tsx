import { useEffect, useMemo, useRef, useState } from "react";
import { Bookmark, BookmarkCheck, Eye, FileDiff, History as HistoryIcon, RotateCcw } from "lucide-react";
import type { Checkpoint } from "@builder/core/types";
import { shotUrl } from "@/lib/api";
import { useBookmark, useCheckpoints, useDiff } from "@/lib/queries";
import { useKeys } from "@/lib/keys";
import { bind, hint } from "@/lib/keymap";
import { cn, fmtAgo, fmtDateTime } from "@/lib/utils";
import { Badge, Button, EmptyState, IconButton, LoadError, Skeleton, Tooltip } from "@/components/ui";
import { RestoreDialog } from "./RestoreDialog";

const KIND_LABEL: Record<Checkpoint["kind"], string> = { user: "Turn", fix: "Fix", edit: "Visual edit", plan: "Plan", restore: "Restore", manual: "Manual edits", template: "Template" };
const HARNESS_LABEL: Record<string, string> = { "claude-code": "Claude Code", codex: "Codex", openclaw: "OpenClaw", replay: "Replay" };

export function DiffStat({ add, del, className }: { add: number; del: number; className?: string }) {
  return (
    <span className={cn("tnum inline-flex items-center gap-1.5 font-mono text-11", className)}>
      <span className="text-success-text">+{add}</span>
      <span className="text-destructive-text">-{del}</span>
    </span>
  );
}

function Shot({ projectId, file, className }: { projectId: string; file: string | null; className?: string }) {
  const [bad, setBad] = useState(false);
  return (
    <div className={cn("overflow-hidden rounded-sm border border-border bg-frame", className)}>
      {file && !bad ? <img src={shotUrl(projectId, file)} alt="" loading="lazy" onError={() => setBad(true)} className="size-full object-cover object-top" /> : null}
    </div>
  );
}
export { Shot };

function DiffView({ projectId, cp }: { projectId: string; cp: Checkpoint }) {
  const diff = useDiff(projectId, cp.sha);
  if (diff.isLoading) return <div className="flex flex-col gap-2 p-4">{[50, 80, 65, 40, 70].map((w, i) => <Skeleton key={i} className="h-3" style={{ width: `${w}%` }} />)}</div>;
  if (diff.isError) return <LoadError what="The diff" error={diff.error} onRetry={() => diff.refetch()} />;
  const files = diff.data?.files ?? [];
  if (!files.length) return <EmptyState title="No file changes" detail="This version has the same files as the one before it." />;
  return (
    <div className="flex flex-col gap-3 p-3">
      {files.map((f) => (
        <div key={f.path} className="overflow-hidden rounded-md border border-border bg-card">
          <div className="flex h-8 items-center gap-2 border-b border-border bg-faint px-3">
            <Badge tone={f.status === "A" ? "success" : f.status === "D" ? "destructive" : "neutral"} mono>{f.status === "A" ? "new" : f.status === "D" ? "deleted" : "edited"}</Badge>
            <span className="truncate font-mono text-xs">{f.path}</span>
            <DiffStat add={f.additions} del={f.deletions} className="ml-auto" />
          </div>
          <pre className="overflow-x-auto py-1 font-mono text-xs leading-5">
            {f.patch.split("\n").filter((l) => !/^(diff --git|index |--- |\+\+\+ )/.test(l)).map((l, i) => (
              <div
                key={i}
                className={cn(
                  "px-3 whitespace-pre",
                  l.startsWith("+") && "bg-[var(--diff-add)]",
                  l.startsWith("-") && "bg-[var(--diff-del)]",
                  l.startsWith("@@") && "bg-muted/60 text-muted-foreground",
                )}
              >
                {l || " "}
              </div>
            ))}
          </pre>
        </div>
      ))}
    </div>
  );
}

export function HistoryPane({ projectId, busy, focusSha, onPreview, previewingSha, opening }: {
  projectId: string;
  busy: boolean;
  focusSha: string | null;
  /** Preview this version: open it on its own dev server without restoring. */
  onPreview: (cp: Checkpoint) => void;
  previewingSha: string | null;
  opening: boolean;
}) {
  const cps = useCheckpoints(projectId);
  const bookmark = useBookmark(projectId);
  const list = useMemo(() => cps.data ?? [], [cps.data]);
  const [sel, setSel] = useState(0);
  const [openSha, setOpenSha] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<Checkpoint | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focusSha) return;
    const i = list.findIndex((c) => c.sha === focusSha || c.shortSha === focusSha);
    if (i >= 0) { setSel(i); setOpenSha(list[i]!.sha); }
  }, [focusSha, list]);
  useEffect(() => {
    if (!openSha && list[0]) setOpenSha(list[0].sha);
  }, [list, openSha]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  useKeys(bind({
    next: () => setSel((v) => Math.min(list.length - 1, v + 1)),
    prev: () => setSel((v) => Math.max(0, v - 1)),
    open: () => { if (list[sel]) setOpenSha(list[sel]!.sha); },
    // V previews the highlighted version; while one is open, the editor's own V goes back.
    previewVersion: () => {
      if (previewingSha) return false;
      const cp = list[sel];
      if (!cp || sel === 0) return false;
      setOpenSha(cp.sha);
      onPreview(cp);
    },
  }), { enabled: list.length > 0 });

  if (cps.isLoading) return <div className="flex flex-col gap-2 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 rounded-md" />)}</div>;
  if (cps.isError) return <LoadError what="History" error={cps.error} onRetry={() => cps.refetch()} />;
  if (!list.length) return <EmptyState icon={<HistoryIcon />} title="No versions yet" detail="Every turn that changes a file becomes a version you can view or restore." />;

  const open = list.find((c) => c.sha === openSha) ?? null;
  const restoredFromSubject = (sha: string | null) => (sha ? list.find((c) => c.sha === sha || c.shortSha === sha)?.shortSha ?? sha.slice(0, 7) : null);

  return (
    <div className="flex min-h-0 flex-1">
      <div ref={listRef} role="listbox" aria-label="Versions" className="w-[340px] shrink-0 overflow-y-auto border-r border-border bg-faint p-1.5">
        {list.map((c, i) => {
          const active = i === sel;
          const opened = c.sha === openSha;
          return (
            <div
              key={c.sha}
              role="option"
              aria-selected={opened}
              data-idx={i}
              onClick={() => { setSel(i); setOpenSha(c.sha); }}
              className={cn(
                "group relative flex gap-2.5 rounded-md p-2 transition-colors duration-75",
                opened ? "bg-card shadow-[0_0_0_1px_var(--border)]" : "hover:bg-card-hover",
                active && !opened && "bg-card-hover",
              )}
            >
              <Shot projectId={projectId} file={c.shot} className="h-12 w-[72px] shrink-0" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="line-clamp-2 text-xs font-medium leading-snug">{c.subject}</p>
                <div className="flex flex-wrap items-center gap-1.5 text-11 text-muted-foreground">
                  <span title={fmtDateTime(c.createdAt)}>{fmtAgo(c.createdAt)}</span>
                  <span aria-hidden>·</span>
                  <span>{c.harness ? HARNESS_LABEL[c.harness] ?? c.harness : KIND_LABEL[c.kind]}</span>
                  {c.kind !== "template" && <><span aria-hidden>·</span><DiffStat add={c.additions} del={c.deletions} /></>}
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {i === 0 && <Badge tone="outline">Current</Badge>}
                  {c.sha === previewingSha && <Badge tone="warning">Previewing</Badge>}
                  {c.kind === "fix" && <Badge>Fix</Badge>}
                  {c.kind === "manual" && <Badge>Manual edits</Badge>}
                  {c.kind === "template" && <Badge>Template</Badge>}
                  {c.restoredFrom && <Badge tone="warning">Restored from {restoredFromSubject(c.restoredFrom)}</Badge>}
                  {c.bookmarked && <Badge tone="success">Bookmarked</Badge>}
                  {c.published.includes("github") && <Badge tone="success">Published to GitHub</Badge>}
                  {c.published.includes("vercel") && <Badge tone="success">Published to Vercel</Badge>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        {open && (
          <>
            <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
              <FileDiff className="size-4 stroke-[1.75] text-muted-foreground" />
              <span className="truncate text-13 font-medium">{open.subject}</span>
              <span className="font-mono text-11 text-muted-foreground">{open.shortSha}</span>
              <span className="ml-auto flex items-center gap-1">
                <IconButton label={open.bookmarked ? "Remove bookmark" : "Bookmark"} active={open.bookmarked} onClick={() => bookmark.mutate({ sha: open.sha, on: !open.bookmarked })}>
                  {open.bookmarked ? <BookmarkCheck /> : <Bookmark />}
                </IconButton>
                <Tooltip side="bottom" label={open.sha === list[0]?.sha ? "This is the current version" : <>See it running without restoring<span className="ml-0.5 rounded-sm bg-background/20 px-1 font-normal opacity-90">{hint("previewVersion")}</span></>}>
                  <Button size="sm" icon={<Eye />} disabled={open.sha === list[0]?.sha} loading={opening} onClick={() => onPreview(open)}>{open.sha === previewingSha ? "Show preview" : "Preview this version"}</Button>
                </Tooltip>
                <Button size="sm" icon={<RotateCcw />} disabled={open.sha === list[0]?.sha} onClick={() => setRestoring(open)}>Restore</Button>
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto bg-background"><DiffView projectId={projectId} cp={open} /></div>
          </>
        )}
      </div>
      <RestoreDialog projectId={projectId} checkpoint={restoring} onClose={() => setRestoring(null)} busy={busy} />
    </div>
  );
}
