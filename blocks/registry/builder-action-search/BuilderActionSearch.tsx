import { useEffect, useState } from "react";
import { Check, Copy, Plus, Search } from "lucide-react";
import clsx from "clsx";
import { useOneQuery } from "../lib/one-client";
import { Button, ErrorState, Skeleton, SourceChip } from "../lib/one-ui";
import type { CatalogAction, CatalogDoc } from "../builder/types";

export interface BuilderActionSearchProps {
  defaultPlatform?: string;
  defaultQuery?: string;
  /** Called with the action the user picks, for example to add it to a manifest. */
  onPick?: (action: CatalogDoc) => void;
  className?: string;
}

const PLATFORMS = ["slack", "stripe", "notion", "gmail", "hubspot", "github", "google-calendar", "linear"];

/** One's action catalog: search in words, then read the docs of one action. */
export function BuilderActionSearch({ defaultPlatform = "slack", defaultQuery = "send a message to a channel", onPick, className }: BuilderActionSearchProps) {
  const [platform, setPlatform] = useState(defaultPlatform);
  const [query, setQuery] = useState(defaultQuery);
  const [q, setQ] = useState(defaultQuery);
  useEffect(() => {
    const t = setTimeout(() => setQ(query), 300);
    return () => clearTimeout(t);
  }, [query]);
  const list = useOneQuery<CatalogAction[]>(`/api/builder/actions?platform=${encodeURIComponent(platform)}&q=${encodeURIComponent(q)}`);
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => setPicked(list.data?.[0]?.actionId ?? null), [list.data]);
  const doc = useOneQuery<CatalogDoc>(picked ? `/api/builder/actions/${encodeURIComponent(picked)}` : null);
  const [copied, setCopied] = useState(false);

  return (
    <div data-block="builder-action-search" className={clsx("flex min-h-0 flex-col", className)}>
      <div className="flex flex-col gap-2 border-b border-border p-3">
        <div className="flex items-center gap-2">
          <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="h-8 rounded-md border border-border bg-raised px-2 text-13 text-foreground outline-none transition-colors hover:border-strong focus:border-strong">
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <label className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border bg-raised px-2.5 text-muted-foreground transition-colors hover:border-strong focus-within:border-strong focus-within:text-foreground">
            <Search className="size-3.5 shrink-0" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="What should it do?" className="min-w-0 flex-1 bg-transparent text-13 text-foreground outline-none placeholder:text-muted-foreground" />
          </label>
          <SourceChip meta={list.meta} />
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="min-h-0 overflow-y-auto border-r border-border">
          {list.loading && !list.data ? (
            <div className="flex flex-col gap-2 p-3">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : list.error ? (
            <div className="p-3">
              <ErrorState error={list.error} onRetry={list.reload} />
            </div>
          ) : list.data?.length === 0 ? (
            <p className="p-3 text-13 text-muted-foreground">No action matches. Try other words.</p>
          ) : (
            <ul>
              {list.data?.map((a) => (
                <li key={a.actionId}>
                  <button onClick={() => setPicked(a.actionId)} className={clsx("flex w-full flex-col gap-0.5 border-b border-border px-3 py-2 text-left transition-colors", picked === a.actionId ? "bg-card" : "hover:bg-card/60")}>
                    <span className="truncate text-13 text-foreground">{a.title}</span>
                    <span className="flex items-center gap-1.5 font-mono text-10 text-muted-foreground">
                      <span className="text-foreground/80">{a.method}</span>
                      <span className="truncate">{a.path}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex min-h-0 flex-col">
          {doc.loading && !doc.data ? (
            <div className="flex flex-col gap-2 p-3">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : doc.error ? (
            <div className="p-3">
              <ErrorState error={doc.error} onRetry={doc.reload} />
            </div>
          ) : doc.data ? (
            <>
              <div className="flex flex-col gap-1.5 border-b border-border p-3">
                <span className="text-13 font-semibold text-foreground">{doc.data.title}</span>
                <span className="flex items-center gap-1.5 font-mono text-11 text-muted-foreground">
                  <span className="rounded-sm bg-foreground/8 px-1 text-foreground">{doc.data.method}</span>
                  {doc.data.path}
                </span>
                <div className="flex items-center gap-1.5">
                  <code className="min-w-0 flex-1 truncate font-mono text-10 text-muted-foreground">{doc.data.actionId}</code>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      navigator.clipboard.writeText(doc.data!.actionId);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1200);
                    }}
                  >
                    {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    {copied ? "Copied" : "Copy id"}
                  </Button>
                  {onPick && (
                    <Button size="sm" onClick={() => onPick(doc.data!)}>
                      <Plus className="size-3.5" />
                      Use it
                    </Button>
                  )}
                </div>
              </div>
              <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-3 font-mono text-11 leading-relaxed text-foreground/90">{doc.data.knowledge}</pre>
            </>
          ) : (
            <p className="p-3 text-13 text-muted-foreground">Pick an action to read its docs.</p>
          )}
        </div>
      </div>
    </div>
  );
}
