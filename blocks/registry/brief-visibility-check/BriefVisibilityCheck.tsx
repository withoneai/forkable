import { useState } from "react";
import clsx from "clsx";
import { OneClientError, oneFetch, type OneMeta } from "../lib/one-client";
import { Button, ErrorState, Skeleton, SourceChip } from "../lib/one-ui";
import { ENGINES, ENGINE_LABELS, type CheckResponse, type EngineAnswer, type EngineId, type Position } from "../brief/types";

export interface BriefVisibilityCheckProps {
  defaultPrompt?: string;
  /** Called with each finished check, for example to save it. */
  onResult?: (result: CheckResponse) => void;
  className?: string;
}

const ORDER: Record<Position, string> = { first: "Named first", listed: "Listed", buried: "Buried", not_mentioned: "Not named" };

/** One prompt across four engines on the user's own accounts, judged by Jev. Runs only from its button. */
export function BriefVisibilityCheck({ defaultPrompt = "", onResult, className }: BriefVisibilityCheckProps) {
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [engines, setEngines] = useState<EngineId[]>([...ENGINES]);
  const [res, setRes] = useState<{ data: CheckResponse; meta: OneMeta } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<OneClientError | null>(null);

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await oneFetch<CheckResponse>("/api/brief/check", { method: "POST", body: { prompt, engines } });
      setRes(r);
      onResult?.(r.data);
    } catch (e) {
      setErr(e instanceof OneClientError ? e : new OneClientError(0, "network", String(e)));
    } finally {
      setBusy(false);
    }
  };
  const toggle = (e: EngineId) => setEngines((xs) => (xs.includes(e) ? xs.filter((x) => x !== e) : [...xs, e]));

  return (
    <div data-block="brief-visibility-check" className={clsx("flex min-h-0 flex-col gap-4 overflow-y-auto p-4 [&>*]:shrink-0", className)}>
      <div className="flex flex-col gap-2">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={2}
          placeholder="A question a buyer would ask, without your brand in it"
          className="resize-none rounded-lg border border-border bg-raised px-3 py-2 text-13 text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-strong focus:border-strong"
        />
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-0.5 rounded-md border border-border bg-foreground/4 p-0.5">
            {ENGINES.map((e) => (
              <button
                key={e}
                onClick={() => toggle(e)}
                aria-pressed={engines.includes(e)}
                className={clsx("h-6 rounded-sm px-2 text-xs font-medium transition-colors", engines.includes(e) ? "bg-raised text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground")}
              >
                {ENGINE_LABELS[e]}
              </button>
            ))}
          </div>
          <Button variant="primary" onClick={run} disabled={busy || !prompt.trim() || engines.length === 0} className="ml-auto">
            {busy ? "Asking" : `Ask ${engines.length} engine${engines.length === 1 ? "" : "s"}`}
          </Button>
        </div>
        <span className="text-11 text-muted-foreground">
          Runs on your own {engines.map((e) => ENGINE_LABELS[e]).join(", ") || "engine"} account{engines.length === 1 ? "" : "s"}: {engines.length} answer{engines.length === 1 ? "" : "s"}, then {engines.length} Jev judgment{engines.length === 1 ? "" : "s"}. Nothing runs until you press the button.
        </span>
      </div>

      {err && <ErrorState error={err} onRetry={run} />}
      {busy && (
        <div className="grid gap-3 md:grid-cols-2">
          {engines.map((e) => (
            <Skeleton key={e} className="h-32 w-full" />
          ))}
        </div>
      )}
      {res && !busy && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="text-13 text-foreground">
              <span className="font-semibold">{res.data.brand.name}</span> is named by {res.data.visibility} of {res.data.answers.filter((a) => a.ok).length} engines
            </span>
            <span className="ml-auto">
              <SourceChip meta={res.meta} />
            </span>
          </div>
          {res.data.note && <span className="text-11 text-muted-foreground">{res.data.note} "{res.data.prompt}"</span>}
          <div className="grid gap-3 md:grid-cols-2">
            {res.data.answers.map((a) => (
              <AnswerCard key={a.engine} a={a} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AnswerCard({ a }: { a: EngineAnswer }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-raised p-3">
      <div className="flex items-center gap-2">
        <span className="text-13 font-semibold text-foreground">{ENGINE_LABELS[a.engine]}</span>
        {a.ok && (
          <span className={clsx("ml-auto inline-flex h-5 items-center gap-1 rounded-sm px-1.5 text-10 font-medium", a.mentioned ? "bg-primary text-primary-foreground" : "bg-foreground/8 text-muted-foreground")}>
            {ORDER[a.position === "not_mentioned" && a.mentioned ? "listed" : a.position]}
          </span>
        )}
      </div>
      {!a.ok ? (
        <span className="text-xs text-danger">{a.error}</span>
      ) : (
        <>
          <dl className="grid grid-cols-[5rem_1fr] gap-x-2 gap-y-1 text-11">
            <dt className="text-muted-foreground">Tone</dt>
            <dd className="text-foreground capitalize">{a.mentioned ? a.sentiment : "n/a"}</dd>
            <dt className="text-muted-foreground">Recommended</dt>
            <dd className="text-foreground">{a.recommended ? "Yes" : "No"}</dd>
            <dt className="text-muted-foreground">Competitors</dt>
            <dd className="truncate text-foreground">{a.competitorsNamed.join(", ") || "None named"}</dd>
            <dt className="text-muted-foreground">Cited</dt>
            <dd className="truncate text-foreground">{a.citations.map((c) => c.domain).join(", ") || "No sources"}</dd>
          </dl>
          <p className={clsx("text-xs leading-relaxed text-muted-foreground", !open && "line-clamp-3")}>{a.text}</p>
          <button onClick={() => setOpen((o) => !o)} className="self-start text-11 text-foreground hover:text-accent">
            {open ? "Show less" : "Read the answer"}
          </button>
        </>
      )}
    </div>
  );
}
