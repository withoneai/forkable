// /access: the grant Search runs on, what it can do with it, and the record of
// every call. Disconnect is local; the real revoke lives in the One account.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Link2, X } from "lucide-react";
import { useConnectMore } from "@/lib/connectMore";
import type { AccessResponse, LedgerRow } from "@/contract/api-types";
import { api } from "@/lib/api";
import { keys, useAccess, useLedger } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { cn, fmtClock, fmtDateTime, platformName } from "@/lib/utils";
import { SourceLogo } from "@/components/SourceLogo";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { IconButton } from "@/components/ui/IconButton";
import { Skeleton } from "@/components/ui/Skeleton";
import { LoadError } from "@/components/ui/EmptyState";

const ACTORS: { key: string; label: string }[] = [
  { key: "", label: "All" }, { key: "indexer", label: "Indexer" }, { key: "assistant", label: "Assistant" },
  { key: "classifier", label: "Jev" }, { key: "mapper", label: "New profile" }, { key: "user", label: "You" },
];

export function Access() {
  const q = useAccess();
  const [actor, setActor] = useState("");
  const ledger = useLedger({ limit: 100, actor: actor || undefined });
  const qc = useQueryClient();
  const nav = useNavigate();
  const [detail, setDetail] = useState<LedgerRow | null>(null);
  const [receipt, setReceipt] = useState<LedgerRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const a = q.data;
  const connect = useConnectMore();

  useEffect(() => {
    if (!receipt) return;
    const t = setTimeout(() => setReceipt(null), 10_000);
    return () => clearTimeout(t);
  }, [receipt]);

  const showReceipt = async () => {
    setBusy(true);
    try {
      const row = await api.receiptDemo();
      setReceipt(row);
      setDetail(row);
      await qc.invalidateQueries({ queryKey: ["ledger"] });
    } catch (e) {
      toast({ title: "No receipt", detail: (e as Error).message, tone: "destructive" });
    } finally { setBusy(false); }
  };

  const disconnect = async () => {
    setDisconnecting(true);
    try {
      await api.disconnect();
      await qc.resetQueries();
      toast({ title: "Search is disconnected", detail: "The grant still exists in your One account. Revoke it there to end access." });
      nav("/start");
    } catch (e) {
      toast({ title: "Could not disconnect", detail: (e as Error).message, tone: "destructive" });
    } finally { setDisconnecting(false); }
  };

  const counts = useMemo(() => {
    const all = a?.platforms.flatMap((p) => p.actions) ?? [];
    return { granted: all.filter((x) => x.granted).length, platforms: a?.platforms.filter((p) => p.actions.some((x) => x.granted)).length ?? 0 };
  }, [a]);

  return (
    <div className="flex min-h-0 flex-1">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[880px] flex-col gap-5 px-6 pb-12 pt-7">
          <header>
            <h1 className="text-xl font-semibold tracking-tight">Access</h1>
            <p className="mt-0.5 text-13 text-muted-foreground">The accounts you connected and what Search can do with them. Secured by One.</p>
          </header>

          {q.isError && !a ? (
            <LoadError what="Access" error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} className="rounded-lg border border-border bg-card py-10" />
          ) : !a ? (
            <Skeleton className="h-[92px] w-full rounded-lg" />
          ) : (
            <div className="flex items-start gap-4 rounded-lg border border-border bg-card p-4" data-testid="grant-card">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-13 font-semibold">Your grant</span>
                  <Badge tone="success">Active</Badge>
                  {a.readOnly && <Badge tone="outline">Read only</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  Granted by <span className="text-foreground">{a.grantedBy.name ?? a.grantedBy.email ?? "you"}</span> · <span className="tnum">{counts.granted}</span> actions across <span className="tnum">{counts.platforms}</span> platforms · owned in your One account
                </p>
                <p className="text-11 text-muted-foreground">Disconnect stops Search from using the grant on this computer. To end access everywhere, revoke it in your One account.</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button size="sm" icon={<Link2 />} loading={connect.open} onClick={connect.start} data-testid="connect-more">Connect accounts</Button>
                <a href={a.manageUrl} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-card-hover hover:text-foreground">
                  Manage in One <ExternalLink className="size-3" />
                </a>
                <ConfirmButton size="sm" onConfirm={() => void disconnect()} loading={disconnecting} confirmLabel="Click again to disconnect">Disconnect</ConfirmButton>
              </div>
            </div>
          )}

          {a && (
            <section className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-13 font-semibold">Available actions</h2>
                <p className="text-xs text-muted-foreground">Search can read. It has no action that sends, edits or deletes.</p>
              </div>
              <Actions platforms={a.platforms} onReceipt={() => void showReceipt()} busy={busy} />
            </section>
          )}

          {!(q.isError && !a) && (
            <>
              <div className="mt-2 flex items-center justify-between gap-3">
                <h2 className="text-13 font-semibold">Activity</h2>
                <div className="flex items-center gap-2">
                  <div role="radiogroup" aria-label="Who made the call" className="inline-flex h-7 items-center rounded-md border border-border bg-faint p-0.5">
                    {ACTORS.map((o) => (
                      <button key={o.key} type="button" role="radio" aria-checked={actor === o.key} onClick={() => setActor(o.key)}
                        className={cn("h-full rounded-sm px-2 text-11 font-medium transition-colors", actor === o.key ? "bg-card text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.08)]" : "text-muted-foreground hover:text-foreground")}>{o.label}</button>
                    ))}
                  </div>
                  <Button size="sm" onClick={() => void showReceipt()} loading={busy}>Test a declined call</Button>
                </div>
              </div>

              {receipt && (
                <div role="status" className="fade-in flex flex-col gap-2 rounded-lg border border-border bg-faint p-3" data-testid="receipt">
                  <div className="flex items-center gap-3 font-mono text-xs">
                    <span className="text-foreground">{platformName(receipt.platform)} · delete</span>
                    <span className="flex-1 border-b border-dotted border-border-strong" aria-hidden />
                    <span className="font-medium text-destructive-text">declined, {receipt.status}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Delete is not in the grant, so One refused the call and {platformName(receipt.platform)} was never called. The line below is the record.</p>
                </div>
              )}

              <TickStrip rows={ledger.data ?? []} />
              {ledger.isError ? (
                <LoadError what="Activity" error={ledger.error} onRetry={() => void ledger.refetch()} retrying={ledger.isFetching} className="rounded-lg border border-border bg-card py-8" />
              ) : (
                <Ledger rows={ledger.data ?? []} loading={ledger.isPending} onPick={setDetail} picked={detail?.id ?? null} highlight={receipt?.id ?? null} />
              )}
            </>
          )}
        </div>
      </div>

      {detail && (
        <aside className="slide-in-right flex w-[320px] shrink-0 flex-col gap-4 overflow-y-auto overflow-x-hidden border-l border-border bg-faint p-4" aria-label="Call detail" data-testid="call-detail">
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2 text-xs font-medium"><SourceLogo platform={detail.platform} size={14} /><span className="truncate">{detail.action}</span></span>
            <IconButton label="Close" size="sm" onClick={() => setDetail(null)}><X /></IconButton>
          </div>
          <p className="text-13">{detail.sentence}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={detail.blockedByGrant ? "destructive" : detail.ok ? "success" : "warning"} mono>{detail.blockedByGrant ? `declined, ${detail.status}` : detail.status}</Badge>
            <Badge tone="outline" mono>{detail.level}</Badge>
            <Badge tone="outline" mono>{detail.mode === "fixture" ? "sample" : "live"}</Badge>
            <Badge tone="outline">{actorLabel(detail.actor)}</Badge>
          </div>
          {detail.blockedByGrant && (
            <p className="rounded-md border border-destructive-text/30 bg-destructive-text/[0.06] px-3 py-2 text-xs">Blocked by the grant. The provider was never called.</p>
          )}
          <dl className="grid min-w-0 grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
            {([
              ["When", fmtDateTime(detail.at)],
              ["Platform", platformName(detail.platform)],
              ["Action", detail.actionId],
              ["Method", detail.method],
              ["Path", detail.path],
              ["Took", `${detail.ms} ms`],
              ["Summary", detail.summary],
              ["Client", detail.clientName ?? "this app"],
              ["Refusal", detail.refusal ?? "none"],
              ["Note", detail.note ?? "none"],
            ] as const).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className={cn("min-w-0 break-words", (k === "Path" || k === "Method" || k === "Action") && "break-all font-mono text-11")}>{v}</dd>
              </div>
            ))}
          </dl>
        </aside>
      )}
    </div>
  );
}

