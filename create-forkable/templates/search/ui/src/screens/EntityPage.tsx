import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Search as SearchIcon } from "lucide-react";
import type { ResultRow } from "@/contract/api-types";
import { useEntity } from "@/lib/queries";
import { cn, fmtRelative, KIND_LABEL, platformName } from "@/lib/utils";

const pctOf = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0);
import { SourceLogo } from "@/components/SourceLogo";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { LoadError } from "@/components/ui/EmptyState";
import { Matches } from "@/components/entity/Matches";

/**
 * One timeline line. A chat message is titled by its channel ("#acme-globex"), which says
 * nothing on its own, so it shows what was said first, then who said it and where.
 */
function TimelineText({ r }: { r: ResultRow }) {
  const chat = r.kind === "message" && !!r.snippet && (r.platform === "slack" || r.platform === "teams" || r.title.startsWith("#"));
  if (chat) {
    const who = r.people.find((p) => p.role === "author")?.name ?? r.context?.split(" · ").slice(-1)[0] ?? null;
    const ch = (r.facets as { channel?: string }).channel;
    const where = r.title || (ch ? `#${ch}` : null);
    return (
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate" title={r.snippet ?? undefined}>{r.snippet}</span>
        <span className="truncate text-11 text-muted-foreground">{[who, where && `in ${where}`].filter(Boolean).join(" ")}</span>
      </span>
    );
  }
  return (
    <>
      <span className="min-w-0 flex-1 truncate">{r.title}</span>
      {r.context && <span className="hidden max-w-[30%] truncate text-xs text-muted-foreground md:inline">{r.context}</span>}
    </>
  );
}

/** /people/:id and /companies/:id: the relationship card and a timeline by source (SPEC 15.1). */
export function EntityPage() {
  const { entityId } = useParams();
  const q = useEntity(entityId ?? null);
  const nav = useNavigate();
  const [src, setSrc] = useState<string | null>(null);
  const d = q.data;
  // a row kept in two tools (a person in Slack, Attio and HubSpot) counts for each tool it is in
  const timeline = useMemo(() => (d?.timeline ?? []).filter((r) => !src || r.platform === src || (r.alsoIn ?? []).includes(src)), [d, src]);

  if (q.isError) return <LoadError what="This person" error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />;
  if (!d) return <div className="mx-auto flex w-full max-w-[880px] flex-col gap-4 px-6 pt-7"><Skeleton className="h-20 w-full rounded-lg" /><Skeleton className="h-64 w-full rounded-lg" /></div>;
  const e = d.entity;
  const total = e.sources.reduce((n, s) => n + s.count, 0);
  // The header says the number every card that opens this page shows (e.itemCount). The
  // timeline counts its own rows and says what makes them differ, when they do.
  const rows = d.timeline.length;
  // the header's number already has a company's people's items; the reasons below are why the rows are fewer
  const timelineNote = [
    rows >= 50 && "only the newest 50",
    "copies kept in two tools shown once",
    e.type === "person" ? "their own contact records left out" : "its own records left out",
  ].filter(Boolean).join(", ");

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[880px] flex-col gap-6 px-6 pb-12 pt-6">
        <button type="button" onClick={() => nav(-1)} className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3" />Back</button>
        <header className="flex items-start gap-4">
          <Avatar name={e.name} src={e.avatarUrl} size="lg" className={cn("size-12 text-13", e.type === "company" && "rounded-lg")} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-center gap-2"><h1 className="text-xl font-semibold tracking-tight">{e.name}</h1>{e.isSelf && <Badge tone="outline">You</Badge>}</div>
            <p className="text-13 text-muted-foreground">
              {[e.title, e.company?.name].filter(Boolean).join(" at ")}{e.domain && e.type === "company" ? e.domain : ""}
            </p>
            {e.emails.length > 0 && <p className="text-xs text-muted-foreground">{e.emails.join(" · ")}</p>}
          </div>
          <Button variant="primary" icon={<SearchIcon />} onClick={() => nav(`/?q=${encodeURIComponent(`with:"${e.name}"`)}`)}>Search everything about {e.name.split(" ")[0]}</Button>
        </header>

        <section className="flex flex-col gap-2">
          <p className="label-caps" data-testid="entity-count">Found in {e.sources.length} {e.sources.length === 1 ? "tool" : "tools"} · {e.itemCount} {e.itemCount === 1 ? "item" : "items"}</p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setSrc(null)} className={cn("inline-flex h-7 items-center rounded-md px-2.5 text-xs transition-colors", !src ? "bg-muted font-medium" : "text-muted-foreground hover:bg-card-hover")}>All</button>
            {e.sources.map((s) => (
              <button key={s.platform} type="button" onClick={() => setSrc(src === s.platform ? null : s.platform)}
                className={cn("inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors", src === s.platform ? "border-transparent bg-muted font-medium" : "border-border hover:bg-card-hover")}>
                <SourceLogo platform={s.platform} size={14} />{platformName(s.platform)}<span className="tnum text-muted-foreground">{s.count}</span>
                <span className="relative h-1 w-8 overflow-hidden rounded-full bg-border"><span className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${pctOf(s.count, total)}%` }} /></span>
              </button>
            ))}
          </div>
        </section>

        <Matches detail={d} />

        <section className="flex flex-col" aria-label="Timeline">
          <p className="label-caps mb-1.5" data-testid="timeline-count">Timeline · {rows >= 50 ? "newest 50" : rows}</p>
          {rows !== e.itemCount && <p className="-mt-1 mb-1.5 text-11 text-muted-foreground" data-testid="timeline-note">One line per thing, so not {e.itemCount}: {timelineNote}.</p>}
          <ol className="relative flex flex-col border-l border-border pl-4">
            {timeline.map((r) => (
              <li key={r.id} className="relative" data-testid="timeline-row" data-kind={r.kind} data-title={r.title}>
                <span aria-hidden className="absolute -left-[calc(1rem+3.5px)] top-3.5 size-1.5 rounded-full bg-border-strong" />
                <Link to={`/item/${r.id}?q=${encodeURIComponent(`with:"${e.name}"`)}`} className="flex min-h-9 items-center gap-2.5 rounded-md px-2 py-1.5 text-13 transition-colors hover:bg-card-hover">
                  <SourceLogo platform={r.platform} size={14} />
                  <span className="w-16 shrink-0 text-11 text-muted-foreground">{KIND_LABEL[r.kind]}</span>
                  <TimelineText r={r} />
                  <span className="tnum w-14 shrink-0 text-right text-11 text-muted-foreground">{fmtRelative(r.occurredAt)}</span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
