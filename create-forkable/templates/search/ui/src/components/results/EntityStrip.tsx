import { useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import type { EntityChip } from "@/contract/api-types";
import { Avatar } from "@/components/ui/Avatar";
import { LogoStack } from "@/components/SourceLogo";

/** People and companies that match strongly, above the list (max 3). "Everything about Priya" is the commonest personal search. */
export function EntityStrip({ chips, onSearch }: { chips: EntityChip[]; onSearch: (name: string) => void }) {
  const nav = useNavigate();
  return (
    <div className="flex gap-2 overflow-x-auto px-3 pt-3 scrollbar-none" data-testid="entity-strip">
      {chips.slice(0, 3).map((c) => (
        <div key={c.id} className="group flex min-w-[220px] max-w-[300px] flex-1 items-center gap-2.5 rounded-lg border border-border bg-card p-2 pr-1 transition-colors hover:border-border-strong">
          <button type="button" onClick={() => nav(`/${c.type === "person" ? "people" : "companies"}/${c.id}`)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
            <Avatar name={c.name} src={c.avatarUrl ?? c.logoUrl} size="lg" className={c.type === "company" ? "rounded-md" : undefined} />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-13 font-medium">{c.name}</span>
              <span className="flex items-center gap-1.5 text-11 text-muted-foreground"><span className="truncate">{c.subtitle}</span></span>
              <span className="flex items-center gap-1.5 text-11 text-muted-foreground"><LogoStack platforms={c.sources} size={12} /><span className="tnum">{c.itemCount} {c.itemCount === 1 ? "item" : "items"}</span></span>
            </span>
          </button>
          <button type="button" onClick={() => onSearch(c.name)} title={`Search everything about ${c.name}`} aria-label={`Search everything about ${c.name}`} className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-card-hover hover:text-foreground">
            <ChevronRight className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
