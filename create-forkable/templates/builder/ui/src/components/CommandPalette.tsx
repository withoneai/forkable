import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CornerDownLeft, FolderOpen, Keyboard, Moon, Plus, Settings } from "lucide-react";
import { useCommandList, type Command } from "@/lib/commands";
import { useProjects } from "@/lib/queries";
import { toggleTheme } from "@/lib/theme";
import { cn, fmtAgo, MOD } from "@/lib/utils";
import { Keys } from "./ui/Kbd";
import { Badge } from "./ui/Badge";

const GROUPS: Command["group"][] = ["Project", "Versions", "Agent", "Go to", "App"];

function score(c: Command, q: string): number {
  if (!q) return 1;
  const hay = `${c.label} ${c.detail ?? ""}`.toLowerCase();
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  let s = 0;
  for (const w of words) {
    const i = hay.indexOf(w);
    if (i < 0) return 0;
    s += i === 0 ? 3 : hay[i - 1] === " " ? 2 : 1;
  }
  return s;
}

export function CommandPalette({ open, onClose, onCheatsheet }: { open: boolean; onClose: () => void; onCheatsheet: () => void }) {
  const nav = useNavigate();
  const registered = useCommandList();
  const projects = useProjects();
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) { setQ(""); setI(0); setTimeout(() => input.current?.focus(), 0); }
  }, [open]);
  useEffect(() => { setI(0); }, [q]);

  const items = useMemo(() => {
    const global: Command[] = [
      { id: "new", group: "App", label: "New project", icon: <Plus />, run: () => nav("/") },
      { id: "settings", group: "App", label: "Open settings", icon: <Settings />, run: () => nav("/settings") },
      { id: "theme", group: "App", label: "Toggle dark mode", icon: <Moon />, run: toggleTheme },
      { id: "keys", group: "App", label: "Keyboard shortcuts", icon: <Keyboard />, keys: "?", run: onCheatsheet },
      ...(projects.data?.projects ?? []).filter((p) => !p.archivedAt).map((p) => ({
        id: `p-${p.id}`, group: "Go to" as const, label: p.name, detail: `Edited ${fmtAgo(p.updatedAt)}`, icon: <FolderOpen />, run: () => nav(`/p/${p.id}`),
      })),
    ];
    const all = [...registered, ...global];
    const query = q.trim();
    return all
      .map((c) => ({ c, s: score(c, query) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => GROUPS.indexOf(a.c.group) - GROUPS.indexOf(b.c.group) || (query ? b.s - a.s : 0))
      .map((x) => x.c);
  }, [registered, projects.data, q, nav, onCheatsheet]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-idx="${i}"]`)?.scrollIntoView({ block: "nearest" });
  }, [i]);

  // Esc closes even before focus lands in the field (or after a click elsewhere in the panel).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;
  const sel = items[i];
  const runIt = (c: Command | undefined) => {
    if (!c || c.disabled) return;
    onClose();
    setTimeout(c.run, 0);
  };

  return (
    <div className="fade-in fixed inset-0 z-50 flex items-start justify-center bg-foreground/15 px-4 pt-[12vh] dark:bg-background/70" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Command palette" className="pop-in w-full max-w-[600px] overflow-hidden rounded-xl border border-border bg-card shadow-float">
        <div className="flex h-12 items-center gap-2 border-b border-border px-4">
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Type a command or a project name"
            aria-label="Command"
            className="h-full flex-1 bg-transparent text-13 outline-none placeholder:text-muted-foreground/60"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { setI((v) => Math.min(items.length - 1, v + 1)); e.preventDefault(); }
              else if (e.key === "ArrowUp") { setI((v) => Math.max(0, v - 1)); e.preventDefault(); }
              else if (e.key === "Enter") { e.preventDefault(); runIt(sel); }
              else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
            }}
          />
          <Keys combo={`${MOD} K`} />
        </div>
        <div ref={list} className="max-h-[52vh] overflow-y-auto p-1.5" role="listbox">
          {items.length === 0 && <p className="px-3 py-6 text-center text-13 text-muted-foreground">Nothing matches.</p>}
          {GROUPS.map((g) => {
            const rows = items.filter((it) => it.group === g);
            if (!rows.length) return null;
            return (
              <div key={g} className="mb-1">
                <p className="label-caps px-2 pb-1 pt-2">{g}</p>
                {rows.map((it) => {
                  const idx = items.indexOf(it);
                  const active = idx === i;
                  return (
                    <button
                      key={it.id}
                      type="button"
                      role="option"
                      data-idx={idx}
                      aria-selected={active}
                      aria-disabled={it.disabled || undefined}
                      onMouseMove={() => setI(idx)}
                      onClick={() => runIt(it)}
                      className={cn("flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-13 transition-colors duration-75", active && "bg-muted", it.disabled && "opacity-50")}
                    >
                      <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-3.5 [&>svg]:stroke-[1.75]">{it.icon}</span>
                      <span className="truncate">{it.label}</span>
                      {it.detail && <span className="truncate text-xs text-muted-foreground">{it.detail}</span>}
                      <span className="ml-auto flex shrink-0 items-center gap-1.5">
                        {it.disabled && <Badge tone="outline">Later</Badge>}
                        {it.keys ? <Keys combo={it.keys} /> : active ? <CornerDownLeft className="size-3 text-muted-foreground" /> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="flex h-8 items-center gap-3 border-t border-border bg-faint px-4 text-11 text-muted-foreground">
          <span>Arrow keys move, Enter runs</span>
          <span className="ml-auto flex items-center gap-1"><Keys combo="Esc" /> close</span>
        </div>
      </div>
    </div>
  );
}
