// What Search read from a sentence (D48): each phrase it took as a filter is a
// chip with a one-click remove, and a phrase that could mean two things offers
// its choices. The box text never changes on its own: removing a chip quotes the
// phrase (quoted words are searched as words, never read as a filter), and a
// choice writes that filter in place of the phrase.
import { Building2, CalendarDays, CircleDot, Shapes, User, X } from "lucide-react";
import type { SearchResponse, Understood, UnderstandChoice } from "@/contract/api-types";
import { keepWords, takeChoice } from "@/contract/query";
import { SourceLogo } from "@/components/SourceLogo";
import { cn } from "@/lib/utils";

function KindIcon({ kind, filter }: { kind: Understood["kind"]; filter: string }) {
  const cls = "size-3.5 shrink-0 text-muted-foreground";
  if (kind === "source") return <SourceLogo platform={filter.replace(/^in:/, "").split(",")[0] ?? ""} size={14} />;
  if (kind === "person") return <User className={cls} />;
  if (kind === "company") return <Building2 className={cls} />;
  if (kind === "date") return <CalendarDays className={cls} />;
  if (kind === "type") return <Shapes className={cls} />;
  return <CircleDot className={cls} />;
}

/** The chips and choices that belong to this text: a page for another text (still loading, or saved) never shows its chips over this one. */
export function understoodFor(q: string, data: SearchResponse | undefined) {
  const fits = (x: { phrase: string; start: number; end: number }) => q.slice(x.start, x.end) === x.phrase;
  return { understood: (data?.understood ?? []).filter(fits), suggestions: (data?.suggestions ?? []).filter(fits) };
}

/**
 * The row sits right after the box in the Tab order (the box's Tab moves here), and
 * every remove, choice and "exact words" is a plain button: Enter and Space work on
 * it like a click. `onChange` hands focus back to the box.
 */
export function UnderstoodBar({ q, data, onChange }: { q: string; data: SearchResponse | undefined; onChange: (q: string) => void }) {
  const { understood, suggestions } = understoodFor(q, data);
  if (!understood.length && !suggestions.length) return null;
  return (
    <div className="flex flex-col gap-1.5" data-testid="understood">
      {understood.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="pr-0.5 text-xs text-muted-foreground">Understood as</span>
          {understood.map((u) => (
            <span key={`${u.start}-${u.filter}`} data-understood={u.kind} title={`From your words “${u.phrase}”`}
              className="inline-flex h-7 items-center rounded-md bg-muted text-xs text-foreground">
              <span className="inline-flex items-center gap-1.5 pl-2 pr-1.5 font-medium"><KindIcon kind={u.kind} filter={u.filter} />{u.label}</span>
              <button type="button" aria-label={`Remove ${u.label}`} onClick={() => onChange(keepWords(q, [u]))}
                className="flex h-7 w-6 items-center justify-center rounded-r-md border-l border-background/60 text-muted-foreground transition-colors hover:bg-card-hover hover:text-foreground">
                <X className="size-3" />
              </button>
            </span>
          ))}
          <button type="button" data-testid="exact-words" onClick={() => onChange(keepWords(q, understood))}
            className="inline-flex h-7 items-center rounded-md px-1.5 text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline">
            Search the exact words instead
          </button>
        </div>
      )}
      {suggestions.map((s) => (
        <div key={`${s.start}-${s.phrase}`} className="flex flex-wrap items-center gap-1.5" data-testid="understand-choices">
          <span className="pr-0.5 text-xs text-muted-foreground">Did you mean</span>
          {s.choices.map((c: UnderstandChoice, i) => (
            <button key={`${c.filter}-${i}`} type="button" onClick={() => onChange(takeChoice(q, s, c.filter))} title={c.filter}
              className={cn("inline-flex h-7 items-center gap-1.5 rounded-md border border-dashed border-border-strong px-2 text-xs text-foreground transition-colors hover:border-solid hover:bg-card-hover")}>
              <KindIcon kind={c.kind} filter={c.filter} />
              <span className="font-medium">{c.label}</span>
              {c.detail && <span className="text-muted-foreground">{c.detail}</span>}
            </button>
          ))}
          <span className="text-xs text-muted-foreground">for “{s.phrase}”</span>
        </div>
      ))}
    </div>
  );
}