function actorLabel(a: LedgerRow["actor"]): string {
  return ({ indexer: "Indexer", assistant: "Assistant", mapper: "New profile", classifier: "Jev", embedder: "Embedder", user: "You", api: "API", mcp: "MCP" } as const)[a] ?? a;
}

function Actions({ platforms, onReceipt, busy }: { platforms: AccessResponse["platforms"]; onReceipt: () => void; busy: boolean }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card" data-testid="actions">
      {platforms.map((p) => (
        <div key={p.platform} className="flex gap-3 border-b border-border px-3 py-2.5 last:border-b-0">
          <div className="flex w-[200px] shrink-0 items-start gap-2 pt-1">
            <SourceLogo platform={p.platform} size={16} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-13 font-medium">{p.name}</span>
              {/* every account of the platform, one per line ("dana@acme.com · dana@acme.dev" from the server) */}
              {p.connectionLabel.split(" · ").filter(Boolean).map((l) => <span key={l} className="truncate text-11 text-muted-foreground" title={l}>{l}</span>)}
            </span>
          </div>
          <ul className="flex min-w-0 flex-1 flex-col gap-1">
            {groupActions(p.actions).map(({ x, ids }) => {
              const line = (
                <>
                  <span className={cn("min-w-0 flex-1 truncate text-xs", !x.granted && "text-muted-foreground")}>
                    <span className="font-semibold text-foreground">{x.verb}</span> {actionText(x.title)}
                    {ids.length > 1 && <span className="text-muted-foreground"> · {ids.length} actions</span>}
                  </span>
                  {x.granted ? <Badge tone="success">Granted</Badge> : <Badge tone="outline">Not granted</Badge>}
                </>
              );
              return (
                <li key={x.actionId}>
                  {!x.granted && x.level === "write" ? (
                    <button type="button" onClick={onReceipt} disabled={busy} className="group flex h-7 w-full items-center gap-3 rounded-md bg-faint px-2 text-left transition-colors hover:bg-card-hover" title="Try it and see the receipt" data-testid="write-row">
                      {line}
                      <span className="text-11 font-medium underline-offset-2 group-hover:underline">See the receipt</span>
                    </button>
                  ) : (
                    <div className="flex h-7 items-center gap-3 px-2" title={ids.join("\n")}>{line}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** 24 hourly ticks: green when every call in that hour was ok, red when one was declined or failed, grey when quiet. */
function TickStrip({ rows }: { rows: LedgerRow[] }) {
  const now = Date.now();
  const H = 3_600_000;
  const ticks = Array.from({ length: 24 }, (_, i) => {
    const from = now - (24 - i) * H, to = from + H;
    const inHour = rows.filter((r) => { const t = new Date(r.at).getTime(); return t >= from && t < to; });
    const bad = inHour.some((r) => !r.ok);
    return { n: inHour.length, bad, from };
  });
  const total = rows.filter((r) => now - new Date(r.at).getTime() < 24 * H);
  const declined = total.filter((r) => r.blockedByGrant).length;
  return (
    <div className="flex items-center gap-3" data-testid="tick-strip">
      <div className="flex h-6 flex-1 items-end gap-0.5" aria-label={`${total.length} calls in the last 24 hours`}>
        {ticks.map((t, i) => (
          <span key={i} title={`${new Date(t.from).toLocaleTimeString(undefined, { hour: "numeric" })}: ${t.n} calls`}
            className={cn("flex-1 rounded-sm", t.n === 0 ? "h-1.5 bg-muted" : t.bad ? "h-full bg-destructive-text/70" : "h-full bg-success-text/60")} />
        ))}
      </div>
      <span className="tnum shrink-0 text-11 text-muted-foreground">{total.length} calls in 24h · <span className={cn(declined > 0 && "font-medium text-destructive-text")}>{declined} declined</span></span>
    </div>
  );
}

function Ledger({ rows, loading, onPick, picked, highlight }: { rows: LedgerRow[]; loading: boolean; onPick: (r: LedgerRow) => void; picked: string | null; highlight: string | null }) {
  if (loading) return <Skeleton className="h-64 w-full rounded-lg" />;
  if (rows.length === 0) return <p className="text-13 text-muted-foreground">No calls yet.</p>;
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card text-xs" role="list" aria-label="Activity" data-testid="ledger">
      {rows.map((r) => (
        <button
          key={r.id}
          type="button"
          role="listitem"
          aria-label={`${fmtClock(r.at)}, ${r.sentence}, ${r.blockedByGrant ? `declined, ${r.status}` : r.status}`}
          aria-pressed={picked === r.id}
          onClick={() => onPick(r)}
          className={cn(
            "flex min-h-[2.75rem] w-full items-center gap-3 border-b border-border px-3 py-1.5 text-left transition-colors duration-100 last:border-b-0 hover:bg-faint",
            picked === r.id && "bg-muted hover:bg-muted",
            highlight === r.id && "bg-destructive-text/[0.07] hover:bg-destructive-text/[0.09]",
          )}
        >
          <span className="tnum w-[60px] shrink-0 font-mono text-11 text-muted-foreground">{fmtClock(r.at)}</span>
          <SourceLogo platform={r.platform} size={14} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex items-center gap-1.5 truncate">
              {r.actor === "assistant" && <Badge>Assistant</Badge>}
              <span className="truncate">{r.sentence}</span>
            </span>
            <span className="truncate font-mono text-11 text-muted-foreground">{r.actionId.replace("conn_mod_def::", "")}</span>
          </span>
          <span className="tnum w-[64px] shrink-0 text-right text-11 text-muted-foreground">{r.ms} ms</span>
          <span className="flex w-[96px] shrink-0 justify-end">
            <Badge tone={r.blockedByGrant ? "destructive" : r.ok ? "success" : "warning"} mono>{r.blockedByGrant ? `declined, ${r.status}` : r.status}</Badge>
          </span>
        </button>
      ))}
    </div>
  );
}

/** One row per thing Search does: a list and its detail call ("Index Gmail threads" twice) are one row. */
function groupActions<T extends { actionId: string; title: string; verb: string; granted: boolean; level: string }>(list: T[]): { x: T; ids: string[] }[] {
  const out = new Map<string, { x: T; ids: string[] }>();
  for (const x of list) {
    const k = `${x.verb}|${x.title}|${x.granted}|${x.level}`;
    const g = out.get(k);
    if (g) g.ids.push(x.actionId); else out.set(k, { x, ids: [x.actionId] });
  }
  return [...out.values()];
}
/** "Index Gmail threads for search" under the verb Read reads "Read Gmail threads, to index them". */
const actionText = (t: string) => (/^Index (.+) for search$/.test(t) ? t.replace(/^Index (.+) for search$/, "$1, to index them") : t);
