import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Calendar as CalendarIcon, Check, ExternalLink, Mail, X } from "lucide-react";
import { useOneConnect } from "@withone/connect/react";
import type { LedgerRow } from "@rill/core/api-types";
import { CALENDAR_PROVIDERS, platformLabel } from "@rill/core/types";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useMailbox, useMailboxId } from "@/lib/mailbox";
import { keys, useAccess, useCalendarReceiptDemo, useGoals, useReceiptDemo, useSettings, useVips } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { cn, fmtClock, fmtDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { Skeleton } from "@/components/ui/Skeleton";
import { LoadError } from "@/components/ui/EmptyState";
import { IconButton } from "@/components/ui/IconButton";
import { Logo } from "@/components/Logo";

/** The ungranted rows that have a one-click receipt (or, for the calendar,
 *  a one-click connect) sitting right behind them. */
const MAIL_DELETE = new Set(["gmail.delete-message", "outlook.delete-message"]);
const CALENDAR_DELETE = new Set(["calendar.events-delete", "outlook-calendar.events-delete"]);
const RECEIPT_ACTIONS = new Set([...MAIL_DELETE, ...CALENDAR_DELETE, "calendar.connect"]);

export function Access() {
  const mailboxId = useMailboxId();
  const { mailbox } = useMailbox();
  const qc = useQueryClient();
  const q = useAccess(mailboxId);
  const demo = useReceiptDemo(mailboxId);
  const calDemo = useCalendarReceiptDemo(mailboxId);
  const [detail, setDetail] = useState<LedgerRow | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [highlightPlatform, setHighlightPlatform] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const a = q.data;
  const outlook = mailbox?.mailProvider === "outlook-mail";
  const mailName = outlook ? "Outlook" : "Gmail";
  // The calendar card names the connected one, or the one that goes with the mail.
  const calendarKey = mailbox?.calendarProvider ?? (outlook ? "outlook-calendar" : "google-calendar");
  const calendarName = CALENDAR_PROVIDERS[calendarKey].label;
  const connectCalendar = useOneConnect({
    authorizeUrl: "/api/one/authorize",
    connector: calendarKey,
    onSuccess: () => { qc.invalidateQueries({ queryKey: keys.me }); qc.invalidateQueries({ queryKey: keys.access(mailboxId) }); },
    onError: (message) => toast({ title: `Could not connect ${calendarName}`, detail: message, tone: "destructive" }),
  });

  useEffect(() => {
    if (!highlight) return;
    const t = setTimeout(() => { setHighlight(null); setHighlightPlatform(null); }, 8000);
    return () => clearTimeout(t);
  }, [highlight]);

  const showReceipt = () => {
    demo.mutate(undefined, {
      onSuccess: (row) => { setHighlight(row.id); setHighlightPlatform(row.platform); setDetail(row); },
      onError: (e) => toast({ title: "No receipt", detail: e.message, tone: "destructive" }),
    });
  };
  const showCalendarReceipt = () => {
    calDemo.mutate(undefined, {
      onSuccess: (row) => { setHighlight(row.id); setHighlightPlatform(row.platform); setDetail(row); },
      onError: (e) => toast({ title: "No receipt", detail: e.message, tone: "destructive" }),
    });
  };
  const onScopeClick = (action: string) => {
    if (MAIL_DELETE.has(action)) showReceipt();
    else if (CALENDAR_DELETE.has(action)) showCalendarReceipt();
    else if (action === "calendar.connect") connectCalendar.open();
  };
  const disconnect = async () => {
    setDisconnecting(true);
    try {
      await api.disconnect();
      await qc.invalidateQueries({ queryKey: keys.me });
      await qc.invalidateQueries({ queryKey: keys.access(mailboxId) });
      toast({ title: "Rill is disconnected", detail: "The grant still exists in your One account. Revoke it there to end access." });
    } catch (e) {
      toast({ title: "Could not disconnect", detail: (e as Error).message, tone: "destructive" });
    } finally { setDisconnecting(false); }
  };

  const statusTone = a?.grant.status === "active" ? "success" : a?.grant.status === "none" ? "neutral" : "destructive";
  const statusLabel = { active: "Active", reconnect_required: "Reconnect required", revoked: "Revoked", none: "No grant" }[a?.grant.status ?? "none"];
  const granted = a?.grant.scopes.filter((s) => s.granted).length ?? 0;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[880px] flex-col gap-5 px-6 pb-12 pt-7">
          <header>
            <h1 className="text-xl font-semibold tracking-tight">Access</h1>
            <p className="mt-0.5 text-13 text-muted-foreground">The accounts you connected and what Rill can do with them. Secured by One.</p>
          </header>

          {q.isError && !a ? (
            <LoadError what="Access" error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} className="rounded-lg border border-border bg-card py-10" />
          ) : !a ? (
            <Skeleton className="h-[92px] w-full rounded-lg" />
          ) : (
            <div className="flex items-start gap-4 rounded-lg border border-border bg-card p-4">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><Mail className="size-4 stroke-[1.75]" /></span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-13 font-semibold">{mailName} · Custom access</span>
                  <Badge tone={statusTone}>{statusLabel}</Badge>
                  {a.grant.mode === "fixture" && <Badge tone="outline">Sample, replayed</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  Granted by <span className="text-foreground">{a.grant.holder}</span> · <span className="tnum">{granted} of {a.grant.scopes.length}</span> actions · owned in {mailbox?.source === "sample" ? "her" : "your"} One account
                </p>
                <p className="text-11 text-muted-foreground">
                  Disconnect stops Rill from using the grant on this device. To end access everywhere, revoke the connection in your One account.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {a.grant.oneActivityUrl && (
                  <a href={a.grant.oneActivityUrl} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-card-hover hover:text-foreground">
                    Manage in One <ExternalLink className="size-[12px]" />
                  </a>
                )}
                <ConfirmButton size="sm" onConfirm={() => void disconnect()} disabled={a.grant.status !== "active" || disconnecting} confirmLabel="Click again to disconnect">Disconnect Rill</ConfirmButton>
              </div>
            </div>
          )}

          {a && (
            <div className="flex items-start gap-4 rounded-lg border border-border bg-card p-4">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><CalendarIcon className="size-4 stroke-[1.75]" /></span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-13 font-semibold">{calendarName} · Custom access</span>
                  {mailbox?.calendarProvider ? <Badge tone={statusTone}>{statusLabel}</Badge> : <Badge tone="outline">Not connected</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  {mailbox?.calendarProvider
                    ? "Rill can answer invites and create events. It cannot delete your meetings."
                    : `Connect ${calendarName} to see your day beside your mail and answer invites in the thread.`}
                </p>
              </div>
              {!mailbox?.calendarProvider && (
                <Button size="sm" variant="ghost" disabled={connectCalendar.status === "connecting"} loading={connectCalendar.status === "connecting"} onClick={connectCalendar.open}>
                  Connect {calendarName}
                </Button>
              )}
            </div>
          )}

          {!(q.isError && !a) && (<>
          <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <Logo size={14} />
              <span className="text-13 font-semibold">Rill</span>
              <Badge tone="outline">Agent</Badge>
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <p className="label-caps">Instructions</p>
                <Link to="/settings/goals" className="text-11 text-muted-foreground hover:text-foreground hover:underline">
                  Edit in Settings
                </Link>
              </div>
              <div className="rounded-md border border-border bg-faint p-3">
                <Instructions mailboxId={mailboxId} />
              </div>
            </div>
            <div>
              <p className="label-caps mb-1.5">Available actions</p>
              <div className="overflow-hidden rounded-lg border border-border">
                {(a?.grant.scopes ?? []).map((s) => {
                  const clickable = !s.granted && RECEIPT_ACTIONS.has(s.action);
                  const label = s.granted ? "On" : s.action === "calendar.connect" ? "Connect" : clickable ? "See the receipt" : "Off";
                  const inner = (
                    <>
                      <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full", s.granted ? "bg-foreground text-background" : "border border-border-strong text-muted-foreground")} aria-hidden>
                        {s.granted ? <Check className="size-3 stroke-[2.5]" /> : <X className="size-3" />}
                      </span>
                      <span className={cn("w-[200px] shrink-0 truncate font-mono text-xs", !s.granted && "text-muted-foreground")}>{s.action}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{s.why}</span>
                      <span className={cn("shrink-0 text-xs", s.granted ? "font-medium" : clickable ? "font-medium underline-offset-2 group-hover:underline" : "text-muted-foreground")}>{label}</span>
                    </>
                  );
                  return clickable ? (
                    <button key={s.action} type="button" onClick={() => onScopeClick(s.action)} className="group flex h-11 w-full items-center gap-3 border-b border-border bg-faint px-3 text-left transition-colors last:border-b-0 hover:bg-card-hover">
                      {inner}
                    </button>
                  ) : (
                    <div key={s.action} className={cn("flex h-11 items-center gap-3 border-b border-border px-3 last:border-b-0", !s.granted && "bg-faint")}>
                      {inner}
                    </div>
                  );
                })}
              </div>
              <p className="mt-1.5 text-11 text-muted-foreground">Access is set when you sign in with One. Change or revoke it in your One account any time.</p>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <h2 className="text-13 font-semibold">Activity</h2>
            <div className="flex items-center gap-3">
              {a && (
                <span className="tnum text-11 text-muted-foreground">
                  {a.today.calls} calls today · <span className={cn(a.today.declined > 0 && "font-medium text-destructive-text")}>{a.today.declined} declined</span>
                </span>
              )}
              <Button size="sm" onClick={showReceipt} loading={demo.isPending}>Test a declined call</Button>
              {mailbox?.calendarProvider && <Button size="sm" variant="ghost" onClick={showCalendarReceipt} loading={calDemo.isPending}>Test on calendar</Button>}
            </div>
          </div>

          {highlight && (
            <div role="status" className="fade-in flex flex-col gap-2 rounded-lg border border-border bg-faint p-3">
              <div className="flex items-center gap-3 font-mono text-xs">
                <span className="text-foreground">{platformLabel(highlightPlatform ?? "gmail")} · delete</span>
                <span className="flex-1 border-b border-dotted border-border-strong" aria-hidden />
                <span className="font-medium text-destructive-text">declined, 403</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {highlightPlatform === "google-calendar" || highlightPlatform === "outlook-calendar"
                  ? `Rill can answer invites and create events, but it cannot delete your meetings. One refused the call and ${platformLabel(highlightPlatform)} was never called. The line below is the record.`
                  : `An email hid an instruction to delete your inbox. Delete is not in the grant, so One refused the call and ${platformLabel(highlightPlatform ?? "gmail")} was never called. The line below is the record.`}
              </p>
            </div>
          )}

          <Ledger rows={a?.activity ?? []} loading={!a && !q.isError} onPick={setDetail} picked={detail?.id ?? null} highlight={highlight} />
          </>)}

          <p className="text-xs text-muted-foreground">Sending stays your keypress. The AI has no way to send.</p>
        </div>
      </div>

      {detail && (
        <aside className="slide-in-right flex w-[320px] shrink-0 flex-col gap-4 overflow-y-auto overflow-x-hidden border-l border-border bg-faint p-4" aria-label="Call detail">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs font-medium">{detail.action}</span>
            <IconButton label="Close" size="sm" onClick={() => setDetail(null)}><X /></IconButton>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={detail.blockedByGrant ? "destructive" : detail.ok ? "success" : "warning"} mono>{detail.blockedByGrant ? `declined, ${detail.status}` : detail.status}</Badge>
            <Badge tone="outline" mono>{detail.level}</Badge>
            <Badge tone="outline" mono>{detail.mode}</Badge>
          </div>
          {detail.blockedByGrant && (
            <p className="rounded-md border border-destructive-text/30 bg-destructive-text/[0.06] px-3 py-2 text-xs">
              Blocked by the grant. The provider was never called.
            </p>
          )}
          <dl className="grid min-w-0 grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
            {([
              ["When", fmtDateTime(detail.at)],
              ["Platform", detail.platform],
              ["Method", detail.method],
              ["Path", detail.path],
              ["Took", `${detail.ms} ms`],
              ["Summary", detail.summary],
              ["Refusal", detail.refusal ?? "none"],
              ["Engine", detail.engine ?? "none"],
              ["Model", detail.model ?? "none"],
              ["Note", detail.note ?? "none"],
            ] as const).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className={cn("min-w-0 break-words", (k === "Path" || k === "Method" || k === "Platform" || k === "Model") && "break-all font-mono text-11")}>{v}</dd>
              </div>
            ))}
          </dl>
        </aside>
      )}
    </div>
  );
}

