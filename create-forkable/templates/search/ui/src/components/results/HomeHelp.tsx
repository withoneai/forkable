// Home helpers: sentences built from the person's own data (the placeholder, the
// tip line and the Try chips, D48), and the first-index panel (D49).
import { useEffect, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import type { ApiSource } from "@/contract/api-types";
import { useMe, useSources } from "@/lib/queries";
import { STATUS_WORD } from "@/lib/copy";
import { toast } from "@/lib/toast";
import { fmtNum, platformName } from "@/lib/utils";
import { SourceLogo } from "@/components/SourceLogo";
import { useEntityOptions } from "./entityOptions";

/**
 * Example sentences the search box understands, made from the person's own
 * people and tools. A name is only used when it reads one way: a first name
 * shared with anyone else falls back to the full name, and a full name two
 * people share is left out (it would come back as a question).
 */
export function useExamples(): string[] {
  const ents = useEntityOptions();
  const me = useMe();
  const sources = useSources();
  return useMemo(() => {
    const firsts = new Map<string, number>();
    const fulls = new Map<string, number>();
    for (const e of ents) {
      const f = e.name.split(/\s+/)[0]!.toLowerCase();
      firsts.set(f, (firsts.get(f) ?? 0) + 1);
      fulls.set(e.name.toLowerCase(), (fulls.get(e.name.toLowerCase()) ?? 0) + 1);
    }
    const people = ents.filter((e) => e.type === "person" && !e.self && (fulls.get(e.name.toLowerCase()) ?? 0) === 1 && /^[\p{L}][\p{L}' -]+$/u.test(e.name));
    const nameOf = (n: string) => { const f = n.split(/\s+/)[0]!; return firsts.get(f.toLowerCase()) === 1 ? f : n; };
    const vipIds = me.data?.settings?.vipEntityIds ?? [];
    const vip = people.find((p) => vipIds.includes(p.id)) ?? people[0];
    const second = people.find((p) => p !== vip);
    const third = people.find((p) => p !== vip && p !== second);
    const company = ents.find((e) => e.type === "company" && !e.self && (fulls.get(e.name.toLowerCase()) ?? 0) === 1);
    const plats = new Set((sources.data?.sources ?? []).map((s) => s.platform));
    const mail = plats.has("gmail") || plats.has("outlook-mail");
    const out = [
      vip && mail && `emails from ${nameOf(vip.name)} last week`,
      second && `meetings with ${nameOf(second.name)} this month`,
      (plats.has("hubspot") || plats.has("attio")) && "open deals",
      plats.has("slack") && "slack messages this week",
      mail && "what needs me",
      company && `people at ${company.name}`,
      third && plats.has("linear") && `issues assigned to me`,
      mail && "unread emails with an attachment",
      third && `${nameOf(third.name)}'s notes`,
      "upcoming meetings",
    ];
    return [...new Set(out.filter((x): x is string => typeof x === "string"))];
  }, [ents, me.data, sources.data]);
}

const firstRead = (s: ApiSource) => s.health.status === "new" || (s.health.status === "syncing" && !s.health.lastSuccessAt);
/** Stopped before its first good read: it will not come in on its own, so it is shown with what to do. */
const STOPPED = new Set<ApiSource["health"]["status"]>(["error", "degraded", "rate_limited", "auth_needed", "grant_blocked"]);
const firstStopped = (s: ApiSource) => STOPPED.has(s.health.status) && !s.health.lastSuccessAt;

/** Why a tool stopped before its first read, and what to do, in plain words. */
export function stoppedReason(s: ApiSource): { why: string; todo: string } {
  const tool = platformName(s.platform);
  switch (s.health.status) {
    case "auth_needed": return { why: `${tool} asked for a new sign-in.`, todo: `Reconnect ${tool} in One, then update it here.` };
    case "grant_blocked": return { why: `Search is not allowed to read ${tool}.`, todo: `Allow ${tool} in One, then update it here.` };
    case "rate_limited": {
      const at = s.health.retryAt ? new Date(s.health.retryAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
      return { why: `${tool} asked Search to slow down.`, todo: at ? `It tries again on its own at ${at}.` : "It tries again on its own soon." };
    }
    default: {
      const msg = s.health.lastError?.message?.trim();
      return { why: msg ? `${tool} could not be read: ${msg.replace(/[.\s]+$/, "")}.` : `${tool} could not be read.`, todo: "Open it to see what happened and try again." };
    }
  }
}

/**
 * While any source reads for the first time: each tool with a bar and a count, and
 * one sentence that says search already works. A tool that stopped before its first
 * read stays in the panel with why and what to do, and "Everything is in" never
 * shows while one has. Goes away when everything is in, with one notice.
 */
export function FirstIndex({ sources }: { sources: ApiSource[] }) {
  const reading = sources.filter(firstRead);
  const stopped = sources.filter(firstStopped);
  useSources({ poll: reading.length ? 2000 : false });
  const was = useRef(false);
  useEffect(() => {
    if (reading.length) { was.current = true; return; }
    if (!was.current) return;
    // a tool that stopped is not "in": no notice while one has
    if (stopped.length) return;
    was.current = false;
    const total = sources.reduce((n, s) => n + s.health.itemCount, 0);
    const tools = new Set(sources.map((s) => s.platform)).size;
    toast({ title: "Everything is in", detail: `${fmtNum(total)} items from ${tools} ${tools === 1 ? "tool" : "tools"}. Search has all of it now.` });
  }, [reading.length, stopped.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!reading.length && !stopped.length) return null;

  // one row per tool: every source of a platform that is still reading, summed
  const rows = new Map<string, { done: number; estimate: number | null; started: boolean }>();
  for (const s of reading) {
    const r = rows.get(s.platform) ?? { done: 0, estimate: 0, started: false };
    const p = s.health.progress;
    r.done += p?.done ?? s.health.itemCount;
    r.estimate = r.estimate === null || p?.estimate == null ? null : r.estimate + p.estimate;
    r.started ||= s.health.status === "syncing";
    rows.set(s.platform, r);
  }
  // one row per stopped tool (the first stopped source of each platform)
  const stops = new Map<string, ApiSource>();
  for (const s of stopped) if (!stops.has(s.platform) && !rows.has(s.platform)) stops.set(s.platform, s);
  const list = [...rows.entries()].sort((a, b) => pct(a[1]) - pct(b[1]));
  const stopNames = [...stops.keys()].map(platformName);
  const stopText = stopNames.length === 1 ? `${stopNames[0]} stopped before it came in.` : `${stopNames.length} tools stopped before they came in.`;
  let sentence: string;
  if (list.length) {
    const [lead, lr] = list[0]!;
    const more = list.length - 1;
    const leadText = lr.estimate ? `${platformName(lead)} is ${pct(lr)}% in` : lr.started ? `${platformName(lead)} is still coming in` : `${platformName(lead)} is about to start`;
    sentence = `You can search now. ${leadText}${more ? `, and ${more} more ${more === 1 ? "tool is" : "tools are"} on the way.` : "."}${stops.size ? ` ${stopText}` : ""}`;
  } else {
    sentence = `You can search what is in. ${stopText}`;
  }

  return (
    <section className="fade-in flex flex-col gap-3 rounded-lg border border-border bg-card p-4" aria-label="First update" data-testid="first-index">
      <p className="text-13 text-foreground" data-testid="first-index-sentence">{sentence}</p>
      <div className="flex flex-col gap-2">
        {list.map(([p, r]) => (
          <div key={p} className="flex items-center gap-2.5 text-xs" data-testid="first-index-row">
            <SourceLogo platform={p} size={14} />
            <span className="w-28 shrink-0 truncate">{platformName(p)}</span>
            <div className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={`${platformName(p)} first update`}
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={r.estimate ? pct(r) : undefined}>
              {r.estimate
                ? <span className="absolute inset-y-0 left-0 rounded-full bg-accent transition-[width] duration-500" style={{ width: `${pct(r)}%` }} />
                : <span className="absolute inset-y-0 left-0 w-1/4 animate-pulse rounded-full bg-accent/60" />}
            </div>
            <span className="tnum w-36 shrink-0 text-right text-muted-foreground">
              {r.estimate ? `${fmtNum(r.done)} of about ${fmtNum(r.estimate)}` : r.done ? `${fmtNum(r.done)} so far` : "Starting"}
            </span>
          </div>
        ))}
        {[...stops.entries()].map(([p, s]) => {
          const why = stoppedReason(s);
          return (
            <div key={p} className="flex items-start gap-2.5 text-xs" data-testid="first-index-stopped" data-status={s.health.status}>
              <SourceLogo platform={p} size={14} />
              <span className="w-28 shrink-0 truncate">{platformName(p)}</span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-foreground"><span className="font-medium text-warning-text">{STATUS_WORD[s.health.status]}</span> · {why.why}</span>
                <span className="text-muted-foreground">{why.todo}</span>
              </div>
              <Link to={`/sources/${s.id}`} className="shrink-0 rounded-md px-1.5 py-0.5 font-medium text-foreground underline-offset-2 hover:underline" data-testid="first-index-open">
                Open {platformName(p)}
              </Link>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function pct(r: { done: number; estimate: number | null }): number {
  return r.estimate ? Math.min(99, Math.floor((r.done / r.estimate) * 100)) : 0;
}
