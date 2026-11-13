// /access: the grant Search runs on, what it can do with it, and the record of
// every call. Disconnect is local; the real revoke lives in the One account.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ExternalLink, Link2, X } from "lucide-react";
import { useConnectMore } from "@/lib/connectMore";
import type { AccessResponse, LedgerRow } from "@/contract/api-types";
import { api } from "@/lib/api";
import { keys, useAccess, useLedger, useSources } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { cn, fmtClock, fmtDateTime, platformName } from "@/lib/utils";
import { SourceLogo } from "@/components/SourceLogo";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { IconButton } from "@/components/ui/IconButton";
import { Skeleton } from "@/components/ui/Skeleton";
import { LoadError } from "@/components/ui/EmptyState";
import { COPY, HELPER_TEXT } from "@/lib/copy";

const ACTORS: { key: string; label: string }[] = [
  { key: "", label: "All" }, { key: "indexer", label: "Updates" }, { key: "assistant", label: "Assistant" },
  { key: "classifier", label: COPY.judgeActivity }, { key: "mapper", label: "New source" }, { key: "user", label: "You" },
];

export function Access() {
  const q = useAccess();
  const [actor, setActor] = useState("");
  const ledger = useLedger({ limit: 100, actor: actor || undefined });
  const qc = useQueryClient();
  const nav = useNavigate();
  const [detail, setDetail] = useState<LedgerRow | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [receipt, setReceipt] = useState<LedgerRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
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
      toast({ title: "Search is disconnected", detail: "Your access still exists in your One account. Remove it there to end it everywhere." });
      nav("/start");
    } catch (e) {
      toast({ title: "Could not disconnect", detail: (e as Error).message, tone: "destructive" });
    } finally { setDisconnecting(false); }
  };

  // her tools (what Search reads) and the AI helpers it calls behind the scenes, kept apart
  // the same count as the sidebar's Sources: every tool Search reads, a source added by hand included
  const sourceList = useSources().data?.sources;
  const readCount = sourceList?.length ? new Set(sourceList.map((x) => x.platform)).size : null;
  const groups = useMemo(() => {
    const ps = a?.platforms ?? [];
    const helper = (p: AccessResponse["platforms"][number]) => p.platform in HELPER_TEXT || p.actions.every((x) => !x.usedBy.some((u) => u.startsWith("profiles/")) && x.granted);
    return { tools: ps.filter((p) => !helper(p)), helpers: ps.filter(helper) };
  }, [a]);

  return (
    <div className="flex min-h-0 flex-1">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[880px] flex-col gap-5 px-6 pb-12 pt-7">
          <header>
            <h1 className="text-xl font-semibold tracking-tight">Access</h1>
            <p className="mt-0.5 text-13 text-muted-foreground">The accounts you connected and what Search can do with them. {COPY.securedByOne}.</p>
          </header>

          {q.isError && !a ? (
            <LoadError what="Access" error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} className="rounded-lg border border-border bg-card py-10" />
          ) : !a ? (
            <Skeleton className="h-[92px] w-full rounded-lg" />
          ) : (
            <div className="flex flex-wrap items-start gap-x-4 gap-y-3 rounded-lg border border-border bg-card p-4" data-testid="grant-card">
              <div className="flex min-w-[16rem] flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-13 font-semibold">{COPY.yourAccess}</span>
                  <Badge tone="success">Active</Badge>
                  {a.readOnly && <Badge tone="outline">Read only</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  Connected by <span className="text-foreground">{a.grantedBy.name ?? a.grantedBy.email ?? "you"}</span>. Search reads <span className="tnum" data-testid="tools-count">{readCount ?? groups.tools.length}</span> of your tools{groups.helpers.length > 0 && <> and uses <span className="tnum">{groups.helpers.length}</span> AI helpers behind the scenes</>}. Kept in your One account.
                </p>
                <p className="text-11 text-muted-foreground">Disconnect stops Search from using your access on this computer. To end it everywhere, remove it in your One account.</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button size="sm" icon={<Link2 />} loading={connect.open} onClick={connect.start} data-testid="connect-more">Connect accounts</Button>
                <a href={a.manageUrl} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-card-hover hover:text-foreground">
                  {COPY.manageInOne} <ExternalLink className="size-3" />
                </a>
                <ConfirmButton size="sm" onConfirm={() => void disconnect()} loading={disconnecting} confirmLabel="Click again to disconnect">Disconnect</ConfirmButton>
              </div>
            </div>
          )}

          {a && (
            <section className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <h2 className="text-13 font-semibold">What Search can read</h2>
                <p className="text-xs text-muted-foreground">{a.mode === "fixture" ? "Search can read. It has no action that sends, edits or deletes." : "Search only reads, whatever your access in One allows. You can narrow it there."}</p>
              </div>
              <Actions platforms={groups.tools} onReceipt={a.mode === "fixture" ? () => void showReceipt() : null} busy={busy} />
            </section>
          )}

          {a && groups.helpers.length > 0 && (
            <section className="flex flex-col gap-2" data-testid="helpers">
              <div className="flex flex-col gap-0.5">
                <h2 className="text-13 font-semibold">AI helpers Search uses</h2>
                <p className="text-xs text-muted-foreground">These work behind the scenes on what Search already read. They are not places Search reads from.</p>
              </div>
              <Helpers platforms={groups.helpers} />
            </section>
          )}

          {!(q.isError && !a) && (
            <>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <div className="flex flex-col gap-0.5">
                  <h2 className="text-13 font-semibold">Activity</h2>
                  <p className="text-xs text-muted-foreground">Every call Search made, newest first. Repeats are grouped.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div role="radiogroup" aria-label="Who made the call" className="inline-flex h-7 items-center rounded-md border border-border bg-faint p-0.5">
                    {ACTORS.map((o) => (
                      <button key={o.key} type="button" role="radio" aria-checked={actor === o.key} onClick={() => setActor(o.key)}
                        className={cn("h-full rounded-sm px-2 text-11 font-medium transition-colors", actor === o.key ? "bg-card text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.08)]" : "text-muted-foreground hover:text-foreground")}>{o.label}</button>
                    ))}
                  </div>
                  <Button size="sm" onClick={() => setShowDetails((v) => !v)} aria-pressed={showDetails} data-testid="ledger-details">{showDetails ? "Hide details" : "Show details"}</Button>
                  {a?.mode === "fixture" && <Button size="sm" onClick={() => void showReceipt()} loading={busy}>Test a declined call</Button>}
                </div>
              </div>

              {receipt && (
                <div role="status" className="fade-in flex flex-col gap-2 rounded-lg border border-border bg-faint p-3" data-testid="receipt">
                  <div className="flex items-center gap-3 text-xs">
                    <span className="font-medium text-foreground">{callSentence(receipt).split(". ")[0]}.</span>
                    <span className="flex-1 border-b border-dotted border-border-strong" aria-hidden />
                    <span className="font-medium text-destructive-text">{outcome(receipt)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">One said no, because Search may only read, and {platformName(receipt.platform)} was never asked. The highlighted line below is the record.</p>
                </div>
              )}

              <TickStrip rows={ledger.data ?? []} />
              {ledger.isError ? (
                <LoadError what="Activity" error={ledger.error} onRetry={() => void ledger.refetch()} retrying={ledger.isFetching} className="rounded-lg border border-border bg-card py-8" />
              ) : (
                <Ledger rows={ledger.data ?? []} loading={ledger.isPending} onPick={setDetail} picked={detail?.id ?? null} highlight={receipt?.id ?? null} details={showDetails} />
              )}
            </>
          )}
        </div>
      </div>

      {detail && (
        <aside className="slide-in-right flex w-[320px] shrink-0 flex-col gap-4 overflow-y-auto overflow-x-hidden border-l border-border bg-faint p-4" aria-label="Call detail" data-testid="call-detail">
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2 text-xs font-medium"><SourceLogo platform={detail.platform} size={14} /><span className="truncate">{platformName(detail.platform)}</span></span>
            <IconButton label="Close" size="sm" onClick={() => setDetail(null)}><X /></IconButton>
          </div>
          <p className="text-13" data-testid="call-sentence">{callSentence(detail)}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={detail.blockedByGrant ? "destructive" : detail.ok ? "success" : "warning"}>{outcome(detail)}</Badge>
            {detail.mode === "fixture" && <Badge tone="outline">Sample</Badge>}
          </div>
          <dl className="grid min-w-0 grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
            {([
              ["When", fmtDateTime(detail.at)],
              ["Tool", platformName(detail.platform)],
              ["Asked by", detail.clientName ?? actorLabel(detail.actor)],
            ] as const).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="min-w-0 break-words">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-col gap-2">
            <button type="button" className="flex items-center gap-1 self-start text-11 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" aria-expanded={requestOpen} onClick={() => setRequestOpen((v) => !v)} data-testid="call-request-toggle">
              <ChevronDown className={cn("size-3 transition-transform", !requestOpen && "-rotate-90")} />{requestOpen ? "Hide the request" : "Show the request"}
            </button>
            {requestOpen && (
              <div className="flex flex-col gap-2 rounded-md bg-card p-2.5" data-copy="advanced" data-testid="call-request">
                <p className="font-mono text-11 text-muted-foreground">{detail.sentence}</p>
                <dl className="grid min-w-0 grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
                  {([
                    ["Status", detail.blockedByGrant ? `declined, ${detail.status}` : String(detail.status)],
                    ["Access", detail.level],
                    ["Action", detail.actionId],
                    ["Method", detail.method],
                    ["Path", detail.path],
                    ["Took", `${detail.ms} ms`],
                    ["Summary", detail.summary],
                    ["Refusal", detail.refusal ?? "none"],
                    ["Note", detail.note ?? "none"],
                  ] as const).map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className={cn("min-w-0 break-words", (k === "Path" || k === "Method" || k === "Action" || k === "Status") && "break-all font-mono text-11")}>{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}

function actorLabel(a: LedgerRow["actor"]): string {
  return ({ indexer: "Updates", assistant: "Assistant", mapper: "New source", classifier: COPY.judgeActivity, embedder: "Search by meaning", user: "You", api: "Apps you connected", mcp: "Agents" } as const)[a] ?? a;
}

function Actions({ platforms, onReceipt, busy }: { platforms: AccessResponse["platforms"]; onReceipt: (() => void) | null; busy: boolean }) {
  return (
    <div className="@container overflow-hidden rounded-lg border border-border bg-card" data-testid="actions">
      {platforms.map((p) => (
        <div key={p.platform} className="flex flex-col gap-1.5 border-b border-border px-3 py-2.5 last:border-b-0 @xl:flex-row @xl:gap-3">
          <div className="flex shrink-0 items-start gap-2 pt-1 @xl:w-[13rem]">
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
                  <span className={cn("min-w-0 flex-1 text-xs", !x.granted && "text-muted-foreground")}>
                    <span className="font-semibold text-foreground">{x.verb}</span> {actionText(x.title, x.verb)}
                  </span>
                  {x.granted ? <Badge tone="success">{COPY.allowed}</Badge> : <Badge tone="outline">{COPY.notAllowed}</Badge>}
                </>
              );
              return (
                <li key={x.actionId}>
                  {onReceipt && !x.granted && x.level === "write" ? (
                    <button type="button" onClick={onReceipt} disabled={busy} className="group flex min-h-7 w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-faint px-2 py-1 text-left transition-colors hover:bg-card-hover" title="Try it and see the receipt" data-testid="write-row">
                      {line}
                      <span className="text-11 font-medium underline-offset-2 group-hover:underline">See the receipt</span>
                    </button>
                  ) : (
                    <div className="flex min-h-7 items-center gap-3 px-2 py-1" title={ids.length > 1 ? `${ids.length} calls behind this` : undefined}>{line}</div>
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

function Helpers({ platforms }: { platforms: AccessResponse["platforms"] }) {
  // the AIs that do the same job (reading for meaning) share one row
  const rows = new Map<string, AccessResponse["platforms"]>();
  for (const p of platforms) {
    const k = HELPER_TEXT[p.platform] ?? actionText(p.actions[0]?.title ?? p.name, p.actions[0]?.verb ?? "");
    rows.set(k, [...(rows.get(k) ?? []), p]);
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      {[...rows].map(([text, ps]) => {
        const granted = ps.some((p) => p.actions.some((x) => x.granted));
        return (
          <div key={text} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-2.5 last:border-b-0" data-testid="helper-row">
            {/* what it does first, then who does it */}
            <span className="flex min-w-[12rem] flex-1 flex-col gap-1">
              <span className="text-13 font-medium">{text}</span>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-11 text-muted-foreground">
                {ps.length > 1 ? "One of " : "By "}
                {ps.map((p) => (
                  <span key={p.platform} className="flex items-center gap-1"><SourceLogo platform={p.platform} size={12} />{p.name}</span>
                ))}
              </span>
            </span>
            {granted ? <Badge tone="success">{COPY.allowed}</Badge> : <Badge tone="outline">{COPY.notAllowed}</Badge>}
          </div>
        );
      })}
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
  const failed = total.filter((r) => !r.ok && !r.blockedByGrant).length;
  return (
    <div className="flex items-center gap-3" data-testid="tick-strip">
      <div className="flex h-6 flex-1 items-end gap-0.5" aria-label={`${total.length} calls in the last 24 hours`}>
        {ticks.map((t, i) => (
          <span key={i} title={`${new Date(t.from).toLocaleTimeString(undefined, { hour: "numeric" })}: ${t.n} calls`}
            className={cn("flex-1 rounded-sm", t.n === 0 ? "h-1.5 bg-muted" : t.bad ? "h-full bg-destructive-text/70" : "h-full bg-success-text/60")} />
        ))}
      </div>
      <span className="tnum shrink-0 text-11 text-muted-foreground">{total.length}{total.length === rows.length && rows.length >= 100 ? "+" : ""} calls in 24h · {declined || failed
        ? <span className="font-medium text-destructive-text" data-testid="tick-problems">{[declined && `${declined} not allowed`, failed && `${failed} did not work`].filter(Boolean).join(" · ")}</span>
        : <span data-testid="tick-problems">all worked</span>}</span>
    </div>
  );
}

/** A call in plain words: "Read Slack messages", "Check whether two people are the same". */
function plainLine(r: LedgerRow): string {
  const m = /^(\w+) (.+) for search$/.exec(r.summary);
  if (r.actor === "indexer" && m) {
    const [, step, what] = m;
    if (step === "partitions") return `Checked which ${what} to read`;
    if (step === "hydrate") return `Read ${what} in full`;
    return `Read ${what}`;
  }
  return r.summary || r.sentence;
}
/** What Search asked for, in words: "delete a Gmail message". */
function askedFor(r: LedgerRow): string {
  const verb = ({ DELETE: "delete", POST: "create", PUT: "change", PATCH: "change", GET: "read" } as Record<string, string>)[r.method.toUpperCase()] ?? "use";
  const noun = r.path.split("/").filter((p) => p && !p.includes("{") && !p.startsWith(":")).pop()?.replace(/[-_]/g, " ") ?? "";
  const one = noun.endsWith("ies") ? `${noun.slice(0, -3)}y` : noun.endsWith("s") ? noun.slice(0, -1) : noun;
  return one ? `${verb} a ${platformName(r.platform)} ${one}` : `${verb} something in ${platformName(r.platform)}`;
}

/** The detail's lead sentence: what happened, in one line a person reads first. */
function callSentence(r: LedgerRow): string {
  if (r.blockedByGrant) return `Search asked to ${askedFor(r)}. One said no, because Search may only read. ${platformName(r.platform)} was never asked.`;
  if (!r.ok) return `${plainLine(r)}. It did not work this time (${platformName(r.platform)} answered with an error).`;
  return `${plainLine(r)}.`;
}

const outcome = (r: LedgerRow) => (r.blockedByGrant ? "Not allowed" : r.ok ? "Done" : "Did not work");

type Group = { r: LedgerRow; n: number };
/** Neighbouring calls that read the same and ended the same way become one line with a count. */
function collapse(rows: LedgerRow[]): Group[] {
  const out: Group[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last.r.platform === r.platform && last.r.actor === r.actor && plainLine(last.r) === plainLine(r) && outcome(last.r) === outcome(r) && last.r.status === r.status) last.n++;
    else out.push({ r, n: 1 });
  }
  return out;
}

function Ledger({ rows, loading, onPick, picked, highlight, details }: { rows: LedgerRow[]; loading: boolean; onPick: (r: LedgerRow) => void; picked: string | null; highlight: string | null; details: boolean }) {
  const groups = useMemo(() => collapse(rows), [rows]);
  if (loading) return <Skeleton className="h-64 w-full rounded-lg" />;
  if (rows.length === 0) return <p className="text-13 text-muted-foreground">No calls yet.</p>;
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card text-xs" role="list" aria-label="Activity" data-testid="ledger">
      {groups.map(({ r, n }) => (
        <button
          key={r.id}
          type="button"
          role="listitem"
          aria-label={`${fmtClock(r.at)}, ${plainLine(r)}, ${outcome(r)}${n > 1 ? `, ${n} times` : ""}`}
          aria-pressed={picked === r.id}
          onClick={() => onPick(r)}
          className={cn(
            "flex min-h-[2.75rem] w-full items-center gap-3 border-b border-border px-3 py-1.5 text-left transition-colors duration-100 last:border-b-0 hover:bg-faint",
            picked === r.id && "bg-muted hover:bg-muted",
            highlight === r.id && "bg-destructive-text/[0.07] hover:bg-destructive-text/[0.09]",
          )}
        >
          <span className="tnum w-[3.75rem] shrink-0 text-11 text-muted-foreground">{fmtClock(r.at)}</span>
          <SourceLogo platform={r.platform} size={14} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-center gap-1.5">
              {r.actor === "assistant" && <Badge>Assistant</Badge>}
              <span className="truncate" title={plainLine(r)}>{plainLine(r)}</span>
              {n > 1 && <span className="tnum shrink-0 text-muted-foreground" data-testid="ledger-count">{n} times</span>}
            </span>
            {details && <span className="truncate font-mono text-11 text-muted-foreground" data-copy="advanced">{r.sentence} · {r.actionId.replace("conn_mod_def::", "")}</span>}
          </span>
          {details && <span className="tnum hidden w-[4rem] shrink-0 text-right text-11 text-muted-foreground sm:block">{r.ms} ms</span>}
          <span className="flex shrink-0 justify-end">
            {details
              ? <Badge tone={r.blockedByGrant ? "destructive" : r.ok ? "success" : "warning"} mono>{r.blockedByGrant ? `declined, ${r.status}` : r.status}</Badge>
              : <Badge tone={r.blockedByGrant ? "destructive" : r.ok ? "success" : "warning"}>{outcome(r)}</Badge>}
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
/** "Index Gmail threads for search" under the verb Read reads "Read Gmail threads, to make them searchable"; a title that starts with its verb ("Delete a Gmail message" under Delete) drops it. */
function actionText(t: string, verb: string): string {
  if (/^Index (.+) for search$/.test(t)) return t.replace(/^Index (.+) for search$/, "$1, to make them searchable");
  if (verb && t.toLowerCase().startsWith(verb.toLowerCase() + " ")) return t.slice(verb.length + 1);
  return t;
}
