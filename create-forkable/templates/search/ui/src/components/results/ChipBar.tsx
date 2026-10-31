import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Bookmark, Check, ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import type { ItemKind, OperatorKey, SearchResponse } from "@/contract/api-types";
import { applyChip, opValues, parseQuery } from "@/contract/query";
import { useEntityOptions } from "./entityOptions";
import { cn, platformName } from "@/lib/utils";
import { SourceLogo } from "@/components/SourceLogo";
import { useAccounts } from "@/lib/accounts";
import { Avatar } from "@/components/ui/Avatar";

export interface ChipOption { value: string; label: string; count?: number; icon?: ReactNode }
interface ChipDef { key: OperatorKey; label: string; any: string; options: ChipOption[]; single?: boolean; fixed?: boolean; preset?: string[] }

const DATE_OPTIONS: ChipOption[] = [
  { value: "today", label: "Today" }, { value: "7d", label: "Last 7 days" }, { value: "30d", label: "Last 30 days" },
  { value: "this-month", label: "This month" }, { value: "last-month", label: "Last month" }, { value: "1y", label: "Last year" },
];
const DATE_LABEL: Record<string, string> = Object.fromEntries(DATE_OPTIONS.map((o) => [o.value, o.label]));

/** Type-specific chips that appear with their scope tab (search-ux-mobbin.md 2.3). */
function typeChips(scope: ItemKind | "all", typed: string[]): ChipDef[] {
  const k = scope !== "all" ? scope : typed.length === 1 ? ({ mail: "email_thread", email: "email_thread", deal: "deal", issue: "task", task: "task", event: "event", meeting: "meeting_note" } as Record<string, ItemKind>)[typed[0]!] : undefined;
  switch (k) {
    case "email_thread": return [
      { key: "has", label: "Has", any: "Attachment", options: [{ value: "attachment", label: "Has attachment" }], single: true },
      { key: "is", label: "Is", any: "Read or unread", options: [{ value: "unread", label: "Unread" }, { value: "needs-you", label: "Needs you" }, { value: "waiting", label: "Waiting" }] },
    ];
    case "task": return [
      { key: "status", label: "Status", any: "Any", options: ["Todo", "In Progress", "In Review", "Done"].map((s) => ({ value: s, label: s })) },
      { key: "to", label: "Assignee", any: "Anyone", options: [] },
    ];
    case "deal": return [
      { key: "stage", label: "Stage", any: "Any", options: ["Qualified", "Discovery", "Negotiation", "Contract sent", "Closed won"].map((s) => ({ value: s, label: s })) },
      { key: "is", label: "Owner", any: "Anyone", options: [{ value: "mine", label: "Mine" }, { value: "open", label: "Open" }] },
    ];
    case "event": case "meeting_note": return [
      { key: "from", label: "Organizer", any: "Anyone", options: [] },
      { key: "is", label: "When", any: "Upcoming or past", options: [{ value: "upcoming", label: "Upcoming" }, { value: "past", label: "Past" }], single: true },
    ];
    default: return [];
  }
}

/**
 * The chip bar is a view over the box: every chip reads its operator out of
 * parseQuery(q) and every edit goes back through applyChip(q, edit). There is
 * no second filter state, so a typed operator lights its chip and a chip
 * writes its operator into the box.
 */
