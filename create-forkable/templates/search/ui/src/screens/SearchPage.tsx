import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUp, ArrowUpDown, Clock, Plus, RefreshCw, Shuffle, Sparkles } from "lucide-react";
import type { AnswerResponse, ItemKind, ResultRow, SearchResponse } from "@/contract/api-types";
import { applyChip, freeText, isQuestion, opValues, parseQuery } from "@/contract/query";
import { api } from "@/lib/api";
import { useKeys } from "@/lib/keys";
import { keys as qk, useMe, useRecent, useSaveSearch, useSearch, useSources } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { cn, fmtNum, fmtRelative, LANE_OP, platformName, SCOPES, useMedia } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";
import { cacheKey, dropCached, patchAnswer, patchCached, readCached, saveSearch } from "@/lib/searchCache";
import { SearchBox, type SearchBoxHandle } from "@/components/results/SearchBox";
import { ChipBar } from "@/components/results/ChipBar";
import { ResultRowView } from "@/components/results/ResultRow";
import { EntityStrip } from "@/components/results/EntityStrip";
import { AnswerStrip, answerKey } from "@/components/results/AnswerStrip";
import { PreviewPane } from "@/components/preview/PreviewPane";
import { HealthDot, rollup } from "@/components/Shell";
import { SourceLogo } from "@/components/SourceLogo";
import { useEntityOptions } from "@/components/results/entityOptions";
import { Menu } from "@/components/ui/Menu";
import { Kbd } from "@/components/ui/Kbd";
import { Skeleton } from "@/components/ui/Skeleton";
import { LoadError } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";

