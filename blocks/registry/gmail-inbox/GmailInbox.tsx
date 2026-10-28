import { useEffect, useState } from "react";
import { Search, Star } from "lucide-react";
import clsx from "clsx";
import { timeAgo, useOneQuery } from "../lib/one-client";
import { ErrorState, Skeleton, SourceChip } from "../lib/one-ui";
import type { MailThread } from "../gmail/types";

type View = "inbox" | "unread" | "starred" | "sent";
const VIEWS: { id: View; label: string }[] = [
  { id: "inbox", label: "Inbox" },
  { id: "unread", label: "Unread" },
  { id: "starred", label: "Starred" },
  { id: "sent", label: "Sent" },
];

export interface GmailInboxProps {
  selectedId?: string | null;
  onSelect?: (thread: MailThread) => void;
  /** Bump to refetch, for example after an archive. */
  refreshKey?: number;
  limit?: number;
  className?: string;
}

/** The signed-in user's Gmail threads, with views and search. Reads on their grant. */
export function GmailInbox({ selectedId, onSelect, refreshKey = 0, limit = 25, className }: GmailInboxProps) {
  const [view, setView] = useState<View>("inbox");
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  const { data, meta, loading, error, reload } = useOneQuery<MailThread[]>(
    `/api/gmail/threads?view=${view}&limit=${limit}&q=${encodeURIComponent(q)}&r=${refreshKey}`,
  );

  return (
    <div data-block="gmail-inbox" className={clsx("flex min-h-0 flex-col", className)}>
      <div className="flex flex-col gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <div role="tablist" aria-label="Mailbox" className="inline-flex items-center gap-0.5 rounded-md border border-border bg-foreground/4 p-0.5">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              role="tab"
              aria-selected={view === v.id}
              className={clsx("h-6 rounded-sm px-2 text-xs font-medium transition-colors", view === v.id ? "bg-raised text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground")}
            >
              {v.label}
            </button>
          ))}
          </div>
          <span className="ml-auto">
            <SourceChip meta={meta} />
          </span>
        </div>
        <label className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-raised px-2.5 text-muted-foreground transition-colors hover:border-strong focus-within:border-strong focus-within:text-foreground focus-within:ring-3 focus-within:ring-primary/35">
          <Search className="size-3.5 shrink-0" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search mail" className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground" />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && !data ? (
          <div className="flex flex-col gap-3 p-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-3 w-5/6" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="p-3">
            <ErrorState error={error} onRetry={reload} />
          </div>
        ) : data && data.length === 0 ? (
          <p className="p-3 text-13 text-muted-foreground">{q ? `Nothing matches "${q}".` : "All clear."}</p>
        ) : (
          <ul>
            {data?.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => onSelect?.(t)}
                  className={clsx(
                    "relative flex w-full flex-col gap-0.5 border-b border-border px-3 py-2.5 text-left transition-colors focus-visible:-outline-offset-2",
                    selectedId === t.id ? "bg-foreground/6 before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent" : "hover:bg-foreground/4",
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <span className={clsx("size-1.5 shrink-0 rounded-full", t.unread ? "bg-accent" : "bg-transparent")} />
                    <span className={clsx("truncate text-13", t.unread ? "font-semibold text-foreground" : "text-foreground")}>{t.from.name}</span>
                    {t.count > 1 && <span className="text-11 text-muted-foreground">{t.count}</span>}
                    {t.starred && <Star className="size-3 shrink-0 fill-current text-muted-foreground" />}
                    <span className="ml-auto shrink-0 text-11 text-muted-foreground">{timeAgo(t.date)}</span>
                  </div>
                  <div className="truncate pl-3 text-13">
                    <span className={t.unread ? "font-medium text-foreground" : "text-foreground"}>{t.subject}</span>
                    <span className="text-muted-foreground"> {t.snippet}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