export function ChipBar({ q, data, scope, onChange, onSave, filterOpen, setFilterOpen }: {
  q: string; data: SearchResponse | undefined; scope: ItemKind | "all"; onChange: (q: string) => void; onSave: () => void;
  filterOpen: boolean; setFilterOpen: (v: boolean) => void;
}) {
  const parsed = useMemo(() => parseQuery(q), [q]);
  const ENTITY_OPTIONS = useEntityOptions();
  const accounts = useAccounts();
  const srcCounts = data?.counts.source ?? {};
  const people = ENTITY_OPTIONS.filter((e) => e.type === "person");
  const personOpts: ChipOption[] = [{ value: "me", label: "Me", icon: <Avatar name="Me" size="xs" /> }, ...people.filter((p) => !p.self).map((p) => ({ value: p.short, label: p.name, icon: <Avatar name={p.name} size="xs" /> }))];
  const withOpts: ChipOption[] = [...personOpts.slice(1), ...ENTITY_OPTIONS.filter((e) => e.type === "company" && !e.self).map((c) => ({ value: c.short, label: c.name, icon: <Avatar name={c.name} size="xs" className="rounded-sm" /> }))];
  const fixed: ChipDef[] = [
    { key: "source", label: "Source", any: "All", fixed: true, options: [...new Set([...Object.keys(srcCounts), ...opValues(parsed, "source")])].sort((a, b) => (srcCounts[b] ?? 0) - (srcCounts[a] ?? 0)).map((p) => ({ value: p, label: platformName(p), count: srcCounts[p], icon: <SourceLogo platform={p} size={14} /> })) },
    // only when a platform has two accounts (two Gmails): pick which
    ...(accounts.multi.length ? [{ key: "account" as const, label: "Account", any: "All", fixed: true, options: accounts.multi.map((a) => ({ value: a.label, label: a.label, count: undefined, icon: <SourceLogo platform={a.platform} size={14} /> })) }] : []),
    { key: "from", label: "From", any: "Anyone", fixed: true, options: personOpts },
    { key: "with", label: "With", any: "Anyone", fixed: true, options: withOpts },
    { key: "after", label: "Date", any: "Any time", fixed: true, single: true, options: DATE_OPTIONS },
  ];
  const typed = opValues(parsed, "type");
  const extra = typeChips(scope, typed).map((c) => (c.options.length ? c : { ...c, options: personOpts }));
  const all = [...fixed, ...extra];
  const active = parsed.clauses.some((c) => c.kind === "op");

  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5" data-testid="chip-bar">
      {all.map((c) => (
        <FilterChip key={`${c.key}-${c.label}`} def={c} values={opValues(parsed, c.key)} onSet={(vals) => onChange(applyChip(q, { key: c.key, values: vals }))} />
      ))}
      {opValues(parsed, "type").length > 0 && <SetChip label="Type" value={opValues(parsed, "type").join(", ")} onClear={() => onChange(applyChip(q, { key: "type", values: null }))} />}
      {opValues(parsed, "lane").length > 0 && <SetChip label="Lane" value={opValues(parsed, "lane").join(", ")} onClear={() => onChange(applyChip(q, { key: "lane", values: null }))} />}
      <AddFilter open={filterOpen} setOpen={setFilterOpen} q={q} onChange={onChange} defs={all} />
      {active && (
        <>
          <button type="button" onClick={() => onChange(parsed.clauses.filter((c) => c.kind !== "op").map((c) => (c.kind === "or" ? "OR" : c.kind === "phrase" ? `${c.negate ? "-" : ""}"${c.value}"` : `${c.negate ? "-" : ""}${c.value}`)).join(" "))}
            className="inline-flex h-7 items-center rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-card-hover hover:text-foreground">Clear</button>
          <button type="button" onClick={onSave} className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-card-hover hover:text-foreground"><Bookmark className="size-3.5" />Save</button>
        </>
      )}
    </div>
  );
}

function SetChip({ label, value, onClear }: { label: string; value: string; onClear: () => void }) {
  return (
    <span className="inline-flex h-7 items-center rounded-md bg-muted text-xs text-foreground">
      <span className="pl-2.5 text-muted-foreground">{label}:</span>
      <span className="pl-1 pr-1.5 font-medium">{value}</span>
      <button type="button" aria-label={`Remove ${label}`} onClick={onClear} className="flex h-7 w-6 items-center justify-center rounded-r-md text-muted-foreground hover:bg-card-hover hover:text-foreground"><X className="size-3" /></button>
    </span>
  );
}

