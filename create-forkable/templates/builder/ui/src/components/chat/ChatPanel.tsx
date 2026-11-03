import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown } from "lucide-react";
import type { Checkpoint, Project, Selection, Turn } from "@builder/core/types";
import { ACTIVE_STATUSES } from "@builder/core/types";
import type { HarnessInfo } from "@builder/harness/types";
import { api, humanError } from "@/lib/api";
import { patchTurn, useCheckpoints, useCreateTurn, useErrors, useTurns } from "@/lib/queries";
import { addSteered } from "@/lib/steered";
import { toast } from "@/lib/toast";
import { Button, Skeleton, LoadError } from "@/components/ui";
import { RestoreDialog } from "@/components/editor/RestoreDialog";
import { COMPOSER_EVENT, TurnView } from "./TurnView";
import { Composer, type Attached } from "./Composer";

export function ChatPanel({ project, harness, selections, onClearSelections, onRemoveSelection, onViewVersion, focusRef, stopRef }: {
  project: Project;
  harness: HarnessInfo | undefined;
  selections: Selection[];
  onClearSelections: () => void;
  onRemoveSelection: (loc: string) => void;
  onViewVersion: (sha: string) => void;
  focusRef: React.RefObject<(() => void) | null>;
  stopRef: React.RefObject<(() => void) | null>;
}) {
  const qc = useQueryClient();
  const turnsQ = useTurns(project.id);
  const cps = useCheckpoints(project.id);
  const errors = useErrors(project.id);
  const createTurn = useCreateTurn(project.id);
  const [draft, setDraft] = useState("");
  const [plan, setPlan] = useState(false);
  const [images, setImages] = useState<Attached[]>([]);
  const [attaching, setAttaching] = useState(false);
  useEffect(() => {
    const on = (e: Event) => { setDraft((e as CustomEvent<string>).detail); setPlan(false); setTimeout(() => focusRef.current?.(), 0); };
    window.addEventListener(COMPOSER_EVENT, on);
    return () => window.removeEventListener(COMPOSER_EVENT, on);
  }, [focusRef]);
  const attach = async (files: File[]) => {
    setAttaching(true);
    try {
      for (const f of files.slice(0, 6)) {
        const r = await api.attach(project.id, f);
        setImages((cur) => [...cur, { file: r.file, url: r.url, name: f.name || "image" }]);
      }
    } catch (e) {
      toast({ title: "Could not attach the image", detail: humanError(e), tone: "destructive" });
    } finally {
      setAttaching(false);
    }
  };
  const [stopping, setStopping] = useState(false);
  const [restoring, setRestoring] = useState<Checkpoint | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const all = useMemo(() => {
    const flat = (turnsQ.data?.pages ?? []).flatMap((p) => p.turns);
    const seen = new Set<string>();
    return flat.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true))).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [turnsQ.data]);
  const { top, fixesOf } = useMemo(() => {
    const ids = new Set(all.map((t) => t.id));
    const fixesOf = new Map<string, Turn[]>();
    const top: Turn[] = [];
    for (const t of all) {
      if (t.parentTurnId && ids.has(t.parentTurnId)) fixesOf.set(t.parentTurnId, [...(fixesOf.get(t.parentTurnId) ?? []), t]);
      else top.push(t);
    }
    return { top, fixesOf };
  }, [all]);
  const cpMap = useMemo(() => new Map((cps.data ?? []).flatMap((c) => [[c.sha, c], [c.shortSha, c]] as const)), [cps.data]);

  const active = all.find((t) => ACTIVE_STATUSES.includes(t.status) && t.status !== "queued") ?? null;
  const busy = !!active || !!project.activeTurnId;
  const label = harness?.label ?? "The agent";
  const canSteer = !!harness?.caps.steer && !!active;

  // Stay pinned to the bottom while new activity streams in, unless the reader scrolled up.
  const inner = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    const body = inner.current;
    if (!el || !body) return;
    const ro = new ResizeObserver(() => { if (stick.current) el.scrollTop = el.scrollHeight; });
    ro.observe(body);
    return () => ro.disconnect();
  }, []);

  const stop = async () => {
    if (!active) return;
    setStopping(true);
    try {
      const r = await api.cancelTurn(project.id, active.id);
      patchTurn(qc, project.id, active.id, r.turn);
    } catch (e) {
      toast({ title: "Could not stop the agent", detail: humanError(e), tone: "destructive" });
    } finally {
      setStopping(false);
    }
  };
  useEffect(() => { stopRef.current = () => void stop(); });

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    // Ask once, on the builder's own action, so a finished turn can notify a hidden tab.
    if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission().catch(() => {});
    if (active && canSteer && selections.length === 0 && images.length === 0 && !plan) {
      api.steer(project.id, active.id, text).then(
        () => { addSteered(active.id, text); setDraft(""); },
        (e) => toast({ title: "Could not send that", detail: humanError(e), tone: "destructive" }),
      );
      return;
    }
    createTurn.mutate(
      { prompt: text, selections: selections.length ? selections : undefined, images: images.length ? images.map((i) => i.file) : undefined, mode: plan ? "plan" : "build" },
      {
        onSuccess: () => { setDraft(""); setImages([]); setPlan(false); onClearSelections(); stick.current = true; },
        onError: (e) => toast({ title: "Could not send that", detail: humanError(e), tone: "destructive" }),
      },
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        className="relative min-h-0 flex-1 overflow-y-auto"
        onScroll={(e) => {
          // Only the reader unpins (wheel, keys, dragging the bar); growth below never does.
          const el = e.currentTarget;
          const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          if (near) stick.current = true;
          setShowJump(!near && !stick.current);
        }}
        onWheel={(e) => { if (e.deltaY < 0) { stick.current = false; } }}
        onKeyDown={(e) => { if (["ArrowUp", "PageUp", "Home"].includes(e.key)) stick.current = false; }}
        onPointerDown={(e) => { if (e.target === e.currentTarget) stick.current = false; }}
      >
        <div ref={inner} className="flex flex-col gap-6 px-3 pb-4 pt-4">
          {turnsQ.hasNextPage && (
            <div className="flex justify-center">
              <Button size="sm" variant="ghost" loading={turnsQ.isFetchingNextPage} onClick={() => { stick.current = false; void turnsQ.fetchNextPage(); }}>Load earlier turns</Button>
            </div>
          )}
          {turnsQ.isLoading ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="ml-auto h-10 w-3/4 rounded-xl" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-16 w-full rounded-lg" />
            </div>
          ) : turnsQ.isError ? (
            <LoadError what="The conversation" error={turnsQ.error} onRetry={() => turnsQ.refetch()} />
          ) : top.length === 0 ? (
            <div className="flex flex-col items-center gap-1 px-6 pt-16 text-center">
              <p className="text-13 font-medium">Describe the first change</p>
              <p className="text-xs text-muted-foreground">{label} writes the code in this project's folder. Every change becomes a version you can restore.</p>
            </div>
          ) : (
            top.map((t) => (
              <TurnView
                key={t.id}
                projectId={project.id}
                turn={t}
                fixes={fixesOf.get(t.id) ?? []}
                harnessLabel={label}
                checkpoints={cpMap}
                openErrors={errors.data ?? []}
                busy={busy}
                onRestore={setRestoring}
                onView={onViewVersion}
              />
            ))
          )}
        </div>
      </div>
      {showJump && (
        <div className="relative">
          <button
            type="button"
            onClick={() => { const el = scroller.current; if (el) { el.scrollTop = el.scrollHeight; stick.current = true; setShowJump(false); } }}
            className="fade-in absolute -top-11 left-1/2 inline-flex h-7 -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-card px-2.5 text-11 font-medium shadow-pop hover:bg-card-hover"
          >
            <ArrowDown className="size-3" /> Latest
          </button>
        </div>
      )}
      <Composer
        value={draft}
        onChange={setDraft}
        onSubmit={send}
        busy={busy}
        canSteer={canSteer && selections.length === 0}
        onStop={stop}
        stopping={stopping}
        selections={selections}
        onRemoveSelection={onRemoveSelection}
        focusRef={focusRef}
        disabled={harness && !harness.bin && harness.id !== "replay" ? `${label} is not installed. Pick another agent in the top bar.` : null}
        plan={plan}
        onPlan={setPlan}
        canPlan={!!harness?.caps.plan}
        images={images}
        onAttach={(f) => void attach(f)}
        onRemoveImage={(file) => setImages((cur) => cur.filter((i) => i.file !== file))}
        attaching={attaching}
      />
      <RestoreDialog projectId={project.id} checkpoint={restoring} onClose={() => setRestoring(null)} busy={busy} />
    </div>
  );
}
