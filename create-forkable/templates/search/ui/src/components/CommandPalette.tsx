import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Bookmark, Clock, Keyboard, MessageCircle, Moon, Plus, RefreshCw, Search as SearchIcon, Settings, ShieldCheck, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { keys, useRecent, useSaved, useSources } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { cn, fmtRelative, KIND_LABEL, MOD, platformName, useDebounced } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";
import { SourceLogo } from "./SourceLogo";
import { Keys, Kbd } from "./ui/Kbd";

type Group = "Jump to" | "Searches" | "Sources" | "Actions" | "Ask";
interface Item { id: string; group: Group; label: string; detail?: string; icon?: React.ReactNode; keys?: string; run: () => void; url?: string | null; mono?: boolean }

const COACHED = "search.coached";

/** The palette (search-ux-mobbin.md 2.7): jump to items, searches, sources, actions, and always a last row that asks. */
export function CommandPalette({ open, onClose, onToggleTheme, onCheatsheet }: { open: boolean; onClose: () => void; onToggleTheme: () => void; onCheatsheet: () => void }) {
  const nav = useNavigate();
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const dq = useDebounced(q.trim(), 120);
  const recent = useRecent();
  const saved = useSaved();
  const sources = useSources();
  const jump = useQuery({ queryKey: ["palette", dq], queryFn: ({ signal }) => api.search({ q: dq, limit: 6 }, signal), enabled: open && dq.length > 1, staleTime: 10_000 });

  useEffect(() => { if (open) { setQ(""); setI(0); setTimeout(() => input.current?.focus(), 0); } }, [open]);
  useEffect(() => { setI(0); }, [dq]);

  const coach = (k?: string) => {
    if (!k) return;
    let seen: string[] = [];
    try { seen = JSON.parse(localStorage.getItem(COACHED) ?? "[]") as string[]; } catch { /* ignore */ }
    if (seen.includes(k)) return;
    try { localStorage.setItem(COACHED, JSON.stringify([...seen, k])); } catch { /* ignore */ }
    setTimeout(() => toast({ title: `Next time: ${k.replace(/(^|[^⌘⇧⌥⌃]) (?=\S)/g, "$1 then ")}`, ttl: 3500 }), 200);
  };

  const items = useMemo<Item[]>(() => {
    const ql = q.trim().toLowerCase();
    const match = (s: string) => !ql || s.toLowerCase().includes(ql);
    const out: Item[] = [];
    for (const r of (jump.data?.results ?? []).slice(0, 6)) {
      out.push({ id: `j-${r.id}`, group: "Jump to", label: r.title, detail: `${KIND_LABEL[r.kind]} · ${r.sourceName} · ${fmtRelative(r.occurredAt)}`, icon: <SourceLogo platform={r.platform} size={14} />, url: r.url,
        run: () => { nav(`/item/${r.id}?q=${encodeURIComponent(q.trim())}`); } });
    }
    const searches = [
      ...(saved.data ?? []).map((s, n) => ({ id: `s-${s.id}`, group: "Searches" as const, label: s.name, detail: s.query, icon: <Bookmark />, keys: n < 9 ? `G ${n + 1}` : undefined, run: () => ws.setQuery(s.query) })),
      ...(recent.data ?? []).slice(0, 5).map((r) => ({ id: `r-${r.query}`, group: "Searches" as const, label: r.query, mono: /\w:/.test(r.query), detail: `${r.resultCount} results`, icon: <Clock />, run: () => ws.setQuery(r.query) })),
    ].filter((s) => match(s.label) || match(s.detail ?? ""));
    out.push(...(ql ? searches.slice(0, 4) : searches.slice(0, 6)));
    const plats = new Map<string, string>();
    for (const s of sources.data?.sources ?? []) if (!plats.has(s.platform)) plats.set(s.platform, s.id);
    out.push(...[...plats.entries()].filter(([p]) => match(platformName(p))).slice(0, ql ? 4 : 0).map(([p, id]) => ({ id: `src-${p}`, group: "Sources" as const, label: platformName(p), detail: "Source detail", icon: <SourceLogo platform={p} size={14} />, run: () => nav(`/sources/${id}`) })));
    const actions: Item[] = [
      { id: "a-new", group: "Actions", label: "New profile", detail: "Index another platform", icon: <Plus />, keys: "N", run: () => nav("/settings/integrations/new") },
      { id: "a-sync", group: "Actions", label: "Sync all sources", icon: <RefreshCw />, run: () => {
        const list = sources.data?.sources ?? [];
        void Promise.allSettled(list.map((s) => api.syncSource(s.id))).then(() => { void qc.invalidateQueries({ queryKey: keys.sources }); toast({ title: `Syncing ${list.length} sources` }); });
      } },
      { id: "a-dock", group: "Actions", label: ws.dockOpen ? "Close the assistant" : "Open the assistant", icon: <MessageCircle />, keys: `${MOD} J`, run: () => ws.setDockOpen(!ws.dockOpen) },
      { id: "a-home", group: "Actions", label: "Go home", icon: <SearchIcon />, keys: "G H", run: () => nav("/") },
      { id: "a-int", group: "Actions", label: "Go to Integrations", icon: <ArrowRight />, keys: "G I", run: () => nav("/settings/integrations") },
      { id: "a-access", group: "Actions", label: "Go to Access", icon: <ShieldCheck />, keys: "G A", run: () => nav("/access") },
      { id: "a-settings", group: "Actions", label: "Go to Settings", icon: <Settings />, keys: "G ,", run: () => nav("/settings/general") },
      { id: "a-theme", group: "Actions", label: "Toggle dark mode", icon: <Moon />, run: onToggleTheme },
      { id: "a-keys", group: "Actions", label: "Keyboard shortcuts", icon: <Keyboard />, keys: "?", run: onCheatsheet },
    ];
    out.push(...actions.filter((a) => match(a.label)).slice(0, ql ? 4 : 9));
    if (ql) {
      out.unshift({ id: "search", group: "Jump to", label: `Search for “${q.trim()}”`, icon: <SearchIcon />, run: () => ws.setQuery(q.trim()) });
      out.push({ id: "ask", group: "Ask", label: `Ask: “${q.trim()}”`, icon: <Sparkles />, keys: "Tab", run: () => ws.askAbout(undefined, q.trim()) });
    }
    return out;
  }, [q, jump.data, saved.data, recent.data, sources.data, nav, ws, onToggleTheme, onCheatsheet, qc]);

  if (!open) return null;
  const groups: Group[] = ["Jump to", "Searches", "Sources", "Actions", "Ask"];
  const ordered = groups.flatMap((g) => items.filter((it) => it.group === g));
  const sel = ordered[i];
  const run = (it: Item | undefined, typedShortcut = true) => { if (!it) return; it.run(); onClose(); if (typedShortcut && it.group === "Actions") coach(it.keys && it.keys !== "?" ? it.keys : undefined); };

  return (
    <div className="fade-in fixed inset-0 z-50 flex items-start justify-center bg-foreground/15 px-4 pt-[10vh] dark:bg-background/70" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Command palette" data-testid="palette" className="pop-in w-full max-w-[600px] overflow-hidden rounded-xl border border-border bg-card shadow-float">
        <div className="flex h-12 items-center gap-2.5 border-b border-border px-4">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Jump to anything, run a command, or ask"
            aria-label="Command"
            className="h-full flex-1 bg-transparent text-13 outline-none placeholder:text-muted-foreground/60"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { setI((v) => Math.min(ordered.length - 1, v + 1)); e.preventDefault(); }
              else if (e.key === "ArrowUp") { setI((v) => Math.max(0, v - 1)); e.preventDefault(); }
              else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (sel?.url) { window.open(sel.url, "_blank", "noopener"); onClose(); } }
              else if (e.key === "Enter") { e.preventDefault(); run(sel); }
              else if (e.key === "Tab" && q.trim()) { e.preventDefault(); run(ordered.find((x) => x.id === "ask"), false); }
              else if (e.key === "Escape") { e.preventDefault(); onClose(); }
            }}
          />
          <Keys combo={`${MOD} K`} />
        </div>
        <div className="max-h-[56vh] overflow-y-auto p-1.5" role="listbox">
          {ordered.length === 0 && <p className="px-3 py-6 text-center text-13 text-muted-foreground">Nothing matches.</p>}
          {groups.map((g) => {
            const rows = ordered.filter((it) => it.group === g);
            if (!rows.length) return null;
            return (
              <div key={g} className="mb-1">
                <p className="label-caps px-2 pb-1 pt-2">{g}</p>
                {rows.map((it) => {
                  const idx = ordered.indexOf(it);
                  const active = idx === i;
                  return (
                    <button key={it.id} type="button" role="option" aria-selected={active} onMouseEnter={() => setI(idx)} onClick={() => run(it, false)}
                      className={cn("flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-13 transition-colors duration-75", active && "bg-muted")}>
                      <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-3.5 [&>svg]:stroke-[1.75]">{it.icon}</span>
                      <span className={cn("truncate", it.mono && "font-mono text-xs")}>{it.label}</span>
                      {it.detail && <span className={cn("truncate text-xs text-muted-foreground", it.group === "Searches" && "font-mono text-11")}>{it.detail}</span>}
                      <span className="ml-auto shrink-0">{it.keys ? <Keys combo={it.keys} /> : null}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="flex h-8 items-center gap-3 border-t border-border bg-faint px-4 text-11 text-muted-foreground">
          <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> Navigate</span>
          <span className="flex items-center gap-1"><Kbd>↵</Kbd> Open</span>
          <span className="flex items-center gap-1"><Kbd>{MOD}↵</Kbd> Open in source app</span>
          <span className="flex items-center gap-1"><Kbd>Tab</Kbd> Ask</span>
          <span className="ml-auto flex items-center gap-1"><Kbd>Esc</Kbd> Close</span>
        </div>
      </div>
    </div>
  );
}