const TIPS = [
  "from:me type:mail before:2026-10-01",
  "with:globex.com after:30d",
  "type:deal is:open amount:>=50000",
  "lane:needs-you",
  "type:event during:this-week",
  "-in:slack \"renewal terms\"",
];

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
  const ents = useEntityOptions();
  const me = useMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [tip, setTip] = useState(() => Math.floor(Math.random() * TIPS.length));
  const [shuffle, setShuffle] = useState(0);
  const list = sources.data?.sources ?? [];
  const total = list.reduce((n, s) => n + s.health.itemCount, 0);
  const byPlatform = new Map<string, typeof list>();
  for (const s of list) byPlatform.set(s.platform, [...(byPlatform.get(s.platform) ?? []), s]);
  useEffect(() => { const t = setInterval(() => setTip((x) => (x + 1) % TIPS.length), 8000); return () => clearInterval(t); }, []);

  const people = ents.filter((e) => e.type === "person" && !e.self);
  const companies = ents.filter((e) => e.type === "company" && !e.self);
  const vipIds = me.data?.settings?.vipEntityIds ?? [];
  const pick = <T,>(arr: T[], i: number) => arr.length ? arr[(i + shuffle) % arr.length] : undefined;
  const vip = people.find((p) => vipIds.includes(p.id)) ?? pick(people, 0);
  const tries = [
    vip && `from:${vip.short} after:7d`,
    pick(people, 2) && `type:meeting with:${pick(people, 2)!.short}`,
    "type:deal is:open",
    pick(companies, 1) && `with:${pick(companies, 1)!.short} after:30d`,
  ].filter(Boolean).slice(0, 3) as string[];

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
          <SearchBox ref={box} value="" onCommit={onCommit} onAsk={onAsk} size="home" autoFocus />
          <p className="px-1 text-11 text-muted-foreground">Tip: <span className="font-mono text-foreground/80">{TIPS[tip]}</span></p>
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
                    <button key={t} type="button" onClick={() => onCommit(t)} className="inline-flex h-7 items-center rounded-md border border-border bg-card px-2.5 font-mono text-xs transition-colors hover:border-border-strong hover:bg-card-hover">{t}</button>
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
                    <Link key={p} to={`/sources/${l[0]!.id}`} className="relative inline-flex h-8 items-center gap-2 overflow-hidden rounded-md border border-border bg-card px-2.5 text-xs transition-colors hover:border-border-strong hover:bg-card-hover" title={syncing ? `Indexing ${platformName(p)}, ${syncing.health.progress!.done} of about ${syncing.health.progress!.estimate ?? "many"}` : undefined}>
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
              {me.data?.settings?.embedding.provider === "local" && <p className="px-1 text-11 text-muted-foreground">Sample embedder (local, not semantic). Keyword matches rank first.</p>}
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
  const [saving, setSaving] = useState(false);
  const [laneChord, setLaneChord] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
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

  const shown: ResultRow[] = useMemo(() => {
    if (!order) return rows;
    const by = new Map(rows.map((r) => [r.id, r]));
    return [...order.map((id) => by.get(id)).filter(Boolean) as ResultRow[], ...rows.filter((r) => !order.includes(r.id))];
  }, [rows, order]);

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
  const capability = me.data?.capability;
  const preview = ws.previewOpen && selRow && !takeoverMode;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-col gap-2 border-b border-border px-4 pb-2 pt-3">
          <SearchBox ref={box} value={q} onCommit={ws.setQuery} onAsk={onAsk} onDown={() => { listRef.current?.focus(); move(0); }} />
          <ChipBar q={q} data={data} scope={scope} onChange={setQ} onSave={() => setSaving(true)} filterOpen={filterOpen} setFilterOpen={setFilterOpen} />
          <div className="-mb-2 flex items-center gap-0.5">
          <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto scrollbar-none [mask-image:linear-gradient(to_right,black_calc(100%-24px),transparent)]" role="tablist" aria-label="Scope">
            {tabs.map((t, i) => {
              const active = scope === t.key;
              return (
                <button key={t.key} type="button" role="tab" aria-selected={active} title={`${i + 1}`} onClick={() => setParam("scope", t.key === "all" ? null : t.key)}
                  className={cn("relative inline-flex h-8 shrink-0 items-center gap-1.5 px-2.5 text-13 font-medium transition-colors", active ? "text-foreground after:absolute after:inset-x-2.5 after:bottom-0 after:h-[2px] after:rounded-t-full after:bg-foreground" : "text-muted-foreground hover:text-foreground")}>
                  {t.label}{(t.key === "all" ? data?.total : counts?.[t.key]) ? <span className="tnum text-11 text-muted-foreground">{t.key === "all" ? data!.total : counts![t.key]}</span> : null}
                </button>
              );
            })}
          </div>
            <div className="ml-auto flex shrink-0 items-center">
              <Menu open={sortOpen} onClose={() => setSortOpen(false)} align="end"
                items={[["best", "Best match"], ["newest", "Newest"], ["oldest", "Oldest"]].map(([k, l]) => ({ key: k!, label: l!, hint: sort === k ? "on" : undefined, onSelect: () => setParam("sort", k === "best" ? null : k!) }))}
                anchor={<button type="button" onClick={() => setSortOpen(!sortOpen)} className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-card-hover hover:text-foreground"><ArrowUpDown className="size-3.5" />{{ best: "Best match", newest: "Newest", oldest: "Oldest" }[sort] ?? "Best match"}</button>} />
            </div>
          </div>
        </div>

        {capability?.mode === "keyword" && <KeywordBanner reason={capability.reason} />}
        {data && <SemanticBanner status={data.embedder} />}

        <div ref={listRef} tabIndex={-1} role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto outline-none" data-testid="results">
          {data?.parsed.errors.length ? <p className="px-4 pt-2 text-11 text-warning-text">{data.parsed.errors[0]!.message}.</p> : null}
          {isQuestion(q) && <div className="px-3 pt-3"><AnswerStrip query={q} queryId={data?.queryId ?? null} rev={rev} cached={cached?.answer ?? null} onAnswer={onAnswer} /></div>}
          {data?.entities.length ? <EntityStrip chips={data.entities} onSearch={(name) => setQ(`with:"${name}"`)} /> : null}
          {search.isError && !data ? (
            <LoadError what="Results" error={search.error} onRetry={() => void search.refetch()} retrying={search.isFetching} />
          ) : !data ? (
            <ResultSkeleton />
          ) : (
            <>
              <div className="flex h-8 items-center gap-2 whitespace-nowrap px-4 text-11 text-muted-foreground">
                <span className="label-caps">{fmtNum(data.total)} {data.total === 1 ? "result" : "results"}</span>
                {data.hiddenByFilters > 0 && <><span>·</span><span><span className="font-medium text-foreground">{data.hiddenByFilters} hidden by filters</span></span><button type="button" className="underline-offset-2 hover:text-foreground hover:underline" onClick={() => setQ(freeText(parsed))}>Clear</button></>}
                {fromCache && cached && <SavedNote at={cached.at} onRefresh={refresh} />}
                {newResults && (
                  <button type="button" data-testid="new-results" onClick={applyNew}
                    className="fade-in inline-flex h-6 items-center gap-1 rounded-full border border-border bg-card px-2 text-11 font-medium text-foreground shadow-sm transition-colors hover:border-border-strong hover:bg-card-hover">
                    <ArrowUp className="size-3" />{newResults.n} new {newResults.n === 1 ? "result" : "results"}
                  </button>
                )}
                <span className="ml-auto min-w-0 truncate tnum" title={`${data.ms} ms${order ? ", reranked by Jev" : ""}${!data.embedder.semantic ? ", keyword and sample embedder" : ""}`}>{order ? "Reranked by Jev" : ""}<span className="hidden 2xl:inline">{order ? " · " : ""}{data.ms} ms{!data.embedder.semantic ? " · keyword and sample embedder" : ""}</span></span>
              </div>
              <QueryNotes data={data} q={q} setQ={setQ} />
              {shown.length === 0 ? (
                <Empty q={q} data={data} setQ={setQ} onAsk={() => onAsk(q)} />
              ) : (
                <div className={cn("flex flex-col pb-6 transition-opacity", placeholder && "opacity-60")}>
                  {shown.map((r, i) => (
                    <ResultRowView key={r.id} row={r} index={i} selected={r.id === ws.selectedId}
                      onSelect={() => { movedSince.current = true; ws.select(r.id, { open: true }); listRef.current?.focus(); }}
                      onOpen={() => { if (r.url) window.open(r.url, "_blank", "noopener"); }} />
                  ))}
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

/** "Saved results from 4 min ago · Refresh ⇧R": the page came from the browser store. */
function SavedNote({ at, onRefresh }: { at: number; onRefresh: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const min = Math.floor((now - at) / 60_000);
  return (
    <span className="flex items-center gap-1.5" data-testid="saved-note" title={`Saved in this browser at ${new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Refresh runs the search, the Jev order and the answer again.`}>
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

function Empty({ q, data, setQ, onAsk }: { q: string; data: SearchResponse; setQ: (q: string) => void; onAsk: () => void }) {
  const sources = useSources();
  const n = new Set((sources.data?.sources ?? []).map((s) => s.platform)).size;
  const p = data.parsed;
  const from = opValues(p, "from");
  const srcs = opValues(p, "source");
  const dated = ["after", "before", "on", "updated", "during"].some((k) => opValues(p, k as never).length);
  return (
    <div className="fade-in flex flex-col gap-3 px-4 py-8" data-testid="empty">
      <p className="text-13">Nothing matched <span className="rounded-sm bg-muted px-1 font-mono text-xs">{q}</span> {srcs.length ? <>in {srcs.map(platformName).join(", ")}</> : <>in {n} sources</>}.</p>
      <div className="flex flex-wrap gap-1.5">
        {from.length > 0 && <Button size="sm" onClick={() => setQ(applyChip(q, { key: "from", values: null }))}>Remove From: {from.map((f) => data.entities.find((e) => e.name.toLowerCase().startsWith(f.toLowerCase()))?.name ?? f).join(", ")}</Button>}
        {srcs.length > 0 && <Button size="sm" onClick={() => setQ(applyChip(q, { key: "source", values: null }))}>Search all sources</Button>}
        {dated && <Button size="sm" onClick={() => setQ(["after", "before", "on", "updated", "during"].reduce((acc, k) => applyChip(acc, { key: k as never, values: null }), q))}>Search all time</Button>}
        {data.hiddenByFilters > 0 && <Button size="sm" onClick={() => setQ(freeText(p))}>Show {data.hiddenByFilters} hidden by filters</Button>}
        <Button size="sm" icon={<Sparkles />} onClick={onAsk}>Ask the assistant</Button>
      </div>
    </div>
  );
}

function KeywordBanner({ reason }: { reason?: string }) {
  const [hidden, setHidden] = useState(() => sessionStorage.getItem("search.kwbanner") === "1");
  if (hidden) return null;
  const why = reason === "forced" ? "Keyword-only was forced for this run" : reason === "embedding_not_granted" ? "No embedding model is in your grant" : reason === "cannot_create_extension" ? "This database does not allow the vector extension" : "pgvector is not available here";
  return (
    <div role="status" className="flex h-9 shrink-0 items-center gap-3 border-b border-border bg-warning-text/[0.07] px-4 text-xs">
      <span className="flex-1">Semantic search is off. {why}. Results are keyword matches.</span>
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
      <span className="min-w-0 flex-1 truncate">Semantic search is off. {status.message ?? "The embedding model did not answer."}{status.reason === "error" ? " Results are keyword matches." : ""}</span>
      {status.reason === "not_in_grant"
        ? <a href="https://app.withone.ai/connections" target="_blank" rel="noreferrer" className="shrink-0 font-medium underline-offset-2 hover:underline">Manage in One</a>
        : <Link to="/settings/search" className="shrink-0 font-medium underline-offset-2 hover:underline">Settings</Link>}
      <button type="button" className="shrink-0 text-muted-foreground hover:text-foreground" onClick={() => { sessionStorage.setItem(key, "1"); setHidden(true); }}>Dismiss</button>
    </div>
  );
}

/** One line under the count: a closer name (did you mean), the any-word fallback, and dates read from the text. */
function QueryNotes({ data, q, setQ }: { data: SearchResponse; q: string; setQ: (q: string) => void }) {
  const dym = data.didYouMean;
  const dates = data.dateProposals ?? [];
  if (!dym && !data.fallback && !dates.length) return null;
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
      {data.fallback === "or" && (
        <p className="text-muted-foreground" data-testid="or-fallback">No result had every word, so these match any of them.</p>
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
