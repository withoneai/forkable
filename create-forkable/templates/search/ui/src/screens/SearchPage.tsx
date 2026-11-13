import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, ArrowUpDown, ChevronDown, Clock, Plus, RefreshCw, Shuffle, Sparkles } from "lucide-react";
import type { AnswerResponse, ItemKind, ResultRow, SearchResponse } from "@/contract/api-types";
import { applyChip, freeText, isQuestion, keepWords, opValues, parseQuery } from "@/contract/query";
import { api } from "@/lib/api";
import { useKeys } from "@/lib/keys";
import { keys as qk, useMe, useRecent, useSaveSearch, useSearch, useSources } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { cn, fmtNum, fmtRelative, LANE_OP, MOD, platformName, SCOPES, useMedia } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";
import { cacheKey, dropCached, patchAnswer, patchCached, readCached, saveSearch } from "@/lib/searchCache";
import { SearchBox, type SearchBoxHandle } from "@/components/results/SearchBox";
import { ChipBar } from "@/components/results/ChipBar";
import { UnderstoodBar, understoodFor } from "@/components/results/UnderstoodBar";
import { FirstIndex, useExamples } from "@/components/results/HomeHelp";
import { ResultRowView } from "@/components/results/ResultRow";
import { EntityStrip } from "@/components/results/EntityStrip";
import { AnswerStrip, answerKey } from "@/components/results/AnswerStrip";
import { PreviewPane } from "@/components/preview/PreviewPane";
import { HealthDot, rollup } from "@/components/Shell";
import { SourceLogo } from "@/components/SourceLogo";
import { Menu } from "@/components/ui/Menu";
import { Kbd } from "@/components/ui/Kbd";
import { Skeleton } from "@/components/ui/Skeleton";
import { LoadError } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { COPY, meaningOffReason, MEANING_DB_REASON } from "@/lib/copy";

export function SearchPage() {
  const ws = useWorkspace();
  const box = useRef<SearchBoxHandle>(null);
  const [params, setParams] = useSearchParams();
  const routeId = useParams().id ?? null;
  const q = ws.query;
  const scope = (params.get("scope") ?? "all") as ItemKind | "all";
  const sort = params.get("sort") ?? "best";

  useEffect(() => { ws.boxFocus.current = () => box.current?.focus(); }, [ws.boxFocus]);
  useEffect(() => { if (routeId) ws.select(routeId, { open: true }); }, [routeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const ask = (text: string) => ws.askAbout(undefined, text || undefined);
  if (!q.trim() && !routeId) return <Home box={box} onCommit={ws.setQuery} onAsk={ask} />;
  return <Results box={box} q={q} scope={scope} sort={sort} setParam={(k, v) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n, { replace: true }); }} onAsk={ask} />;
}

// ---- home ---------------------------------------------------------------------