/** Your goals and rules, in your own words. Reads the same goals/VIPs/settings
 *  Settings already stores; nothing new is written here. */
function Instructions({ mailboxId }: { mailboxId: string }) {
  const settingsQ = useSettings(mailboxId);
  const goalsQ = useGoals(mailboxId);
  const vipsQ = useVips(mailboxId);
  if (settingsQ.isPending || goalsQ.isPending || vipsQ.isPending) return <Skeleton className="h-16 w-full" />;
  const me = settingsQ.data?.me;
  const goals = (goalsQ.data ?? []).filter((g) => !g.paused);
  const vips = vipsQ.data ?? [];
  return (
    <div className="flex flex-col gap-1.5 text-13 leading-relaxed text-foreground/90">
      <p>{me ? `I'm ${me}.` : "No profile set yet."}</p>
      {goals.length > 0 && <p>Goals: {goals.map((g) => `${g.title} (${g.detail})`).join("; ")}.</p>}
      {vips.length > 0 && <p>VIPs: {vips.map((v) => v.name).join(", ")}.</p>}
      <p className="text-muted-foreground">Delete is never asked for. Sending only happens on your keypress.</p>
    </div>
  );
}

function Ledger({ rows, loading, onPick, picked, highlight }: { rows: LedgerRow[]; loading: boolean; onPick: (r: LedgerRow) => void; picked: number | null; highlight: number | null }) {
  if (loading) return <Skeleton className="h-64 w-full rounded-lg" />;
  if (rows.length === 0) return <p className="text-13 text-muted-foreground">No calls yet.</p>;
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card text-xs" role="list" aria-label="Activity">
      <div aria-hidden className="flex h-8 items-center gap-3 border-b border-border bg-faint px-3 text-11 font-medium text-muted-foreground">
        <span className="w-[60px] shrink-0">Time</span>
        <span className="w-[112px] shrink-0">Platform</span>
        <span className="w-[200px] shrink-0">Action</span>
        <span className="min-w-0 flex-1">Summary</span>
        <span className="w-[96px] shrink-0 text-right">Status</span>
      </div>
      {rows.map((r) => (
        <button
          key={r.id}
          type="button"
          role="listitem"
          aria-label={`${fmtClock(r.at)}, ${r.platform} ${r.action}, ${r.blockedByGrant ? `declined, ${r.status}` : r.status}. ${r.summary}`}
          aria-pressed={picked === r.id}
          onClick={() => onPick(r)}
          className={cn(
            "flex h-8 w-full items-center gap-3 border-b border-border px-3 text-left transition-colors duration-100 last:border-b-0 hover:bg-faint",
            picked === r.id && "bg-muted hover:bg-muted",
            highlight === r.id && "bg-destructive-text/[0.07] hover:bg-destructive-text/[0.09]",
          )}
        >
          <span className="tnum w-[60px] shrink-0 font-mono text-11 text-muted-foreground">{fmtClock(r.at)}</span>
          <span className="flex w-[112px] shrink-0 items-center gap-1.5 truncate">
            <span className="truncate">{r.platform}</span>
            <span className={cn("text-11", r.level === "write" ? "text-foreground/70" : "text-muted-foreground/70")}>{r.level}</span>
          </span>
          <span className="w-[200px] shrink-0 truncate font-mono text-11">{r.action}</span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{r.summary}</span>
          <span className="flex w-[96px] shrink-0 justify-end">
            <Badge tone={r.blockedByGrant ? "destructive" : r.ok ? "success" : "warning"} mono>{r.blockedByGrant ? `declined, ${r.status}` : r.status}</Badge>
          </span>
        </button>
      ))}
    </div>
  );
}