function FilterChip({ def, values, onSet }: { def: ChipDef; values: string[]; onSet: (v: string[] | null) => void }) {
  const [open, setOpen] = useState(false);
  const set = values.length > 0;
  const shown = !set ? def.any
    : values.length === 1 ? (def.key === "source" ? platformName(values[0]!) : def.key === "after" ? DATE_LABEL[values[0]!] ?? values[0]! : def.options.find((o) => o.value.toLowerCase() === values[0]!.toLowerCase())?.label ?? values[0]!)
    : `${values.length} ${def.key === "source" ? "sources" : def.key === "from" || def.key === "with" ? "people" : "values"}`;
  const icon = set && values.length === 1 ? def.options.find((o) => o.value.toLowerCase() === values[0]!.toLowerCase())?.icon : null;
  return (
    <Popover open={open} setOpen={setOpen} anchor={
      <span title={set ? undefined : `${def.label}: ${shown}`} className={cn("inline-flex h-7 items-center rounded-md border text-xs transition-colors", set ? "border-transparent bg-muted text-foreground" : "border-dashed border-border-strong text-muted-foreground hover:border-solid hover:bg-card-hover hover:text-foreground")}>
        <button type="button" onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open} data-chip={def.key} className="inline-flex h-full items-center gap-1.5 pl-2.5 pr-2">
          {icon && <span className="flex [&>*]:shrink-0">{icon}</span>}
          {/* an unset chip is just its name ("From"), so four of them fit on one line beside the preview */}
          <span className={cn(set && "text-muted-foreground")}>{def.label}{set ? ":" : ""}</span>
          {set && <span className="font-medium">{shown}</span>}
          {!set && <ChevronDown className="size-3 opacity-60" />}
        </button>
        {set && <button type="button" aria-label={`Remove ${def.label}`} onClick={() => onSet(null)} className="flex h-full w-6 items-center justify-center rounded-r-md border-l border-background/60 text-muted-foreground hover:bg-card-hover hover:text-foreground"><X className="size-3" /></button>}
      </span>
    }>
      <OptionList options={def.options} selected={values} single={def.single} onPick={(v) => {
        const has = values.some((x) => x.toLowerCase() === v.toLowerCase());
        if (def.single) { onSet(has ? null : [v]); setOpen(false); return; }
        const next = has ? values.filter((x) => x.toLowerCase() !== v.toLowerCase()) : [...values, v];
        onSet(next.length ? next : null);
      }} />
    </Popover>
  );
}