function Home({ box, onCommit, onAsk }: { box: React.RefObject<SearchBoxHandle | null>; onCommit: (q: string, o?: { replace?: boolean }) => void; onAsk: (q: string) => void }) {
  const recent = useRecent();
  const sources = useSources();
  const me = useMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [shuffle, setShuffle] = useState(0);
  const examples = useExamples();
  const [tip, setTip] = useState(0);
  const list = sources.data?.sources ?? [];
  const total = list.reduce((n, s) => n + s.health.itemCount, 0);
  const byPlatform = new Map<string, typeof list>();
  for (const s of list) byPlatform.set(s.platform, [...(byPlatform.get(s.platform) ?? []), s]);
  useEffect(() => { const t = setInterval(() => setTip((x) => x + 1), 8000); return () => clearInterval(t); }, []);

  // three plain sentences from the person's own people and tools; the tip line walks the rest
  const tries = examples.length ? [0, 1, 2].map((i) => examples[(i + shuffle * 3) % examples.length]!).filter((x, i, a) => a.indexOf(x) === i) : [];
  const tipText = examples.length ? examples[(tip + 3) % examples.length]! : "emails from me last week";

  const groups = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const y = new Date(today.getTime() - 86_400_000);
    const out: { label: string; rows: { query: string; at: string; resultCount: number }[] }[] = [{ label: "Today", rows: [] }, { label: "Yesterday", rows: [] }, { label: "Earlier", rows: [] }];
    // eight at most, and never a search that found nothing
    for (const r of (recent.data ?? []).filter((x) => x.resultCount > 0).slice(0, 8)) { const t = new Date(r.at); out[t >= today ? 0 : t >= y ? 1 : 2]!.rows.push(r); }
    return out.filter((g) => g.rows.length);
  }, [recent.data]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-6 px-6 pb-16 pt-[14vh]">
        <div className="slide-up flex flex-col gap-2">
          <SearchBox ref={box} value="" onCommit={onCommit} onAsk={onAsk} size="home" autoFocus
            />
          {/* one hint: how to type it and how to ask, with one example (the box itself says nothing more) */}
          <p className="px-1 text-11 text-muted-foreground" data-testid="tip">
            Type it the way you would say it, like{" "}
            <button type="button" onClick={() => onCommit(tipText)} className="text-foreground/80 underline-offset-2 hover:text-foreground hover:underline">“{tipText}”</button>
            . To ask a question instead, press {MOD} Enter.
          </p>
        </div>

        {sources.isError ? (
          <LoadError what="Your sources" error={sources.error} onRetry={() => void sources.refetch()} retrying={sources.isFetching} className="rounded-lg border border-border" />
        ) : list.length === 0 && sources.data ? (
          <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border-strong p-5">
            <p className="text-13">Search reads the tools you connect. Add one to start.</p>
            <div className="flex flex-wrap gap-2">
              {["gmail", "hubspot", "slack", "notion", "linear", "google-calendar"].map((p) => (
                <Link key={p} to="/settings/integrations/new" className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-card px-2.5 text-xs transition-colors hover:bg-card-hover"><SourceLogo platform={p} size={14} />{platformName(p)}</Link>
              ))}
            </div>
            <div><Button size="sm" onClick={() => void api.sampleSources().then(() => qc.invalidateQueries())}>Try the Acme sample</Button></div>
          </div>
        ) : (
          <>
            <FirstIndex sources={list} />
            {groups.length > 0 && (
              <section className="flex flex-col gap-1" aria-label="Recent">
                <div className="flex items-center justify-between px-1">
                  <p className="label-caps">Recent</p>
                  <button type="button" onClick={() => void api.clearRecent().then(() => qc.invalidateQueries({ queryKey: qk.recent }))} className="text-11 text-muted-foreground hover:text-foreground">Clear</button>
                </div>
                {groups.map((g) => (
                  <div key={g.label} className="flex flex-col">
                    <p className="px-1 pb-0.5 pt-1.5 text-11 text-muted-foreground/80">{g.label}</p>
                    {g.rows.map((r) => (
                      <button key={r.query} type="button" onClick={() => onCommit(r.query)} className="group flex h-8 items-center gap-2.5 rounded-md px-2 text-left text-13 transition-colors hover:bg-card-hover">
                        <Clock className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate"><QueryText q={r.query} /></span>
                        <span className="tnum text-11 text-muted-foreground">{r.resultCount} {r.resultCount === 1 ? "result" : "results"} · {fmtRelative(r.at)}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </section>
            )}
            {total > 0 && tries.length > 0 && (
              <section className="flex flex-col gap-2" aria-label="Try">
                <div className="flex items-center justify-between px-1">
                  <p className="label-caps">Try</p>
                  <button type="button" aria-label="Shuffle suggestions" onClick={() => setShuffle((s) => s + 1)} className="text-muted-foreground hover:text-foreground"><Shuffle className="size-3.5" /></button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {tries.map((t) => (
                    <button key={t} type="button" data-testid="try" onClick={() => onCommit(t)} className="inline-flex h-7 items-center rounded-md border border-border bg-card px-2.5 text-xs transition-colors hover:border-border-strong hover:bg-card-hover">{t}</button>
                  ))}
                </div>
              </section>
            )}
            <section className="flex flex-col gap-2" aria-label="Sources">
              <div className="flex items-center justify-between px-1">
                <p className="label-caps">Sources</p>
                <span className="tnum text-11 text-muted-foreground">{fmtNum(total)} items</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[...byPlatform.entries()].map(([p, l]) => {
                  const r = rollup(l);
                  const syncing = l.find((s) => s.health.status === "syncing" && s.health.progress);
                  return (
                    <Link key={p} to={`/sources/${l[0]!.id}`} className="relative inline-flex h-8 items-center gap-2 overflow-hidden rounded-md border border-border bg-card px-2.5 text-xs transition-colors hover:border-border-strong hover:bg-card-hover" title={syncing ? `Updating ${platformName(p)}, ${syncing.health.progress!.done} of about ${syncing.health.progress!.estimate ?? "many"}` : undefined}>
                      <SourceLogo platform={p} size={14} />
                      <span>{platformName(p)}</span>
                      <HealthDot status={r.status} />
                      <span className="tnum text-muted-foreground">{fmtNum(r.items)}</span>
                      {syncing?.health.progress?.estimate ? <span className="absolute inset-x-0 bottom-0 h-0.5 bg-accent" style={{ width: `${(syncing.health.progress.done / syncing.health.progress.estimate) * 100}%` }} /> : null}
                    </Link>
                  );
                })}
                <button type="button" onClick={() => nav("/settings/integrations/new")} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-dashed border-border-strong px-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground"><Plus className="size-3.5" />Add a source</button>
              </div>
              {me.data?.settings?.embedding.provider === "local" && <p className="px-1 text-11 text-muted-foreground">{COPY.meaningSample}</p>}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

// ---- results ------------------------------------------------------------------

function Results({ box, q, scope, sort, setParam, onAsk }: {
  box: React.RefObject<SearchBoxHandle | null>; q: string; scope: ItemKind | "all"; sort: string; setParam: (k: string, v: string | null) => void; onAsk: (q: string) => void;
}) {
  const ws = useWorkspace();
  const me = useMe();
  const qc = useQueryClient();
  const uid = me.data?.user?.id ?? null;

  // Saved results (lib/searchCache): a page from the last 30 minutes renders at once, with
  // its Jev order and answer, and no search, rerank or answer call. `rev` moves on Refresh.
  const ck = cacheKey(q, scope, sort);
  const [rev, setRev] = useState(0);
  const freshPending = useRef(false);
  const cached = useMemo(() => (uid ? readCached(uid, ck) : null), [uid, ck, rev]);
  const [applied, setApplied] = useState<{ k: string; res: SearchResponse } | null>(null);
  const appliedRes = applied?.k === ck ? applied.res : null;
  const fromCache = !appliedRes && !!cached;
  const search = useSearch(q, sort, scope, !!uid && !cached && !appliedRes, { rev, fresh: () => freshPending.current });
  const saveSearchM = useSaveSearch();
  const data = appliedRes ?? cached?.search ?? search.data;
  const placeholder = !fromCache && !appliedRes && search.isPlaceholderData;
  const rows = useMemo(() => data?.results ?? [], [data]);
  const [rr, setRr] = useState<{ queryId: string; order: string[] } | null>(null);
  const order = rr && rr.queryId === data?.queryId ? rr.order : fromCache && cached?.order ? cached.order : null;
  const [check, setCheck] = useState<{ k: string; at: number; res: SearchResponse; n: number } | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const tabRow = useRef<HTMLDivElement>(null);
  const [tabRowWidth, setTabRowWidth] = useState(0);
  useEffect(() => {
    const el = tabRow.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setTabRowWidth(Math.round(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [saving, setSaving] = useState(false);
  const [laneChord, setLaneChord] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  // Tab from the box goes to the understood chips first (D48)
  const focusChips = () => { const b = chipsRef.current?.querySelector<HTMLElement>("button"); if (!b) return false; b.focus(); return true; };
  const movedSince = useRef(false);
  const wide = useMedia("(min-width: 1440px)"); // list, preview and dock side by side need about 1440px; below that the preview takes over the list while the dock is open
  const takeoverMode = !wide && ws.dockOpen;
  const [takeover, setTakeover] = useState(false);

  // Hand the results to the dock (it cites and counts them).
  useEffect(() => { if (data) ws.setResults(data); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // A page fresh from the server goes into the browser store, with the answer if it came first.
  useEffect(() => {
    if (!uid || !search.data || search.isPlaceholderData || cached || appliedRes) return;
    saveSearch(uid, ck, search.data, { answer: qc.getQueryData<AnswerResponse>(answerKey(q, rev)) ?? null });
  }, [search.data?.queryId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rerank (D30): a second request; the new order only lands when the user has
  // not moved the selection off the first row since the results came in. A saved
  // page carries its order and makes no call, unless Jev ran past its budget last
  // time (the server stored the late scores, so asking again costs no Jev call).
  useEffect(() => {
    movedSince.current = false;
    if (!data?.queryId || data.results.length < 2 || placeholder) return;
    if (fromCache && (cached?.order || cached?.rerankReason !== "timeout")) return;
    let live = true;
    const fresh = freshPending.current;
    freshPending.current = false;
    const queryId = data.queryId;
    api.rerank(queryId, fresh).then((r) => {
      if (uid) patchCached(uid, queryId, r.reranked ? { order: r.order, rerankReason: null } : { rerankReason: r.reason ?? null });
      if (!live || !r.reranked || movedSince.current) return;
      setRr({ queryId, order: r.order });
    }).catch(() => {});
    return () => { live = false; };
  }, [data?.queryId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Quiet check: under a saved page, rerun only the cheap search (keyword and vector, no
  // Jev, no model). New results wait behind a pill; the list never moves on its own.
  useEffect(() => {
    if (!fromCache || !cached) return;
    let live = true;
    api.search({ q, sort, scope }).then((res) => {
      if (!live) return;
      const had = new Set(cached.search.results.map((r) => r.id));
      const n = res.results.filter((r) => !had.has(r.id)).length;
      setCheck({ k: ck, at: cached.at, res, n });
    }).catch(() => {});
    return () => { live = false; };
  }, [ck, cached?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  const newResults = fromCache && check?.k === ck && check.at === cached?.at && check.n > 0 ? check : null;

  const applyNew = () => {
    if (!newResults || !uid) return;
    saveSearch(uid, ck, newResults.res, { answer: cached?.answer ?? null });
    setApplied({ k: ck, res: newResults.res });
    setCheck(null);
  };
  // Refresh skips every cache: the browser store, the server's query vector and the stored Jev scores.
  const refresh = () => {
    if (uid) dropCached(uid, ck);
    freshPending.current = true;
    setApplied(null);
    setCheck(null);
    setRr(null);
    setRev((r) => r + 1);
  };
  const onAnswer = (a: AnswerResponse) => { if (uid) patchAnswer(uid, q, a); };

  // the rows the words match best, then the rest under a divider, collapsed until opened (polish item 7)
  const [restOpen, setRestOpen] = useState(false);
  useEffect(() => { setRestOpen(false); }, [q]);
  const top = data?.topRows && data.topRows < rows.length ? data.topRows : 0;
  const shown: ResultRow[] = useMemo(() => {
    const sorted = (list: ResultRow[]) => {
      if (!order) return list;
      const by = new Map(list.map((r) => [r.id, r]));
      return [...order.map((id) => by.get(id)).filter(Boolean) as ResultRow[], ...list.filter((r) => !order.includes(r.id))];
    };
    // the better order applies inside each part; the rows the words match stay above the divider
    if (top) return restOpen ? [...sorted(rows.slice(0, top)), ...sorted(rows.slice(top))] : sorted(rows.slice(0, top));
    return sorted(rows);
  }, [rows, order, top, restOpen]);

  // Keep a selection: the first row by default, the deep-linked or cited one when set.
  useEffect(() => {
    if (!shown.length) return;
    if (!ws.selectedId || (!shown.some((r) => r.id === ws.selectedId) && !placeholder)) {
      if (ws.selectedId && !shown.some((r) => r.id === ws.selectedId)) return; // a cited item outside the list still previews
      ws.select(shown[0]!.id);
    }
  }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps

  const idx = shown.findIndex((r) => r.id === ws.selectedId);
  const sel = idx >= 0 ? shown[idx]! : null;
  const selRow = sel ?? (ws.selectedId ? { id: ws.selectedId } as ResultRow : null);
  useEffect(() => {
    listRef.current?.querySelector(`[data-id="${ws.selectedId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [ws.selectedId]);

  const move = (d: number) => {
    if (!shown.length) return;
    movedSince.current = true;
    const n = Math.max(0, Math.min(shown.length - 1, (idx < 0 ? -1 : idx) + d));
    ws.select(shown[n]!.id, { open: ws.previewOpen });
  };
  const openSource = () => { if (sel?.url) window.open(sel.url, "_blank", "noopener"); };
  const copyLink = () => { if (sel?.url) void navigator.clipboard.writeText(sel.url).then(() => toast({ title: "Link copied", detail: sel.title })); };
  const setQ = (next: string) => { ws.setQuery(next, { replace: false }); };
  const parsed = data?.parsed ?? parseQuery(q);
  const words = freeText(parsed).replace(/"/g, "").split(/\s+/).filter((w) => w.length > 1 && !w.startsWith("-"));

  useKeys({
    j: () => move(1), arrowdown: () => move(1),
    k: () => move(-1), arrowup: () => { if (idx <= 0) box.current?.focus(); else move(-1); },
    enter: () => { if (takeoverMode) setTakeover(true); else ws.setPreviewOpen(true); },
    o: openSource, "mod+enter": openSource,
    space: () => ws.setPreviewOpen(!ws.previewOpen),
    y: copyLink,
    f: () => setFilterOpen(true),
    "shift+f": () => setQ(parsed.clauses.filter((c) => c.kind !== "op").map((c) => (c.kind === "or" ? "OR" : c.kind === "phrase" ? `"${c.value}"` : c.value)).join(" ")),
    s: () => setSaving(true),
    p: () => { const person = sel?.kind === "person" || sel?.kind === "company" ? sel.title : sel?.people.find((x) => x.role === "from" || x.role === "organizer")?.name ?? sel?.people[0]?.name; if (person) setQ(`with:"${person}"`); },
    l: () => { setLaneChord(true); setTimeout(() => setLaneChord(false), 1200); },
    escape: () => { if (takeover) setTakeover(false); else if (ws.previewOpen && sel) ws.setPreviewOpen(false); else box.current?.focus(); },
    "mod+shift+j": () => ws.askAbout(sel ? [sel] : undefined),
    "shift+r": refresh,
    ...Object.fromEntries(visibleScopes(data).slice(0, 9).map((s, i) => [String(i + 1), () => setParam("scope", s.key === "all" ? null : s.key)])),
    ...(laneChord ? Object.fromEntries((["v", "n", "w", "f", "l"] as const).map((k, i) => [k, () => { setLaneChord(false); setQ(applyChip(q, { key: "lane", values: [Object.values(LANE_OP)[i]!] })); }])) : {}),
  }, { priority: laneChord ? 2 : 1 });

  const counts = data?.counts.scope;
  const tabs = visibleScopes(data);
  const tabCount = (k: string) => (k === "all" ? data?.total : counts?.[k as keyof typeof counts]) ?? 0;
  // how many tabs fit: each is about its label and count wide; the active one always shows
  const tabSplit = useMemo(() => {
    const est = (t: (typeof tabs)[number]) => 22 + t.label.length * 7.2 + (tabCount(t.key) ? String(tabCount(t.key)).length * 6.5 + 6 : 0);
    const room = tabRowWidth - (tabRowWidth >= 560 ? 120 : 40) - 72;
    let used = 0;
    const shown: typeof tabs = [];
    const more: typeof tabs = [];
    for (const t of tabs) {
      const w = est(t);
      if (used + w <= room || shown.length === 0 || !tabRowWidth) { shown.push(t); used += w; } else more.push(t);
    }
    if (!more.length) return { shown: tabs, more };
    const active = more.find((t) => t.key === scope);
    if (active) { const last = shown.pop()!; more.splice(more.indexOf(active), 1, last); shown.push(active); }
    return { shown, more };
  }, [tabs, tabRowWidth, scope, data]); // eslint-disable-line react-hooks/exhaustive-deps
  const capability = me.data?.capability;
  const preview = ws.previewOpen && selRow && !takeoverMode;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-col gap-2 border-b border-border px-4 pb-2 pt-3">
          <SearchBox ref={box} value={q} onCommit={ws.setQuery} onAsk={onAsk} onDown={() => { listRef.current?.focus(); move(0); }}
            onTab={!placeholder && (() => { const u = understoodFor(q, data); return u.understood.length + u.suggestions.length > 0; })() ? focusChips : undefined} />
          {!placeholder && <div ref={chipsRef} className="contents"><UnderstoodBar q={q} data={data} onChange={(next) => { setQ(next); box.current?.focus({ select: false }); }} /></div>}
          <ChipBar q={q} data={data} scope={scope} onChange={setQ} onSave={() => setSaving(true)} filterOpen={filterOpen} setFilterOpen={setFilterOpen} />
          {/* tabs that do not fit go under More, so none is cut off or hidden under the sort button */}
          <div ref={tabRow} className="@container -mb-2 flex items-center gap-0.5">
          <div className="flex min-w-0 flex-1 items-center gap-0.5" role="tablist" aria-label="Scope">
            {tabSplit.shown.map((t) => {
              const i = tabs.indexOf(t);
              const active = scope === t.key;
              return (
                <button key={t.key} type="button" role="tab" aria-selected={active} title={`${i + 1}`} onClick={() => setParam("scope", t.key === "all" ? null : t.key)}
                  className={cn("relative inline-flex h-8 shrink-0 items-center gap-1.5 px-2.5 text-13 font-medium transition-colors", active ? "text-foreground after:absolute after:inset-x-2.5 after:bottom-0 after:h-[2px] after:rounded-t-full after:bg-foreground" : "text-muted-foreground hover:text-foreground")}>
                  {t.label}{tabCount(t.key) ? <span className="tnum text-11 text-muted-foreground">{tabCount(t.key)}</span> : null}
                </button>
              );
            })}
            {tabSplit.more.length > 0 && (
              <Menu open={moreOpen} onClose={() => setMoreOpen(false)}
                items={tabSplit.more.map((t) => ({ key: t.key, label: t.label, hint: tabCount(t.key) ? String(tabCount(t.key)) : undefined, onSelect: () => setParam("scope", t.key === "all" ? null : t.key) }))}
                anchor={<button type="button" data-testid="more-tabs" onClick={() => setMoreOpen(!moreOpen)} className="inline-flex h-8 shrink-0 items-center gap-1 px-2.5 text-13 font-medium text-muted-foreground transition-colors hover:text-foreground">More<ChevronDown className="size-3.5" /></button>} />
            )}
          </div>
            <div className="ml-auto flex shrink-0 items-center">
              <Menu open={sortOpen} onClose={() => setSortOpen(false)} align="end"
                items={[["best", "Best match"], ["newest", "Newest"], ["oldest", "Oldest"]].map(([k, l]) => ({ key: k!, label: l!, hint: sort === k ? "on" : undefined, onSelect: () => setParam("sort", k === "best" ? null : k!) }))}
                anchor={<button type="button" onClick={() => setSortOpen(!sortOpen)} title="Sort" className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-card-hover hover:text-foreground"><ArrowUpDown className="size-3.5" /><span className="hidden @[560px]:inline">{{ best: "Best match", newest: "Newest", oldest: "Oldest" }[sort] ?? "Best match"}</span></button>} />
            </div>
          </div>
        </div>

        {capability?.mode === "keyword" && <KeywordBanner reason={capability.reason} />}
        {data && <SemanticBanner status={data.embedder} />}

        <div ref={listRef} tabIndex={-1} role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto outline-none" data-testid="results" data-loading={!data || placeholder ? "1" : "0"}>
          {data?.parsed.errors.length ? <p className="px-4 pt-2 text-11 text-warning-text">{data.parsed.errors[0]!.message}.</p> : null}
          {isQuestion(q) && <div className="px-3 pt-3"><AnswerStrip query={q} queryId={data?.queryId ?? null} rev={rev} cached={cached?.answer ?? null} onAnswer={onAnswer} /></div>}
          {data?.entities.length ? <EntityStrip chips={data.entities} onSearch={(name) => setQ(`with:"${name}"`)} /> : null}
          {search.isError && !data ? (
            <LoadError what="Results" error={search.error} onRetry={() => void search.refetch()} retrying={search.isFetching} />
          ) : !data ? (
            <ResultSkeleton />
          ) : (
            <>
              <div className="flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1 whitespace-nowrap px-4 py-1 text-11 text-muted-foreground">
                <span className="label-caps">{fmtNum(data.total)} {data.total === 1 ? "result" : "results"}</span>
                {(data.hiddenBy?.length || data.hiddenByFilters > 0) ? <><span>·</span><HiddenBy q={q} data={data} setQ={setQ} /></> : null}
                {fromCache && cached && <SavedNote at={cached.at} onRefresh={refresh} />}
                {newResults && (
                  <button type="button" data-testid="new-results" onClick={applyNew}
                    className="fade-in inline-flex h-6 items-center gap-1 rounded-full border border-border bg-card px-2 text-11 font-medium text-foreground shadow-sm transition-colors hover:border-border-strong hover:bg-card-hover">
                    <ArrowUp className="size-3" />{newResults.n} new {newResults.n === 1 ? "result" : "results"}
                  </button>
                )}
                <span className="ml-auto min-w-0 truncate tnum" data-testid="order-note" title={`${order ? `${COPY.judgeOrdered}. ` : ""}${data.ms} ms${!data.embedder.semantic ? ", matched by words" : ""}`}>{order ? COPY.bestFirst : ""}<span className="hidden 2xl:inline">{order ? " · " : ""}{data.ms} ms{!data.embedder.semantic ? " · matched by words" : ""}</span></span>
              </div>
              <QueryNotes data={data} q={q} setQ={setQ} />
              {data.fallback === "filters" && !data.matchedWords && shown.length > 0 && <div className="px-4 pb-2"><Nearby q={q} data={data} setQ={setQ} /></div>}
              {shown.length === 0 ? (
                <Empty q={q} data={data} setQ={setQ} onAsk={() => onAsk(q)} />
              ) : (
                <div className={cn("flex flex-col pb-6 transition-opacity", placeholder && "opacity-60")}>
                  {shown.map((r, i) => (
                    <div key={r.id} className="contents">
                      {top > 0 && i === top && <RestDivider label={data.restLabel ?? "Other results"} n={data.total - top} open onToggle={() => setRestOpen(false)} />}
                      <ResultRowView row={r} index={i} selected={r.id === ws.selectedId}
                        onSelect={() => { movedSince.current = true; ws.select(r.id, { open: true }); listRef.current?.focus(); }}
                        onOpen={() => { if (r.url) window.open(r.url, "_blank", "noopener"); }} />
                    </div>
                  ))}
                  {top > 0 && !restOpen && <RestDivider label={data.restLabel ?? "Other results"} n={data.total - top} open={false} onToggle={() => setRestOpen(true)} />}
                </div>
              )}
            </>
          )}
        </div>
        {takeover && selRow && takeoverMode && (
          <PreviewPane row={sel ?? selRow} words={words} quote={ws.focusQuote} takeover onClose={() => setTakeover(false)} onNext={() => move(1)} onAsk={() => ws.askAbout(sel ? [sel] : undefined)} />
        )}
      </div>
      {preview && (
        <div className="slide-in-right w-[420px] max-w-[45%] shrink-0 border-l border-border" style={{ minWidth: 380 }}>
          <PreviewPane row={sel ?? selRow} words={words} quote={ws.focusQuote} onClose={() => ws.setPreviewOpen(false)} onNext={() => move(1)} onAsk={() => ws.askAbout(sel ? [sel] : undefined)} />
        </div>
      )}
      <SaveDialog open={saving} q={q} onClose={() => setSaving(false)} onSave={(name) => saveSearchM.mutate({ name, query: q }, { onSuccess: () => { setSaving(false); toast({ title: "Saved", detail: `${name} is in the sidebar` }); } })} />
      {laneChord && <div className="fade-in pointer-events-none fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-float">Lane: <Kbd>V</Kbd> VIPs <Kbd>N</Kbd> Needs you <Kbd>W</Kbd> Waiting <Kbd>F</Kbd> FYI <Kbd>L</Kbd> Low</div>}
    </div>
  );

  function visibleScopes(d: SearchResponse | undefined) {
    return SCOPES.filter((s) => s.key === "all" || (d?.counts.scope[s.key] ?? 0) > 0 || s.key === scope);
  }
}

/** The line between the rows the words match best and the rest: "Other messages in Slack, 53", collapsed by default. */
function RestDivider({ label, n, open, onToggle }: { label: string; n: number; open: boolean; onToggle: () => void }) {
  return (
    <button type="button" data-testid="rest-divider" aria-expanded={open} onClick={onToggle}
      className="mx-4 my-1 flex items-center gap-2 border-t border-border pt-2 text-left text-11 text-muted-foreground transition-colors hover:text-foreground">
      <ChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90")} />
      <span className="font-medium">{label}</span><span className="tnum">{fmtNum(n)}</span>
      <span className="ml-auto">{open ? "Hide" : "Show"}</span>
    </button>
  );
}

/** "Saved results from 4 min ago · Refresh ⇧R": the page came from the browser store. */
function SavedNote({ at, onRefresh }: { at: number; onRefresh: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const min = Math.floor((now - at) / 60_000);
  return (
    <span className="flex items-center gap-1.5" data-testid="saved-note" title={`Saved in this browser at ${new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Refresh runs the search, the order and the answer again.`}>
      <span>·</span>
      <span>Saved results from {min < 1 ? "just now" : `${min} min ago`}</span>
      <button type="button" data-testid="refresh-results" onClick={onRefresh} className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 font-medium text-foreground transition-colors hover:bg-card-hover">
        <RefreshCw className="size-3" />Refresh<Kbd className="ml-0.5">⇧R</Kbd>
      </button>
    </span>
  );
}

function ResultSkeleton() {
  return (
    <div role="status" aria-label="Loading results" className="flex flex-col pt-2">
      {Array.from({ length: 9 }).map((_, i) => (
        <div key={i} className="flex h-14 flex-col justify-center gap-2 px-3" style={{ opacity: Math.max(0.25, 1 - i * 0.09) }}>
          <div className="flex items-center gap-2.5"><Skeleton className="size-4 rounded-sm" /><Skeleton className="h-2.5 w-12" /><Skeleton className="h-2.5 flex-1" style={{ maxWidth: `${62 - (i % 4) * 9}%` }} /><Skeleton className="ml-auto h-2.5 w-8" /></div>
          <Skeleton className="ml-[calc(16px+5.25rem)] h-2 w-1/3 opacity-60" />
        </div>
      ))}
    </div>
  );
}

/** The box without one filter: a read phrase is kept as its words, a typed filter comes out. */
function dropFilter(q: string, h: NonNullable<SearchResponse["hiddenBy"]>[number]): string {
  if (h.phrase !== null && h.start !== null && h.end !== null) return keepWords(q, [{ phrase: h.phrase, start: h.start, end: h.end }]);
  return q.split(/(\s+)/).filter((w) => w.trim() !== h.filter).join("").replace(/\s+/g, " ").trim();
}

/**
 * Which filter hides how many, each with a one-click drop, right by the count. "Hides N" always
 * means the same thing: dropping that filter adds N results. With two filters or more, "All
 * filters hide N" is what clearing them all adds; with one, its own button says it.
 */
function HiddenBy({ q, data, setQ }: { q: string; data: SearchResponse; setQ: (q: string) => void }) {
  const list = (data.hiddenBy ?? []).slice(0, 3);
  const all = (data.hiddenBy?.length ?? 0) !== 1 && data.hiddenByFilters > 0;
  if (!list.length && !all) return null;
  const pill = "inline-flex h-6 items-center gap-1 rounded-md border border-border px-1.5 text-11 text-foreground transition-colors hover:border-border-strong hover:bg-card-hover";
  return (
    <span className="flex flex-wrap items-center gap-1" data-testid="hidden-by">
      {list.map((h) => (
        <button key={h.filter} type="button" onClick={() => setQ(dropFilter(q, h))} title={`Search again without ${h.label}: ${h.n} more ${h.n === 1 ? "result" : "results"}`} className={pill}>
          <span className="text-muted-foreground">{h.label} hides {h.n}</span><span className="font-medium">Drop</span>
        </button>
      ))}
      {all && (
        <button type="button" data-testid="hidden-all" onClick={() => setQ(wordsOnly(q, data))} title={`Search again without any filter: ${data.hiddenByFilters} more ${data.hiddenByFilters === 1 ? "result" : "results"}`} className={pill}>
          <span className="text-muted-foreground">All filters hide {data.hiddenByFilters}</span><span className="font-medium">Clear all</span>
        </button>
      )}
    </span>
  );
}

/** The box with every filter gone: typed ones dropped, read ones kept as their words. */
function wordsOnly(q: string, data: SearchResponse | undefined): string {
  return freeText(parseQuery(keepWords(q, data?.understood ?? [])));
}

function Empty({ q, data, setQ, onAsk }: { q: string; data: SearchResponse; setQ: (q: string) => void; onAsk: () => void }) {
  const sources = useSources();
  // the tools the sidebar lists with something in them: the same number, never a source still getting ready
  const n = sources.data ? new Set(sources.data.sources.filter((s) => s.health.itemCount > 0).map((s) => s.platform)).size : 0;
  // the buttons below edit filters typed in the box; filters read from the sentence come off as words
  const p = parseQuery(q);
  const read = data.understood ?? [];
  const from = opValues(p, "from");
  const srcs = opValues(p, "source");
  const dated = ["after", "before", "on", "updated", "during"].some((k) => opValues(p, k as never).length);
  return (
    <div className="fade-in flex flex-col gap-3 px-4 py-8" data-testid="empty">
      <p className="text-13">Nothing matched <span className="font-medium">“{q}”</span> {srcs.length ? <>in {srcs.map(platformName).join(", ")}</> : <>{n ? `in your ${n} sources` : "in your sources"}</>}.</p>
      <div className="flex flex-wrap gap-1.5">
        {read.map((u) => <Button key={`${u.start}-${u.filter}`} size="sm" onClick={() => setQ(keepWords(q, [u]))}>Remove {u.label}</Button>)}
        {from.length > 0 && <Button size="sm" onClick={() => setQ(applyChip(q, { key: "from", values: null }))}>Remove From: {from.map((f) => data.entities.find((e) => e.name.toLowerCase().startsWith(f.toLowerCase()))?.name ?? f).join(", ")}</Button>}
        {srcs.length > 0 && <Button size="sm" onClick={() => setQ(applyChip(q, { key: "source", values: null }))}>Search all sources</Button>}
        {dated && <Button size="sm" onClick={() => setQ(["after", "before", "on", "updated", "during"].reduce((acc, k) => applyChip(acc, { key: k as never, values: null }), q))}>Search all time</Button>}
        {(data.hiddenBy ?? []).map((h) => <Button key={h.filter} size="sm" onClick={() => setQ(dropFilter(q, h))}>Without {h.label}, {h.n} {h.n === 1 ? "result" : "results"}</Button>)}
        {data.hiddenByFilters > 0 && (data.hiddenBy?.length ?? 0) !== 1 && <Button size="sm" onClick={() => setQ(wordsOnly(q, data))}>Without any filter, {data.hiddenByFilters} {data.hiddenByFilters === 1 ? "result" : "results"}</Button>}
        <Button size="sm" icon={<Sparkles />} onClick={onAsk}>Ask the assistant</Button>
      </div>
      <Nearby q={q} data={data} setQ={setQ} />
    </div>
  );
}

/**
 * Nothing in that time, but there is outside it ("mail from Felix Wagner last month", "emails with
 * attachments from Anika"): the closest rows without the date or the state, under a line that says
 * so, instead of an empty page.
 */
function Nearby({ q, data, setQ }: { q: string; data: SearchResponse; setQ: (q: string) => void }) {
  const ws = useWorkspace();
  // a time or a state ("with an attachment", "unread") is the filter to look past; never a person or a kind of item
  const hb: { label: string; filter: string; phrase: string | null; start: number | null; end: number | null }[] = [...(data.hiddenBy ?? []), ...(data.understood ?? [])];
  const date = hb.find((h) => /^(after|before|on|during|updated):/.test(h.filter)) ?? hb.find((h) => /^(has|is|lane|status):/.test(h.filter));
  // the phrase goes away entirely here (not kept as words): "receipts last month" looks at "receipts" any time
  const dropped = !date ? null : date.phrase !== null && date.start !== null && date.end !== null && q.slice(date.start, date.end) === date.phrase
    ? `${q.slice(0, date.start)} ${q.slice(date.end)}`.replace(/\s+/g, " ").trim() || null
    : dropFilter(q, { ...date, n: 0 });
  const near = useQuery({ queryKey: ["nearby", dropped], queryFn: () => api.search({ q: dropped!, limit: 5 }), enabled: !!dropped, staleTime: 60_000 });
  if (!date || !near.data?.results.length) return null;
  return (
    <div className="flex flex-col gap-1 pt-2" data-testid="nearby">
      <p className="text-xs text-muted-foreground">Without {date.label}, {near.data.total} {near.data.total === 1 ? "result" : "results"}:</p>
      <div className="-mx-4 flex flex-col">
        {near.data.results.map((r, i) => (
          <ResultRowView key={r.id} row={r} index={i} selected={r.id === ws.selectedId} onSelect={() => ws.select(r.id, { open: true })} onOpen={() => { if (r.url) window.open(r.url, "_blank", "noopener"); }} />
        ))}
      </div>
      {near.data.total > near.data.results.length && <button type="button" className="w-fit text-xs font-medium text-foreground underline-offset-2 hover:underline" onClick={() => setQ(dropped!)}>Show all {near.data.total}</button>}
    </div>
  );
}

function KeywordBanner({ reason }: { reason?: string }) {
  const [hidden, setHidden] = useState(() => sessionStorage.getItem("search.kwbanner") === "1");
  if (hidden) return null;
  const why = reason && reason in MEANING_DB_REASON ? MEANING_DB_REASON[reason as keyof typeof MEANING_DB_REASON] : MEANING_DB_REASON.extension_unavailable;
  return (
    <div role="status" className="flex h-9 shrink-0 items-center gap-3 border-b border-border bg-warning-text/[0.07] px-4 text-xs">
      <span className="flex-1">{COPY.meaningOff} {why}. {COPY.meaningOffResults}</span>
      <Link to="/settings/search" className="font-medium underline-offset-2 hover:underline">Settings</Link>
      <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => { sessionStorage.setItem("search.kwbanner", "1"); setHidden(true); }}>Dismiss</button>
    </div>
  );
}

/** The vector arm did not run for this search (D41): say why, once per session, with the way to fix it. */
function SemanticBanner({ status }: { status: SearchResponse["embedder"] }) {
  const key = `search.sembanner.${status.reason}`;
  const [hidden, setHidden] = useState(() => sessionStorage.getItem(key) === "1");
  if (status.semantic || (status.reason !== "not_in_grant" && status.reason !== "error") || hidden) return null;
  return (
    <div role="status" data-testid="semantic-banner" className="flex h-9 shrink-0 items-center gap-3 border-b border-border bg-warning-text/[0.07] px-4 text-xs">
      <span className="min-w-0 flex-1 truncate">{COPY.meaningOff} {meaningOffReason(status.reason, status.message)}{status.reason === "error" ? ` ${COPY.meaningOffResults}` : ""}</span>
      {status.reason === "not_in_grant"
        ? <a href="https://app.withone.ai/connections" target="_blank" rel="noreferrer" className="shrink-0 font-medium underline-offset-2 hover:underline">{COPY.manageInOne}</a>
        : <Link to="/settings/search" className="shrink-0 font-medium underline-offset-2 hover:underline">Settings</Link>}
      <button type="button" className="shrink-0 text-muted-foreground hover:text-foreground" onClick={() => { sessionStorage.setItem(key, "1"); setHidden(true); }}>Dismiss</button>
    </div>
  );
}

/** One line under the count: a closer name (did you mean), the any-word fallback, and dates read from the text. */
function QueryNotes({ data, q, setQ }: { data: SearchResponse; q: string; setQ: (q: string) => void }) {
  const dym = data.didYouMean;
  const dates = data.dateProposals ?? [];
  const und = data.undated;
  const undatedLine = und && (und.deals || und.tasks) ? [und.deals ? `${und.deals} ${und.deals === 1 ? "deal has" : "deals have"} no close date` : "", und.tasks ? `${und.tasks} ${und.tasks === 1 ? "task has" : "tasks have"} no due date` : ""].filter(Boolean).join(" and ") : "";
  if (!dym && !data.fallback && !dates.length && !undatedLine) return null;
  const useDates = (d: (typeof dates)[number]) => {
    const i = q.toLowerCase().indexOf(d.remove.toLowerCase());
    const rest = i >= 0 ? `${q.slice(0, i)}${q.slice(i + d.remove.length)}` : q;
    setQ(`${rest.replace(/\s+/g, " ").trim()} ${d.insert}`.trim());
  };
  return (
    <div className="flex flex-col gap-1.5 px-4 pb-2 text-xs" data-testid="query-notes">
      {dym && (
        <p data-testid="did-you-mean">
          <span className="text-muted-foreground">Did you mean </span>
          <button type="button" className="font-medium text-foreground underline-offset-2 hover:underline" onClick={() => setQ(dym.name)}>{dym.name}</button>
          <span className="text-muted-foreground">?</span>
        </p>
      )}
      {undatedLine && <p className="text-muted-foreground" data-testid="undated">{undatedLine}, so {(und!.deals || 0) + (und!.tasks || 0) === 1 ? "it is" : "they are"} not listed.</p>}
      {data.fallback === "or" && (
        <p className="text-muted-foreground" data-testid="or-fallback">No result had every word, so these match any of them.</p>
      )}
      {data.fallback === "filters" && (
        <p className="flex flex-wrap items-center gap-x-2 text-muted-foreground" data-testid="filters-fallback">
          <span>{data.matchedWords
            ? <>Only {data.matchedWords} {data.matchedWords === 1 ? "result" : "results"} also had “{data.unmatched}”, so {data.matchedWords === 1 ? "it comes" : "they come"} first, then everything else that matches the filters.</>
            : <>No result also had “{data.unmatched}”, so these are everything that matches the filters.</>}</span>
          <button type="button" className="font-medium text-foreground underline-offset-2 hover:underline" onClick={() => setQ(keepWords(q, data.understood ?? []))}>Search the exact words instead</button>
        </p>
      )}
      {dates.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="date-proposals">
          {dates.map((d) => (
            <button key={d.insert} type="button" onClick={() => useDates(d)} title={d.insert}
              className="inline-flex h-6 items-center gap-1.5 rounded-md border border-dashed border-border-strong px-2 text-11 text-foreground transition-colors hover:border-solid hover:bg-card-hover">
              <Clock className="size-3 text-muted-foreground" /><span className="text-muted-foreground">Only</span>{d.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SaveDialog({ open, q, onClose, onSave }: { open: boolean; q: string; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState("");
  useEffect(() => { if (open) setName(q.length > 40 ? `${q.slice(0, 38)}...` : q); }, [open, q]);
  return (
    <Dialog open={open} onClose={onClose} title="Save this search" size="sm">
      <form className="flex flex-col gap-3 p-4" onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSave(name.trim()); }}>
        <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" autoFocus />
        <p className="truncate font-mono text-11 text-muted-foreground">{q}</p>
        <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button><Button size="sm" variant="primary" type="submit" disabled={!name.trim()}>Save</Button></div>
      </form>
    </Dialog>
  );
}


/** A saved or recent query in the body font, operators as quiet tokens. */
function QueryText({ q }: { q: string }) {
  return <>{q.split(/(\s+)/).map((w, i) => (/^-?[a-z]+:\S/.test(w) ? <span key={i} className="rounded-sm bg-muted px-1 font-mono text-xs text-muted-foreground">{w}</span> : <span key={i}>{w}</span>))}</>;
}