function OptionList({ options, selected, onPick, single }: { options: ChipOption[]; selected: string[]; onPick: (v: string) => void; single?: boolean }) {
  const [f, setF] = useState("");
  const [i, setI] = useState(0);
  const list = options.filter((o) => !f || o.label.toLowerCase().includes(f.toLowerCase()) || o.value.toLowerCase().includes(f.toLowerCase()));
  return (
    <div className="flex w-[240px] flex-col">
      {options.length > 6 && (
        <input autoFocus value={f} onChange={(e) => { setF(e.target.value); setI(0); }} placeholder="Filter" aria-label="Filter options"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { setI((v) => Math.min(list.length - 1, v + 1)); e.preventDefault(); }
            if (e.key === "ArrowUp") { setI((v) => Math.max(0, v - 1)); e.preventDefault(); }
            if (e.key === "Enter" && list[i]) { onPick(list[i]!.value); e.preventDefault(); }
          }}
          className="mb-1 h-8 border-b border-border bg-transparent px-2.5 text-13 outline-none placeholder:text-muted-foreground/60" />
      )}
      <div role="listbox" aria-multiselectable={!single} className="max-h-[280px] overflow-y-auto p-1">
        {list.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground">Nothing to pick here yet.</p>}
        {list.map((o, idx) => {
          const on = selected.some((x) => x.toLowerCase() === o.value.toLowerCase());
          return (
            <button key={o.value} type="button" role="option" aria-selected={on} onMouseEnter={() => setI(idx)} onClick={() => onPick(o.value)}
              className={cn("flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-13", idx === i && "bg-muted")}>
              <span className={cn("flex size-3.5 shrink-0 items-center justify-center rounded-sm border", on ? "border-foreground bg-foreground text-background" : "border-border-strong")}>{on && <Check className="size-2.5 stroke-[3]" />}</span>
              {o.icon && <span className="flex shrink-0">{o.icon}</span>}
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {o.count != null && <span className="tnum text-11 text-muted-foreground">{o.count}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** `+ Filter` (F): a cascading menu, key first, then its values. */
function AddFilter({ open, setOpen, q, onChange, defs }: { open: boolean; setOpen: (v: boolean) => void; q: string; onChange: (q: string) => void; defs: ChipDef[] }) {
  const [key, setKey] = useState<ChipDef | null>(null);
  useEffect(() => { if (!open) setKey(null); }, [open]);
  const more: ChipDef[] = [
    { key: "type", label: "Type", any: "", options: ["mail", "event", "meeting", "person", "company", "doc", "issue", "message", "deal", "note"].map((t) => ({ value: t, label: t[0]!.toUpperCase() + t.slice(1) })) },
    { key: "lane", label: "Lane", any: "", options: [["vip", "VIPs"], ["needs-you", "Needs you"], ["waiting", "Waiting"], ["fyi", "FYI"], ["low", "Low"]].map(([v, l]) => ({ value: v!, label: l! })) },
    { key: "is", label: "Is", any: "", options: ["unread", "vip", "needs-you", "waiting", "mine", "open", "upcoming", "past"].map((t) => ({ value: t, label: t })) },
    { key: "has", label: "Has", any: "", options: ["attachment", "link", "joinurl", "transcript"].map((t) => ({ value: t, label: t })) },
    { key: "before", label: "Before", any: "", single: true, options: DATE_OPTIONS },
    { key: "to", label: "To", any: "", options: defs.find((d) => d.key === "from")?.options ?? [] },
  ];
  const keys = [...defs.filter((d) => d.fixed), ...more];
  const parsed = parseQuery(q);
  const listRef = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(0);
  useEffect(() => { if (open && !key) setTimeout(() => listRef.current?.focus(), 0); }, [open, key]);
  return (
    <Popover open={open} setOpen={setOpen} anchor={
      <button type="button" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} data-testid="add-filter"
        className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-card-hover hover:text-foreground">
        <Plus className="size-3.5" />Filter
      </button>
    }>
      {key ? (
        <OptionList options={key.options} selected={opValues(parsed, key.key)} single={key.single} onPick={(v) => {
          const cur = opValues(parsed, key.key);
          const has = cur.some((x) => x.toLowerCase() === v.toLowerCase());
          const next = key.single ? (has ? [] : [v]) : has ? cur.filter((x) => x.toLowerCase() !== v.toLowerCase()) : [...cur, v];
          onChange(applyChip(q, { key: key.key, values: next.length ? next : null }));
          if (key.single) setOpen(false);
        }} />
      ) : (
        <div ref={listRef} tabIndex={-1} role="menu" className="w-[200px] p-1 outline-none"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "j") { setI((v) => Math.min(keys.length - 1, v + 1)); e.preventDefault(); }
            if (e.key === "ArrowUp" || e.key === "k") { setI((v) => Math.max(0, v - 1)); e.preventDefault(); }
            if (e.key === "Enter" || e.key === "ArrowRight") { setKey(keys[i]!); e.preventDefault(); }
          }}>
          {keys.map((k, idx) => (
            <button key={`${k.key}-${k.label}`} type="button" role="menuitem" onMouseEnter={() => setI(idx)} onClick={() => setKey(k)}
              className={cn("flex h-7 w-full items-center justify-between rounded-md px-2 text-left text-13", idx === i && "bg-muted")}>
              <span>{k.label}</span>
              <span className="flex items-center gap-1 font-mono text-11 text-muted-foreground">{k.key}:<ChevronRight className="size-3" /></span>
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

export function Popover({ open, setOpen, anchor, children, align = "start" }: { open: boolean; setOpen: (v: boolean) => void; anchor: ReactNode; children: ReactNode; align?: "start" | "end" }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); setOpen(false); } };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey, true); };
  }, [open, setOpen]);
  return (
    <div ref={ref} className="relative inline-flex">
      {anchor}
      {open && (
        <div className={cn("pop-in absolute top-full z-40 mt-1 overflow-hidden rounded-lg border border-border bg-card shadow-pop", align === "end" ? "right-0" : "left-0")}>
          {children}
        </div>
      )}
    </div>
  );
}
