import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowUpRight, ChevronDown, ChevronRight, Copy, MapPin, Paperclip, Search as SearchIcon, Sparkles, Video, X } from "lucide-react";
import type { ItemDetail, ResultRow } from "@/contract/api-types";
import { useEntity, useItem } from "@/lib/queries";
import { Matches } from "@/components/entity/Matches";
import { cn, fmtDateTime, fmtMoney, fmtRange, fmtRelative, KIND_LABEL, LANE_LABEL, MOD, displayName, nameForAddress, ownerName, stageLabel } from "@/lib/utils";
import { SourceLogo } from "@/components/SourceLogo";
import { AccountChip } from "@/components/AccountChip";
import { useAccounts } from "@/lib/accounts";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { IconButton } from "@/components/ui/IconButton";
import { Kbd } from "@/components/ui/Kbd";
import { Skeleton } from "@/components/ui/Skeleton";
import { LoadError } from "@/components/ui/EmptyState";
import { StateIcon } from "@/components/results/ResultRow";

/** Wraps every case-insensitive occurrence of the query words, and the cited quote, in <mark>. */
function Marked({ text, words, quote }: { text: string; words: string[]; quote?: string | null }) {
  const needles = [...(quote ? [quote] : []), ...words.filter((w) => w.length > 2)];
  if (!needles.length) return <>{text}</>;
  const esc = needles.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const re = new RegExp(`(${esc})`, "gi");
  return (
    <>
      {text.split(re).map((p, i) => {
        if (i % 2 === 0) return <span key={i}>{p}</span>;
        const isQuote = !!quote && p.toLowerCase() === quote.toLowerCase();
        return <mark key={i} data-quote={isQuote || undefined} className={cn(isQuote && "ring-2 ring-accent/60")}>{p}</mark>;
      })}
    </>
  );
}

export function PreviewPane({ row: given, words, quote, onClose, onNext, onAsk, takeover }: {
  row: ResultRow; words: string[]; quote: string | null; onClose: () => void; onNext: () => void; onAsk: () => void; takeover?: boolean;
}) {
  const q = useItem(given.id);
  // A selected or cited item outside the current list arrives as a bare { id } (the list
  // refreshes under it while a source syncs): the header reads the item's own row once it loads.
  const row: ResultRow = q.data?.row ?? given;
  const known = !!row.platform;
  const accounts = useAccounts();
  const acctLabel = row.sourceName?.includes(" · ") ? row.sourceName.split(" · ").slice(1).join(" · ") : null;
  const acct = acctLabel ? accounts.find(row.platform, acctLabel) : undefined;
  const body = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!quote || !q.data) return;
    const t = setTimeout(() => body.current?.querySelector("[data-quote]")?.scrollIntoView({ block: "center", behavior: "smooth" }), 60);
    return () => clearTimeout(t);
  }, [quote, q.data, row.id]);
  useEffect(() => { body.current?.scrollTo({ top: 0 }); }, [row.id]);

  const copy = () => {
    if (!row.url) return;
    void navigator.clipboard.writeText(row.url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); });
  };

  return (
    <section aria-label="Preview" data-testid="preview" className={cn("flex min-h-0 flex-col bg-card", takeover ? "absolute inset-0 z-20" : "h-full")}>
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        {known ? <SourceLogo platform={row.platform} size={16} /> : <Skeleton className="size-4 shrink-0 rounded-sm" />}
        <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-xs text-muted-foreground">{known ? <>Found in <span className="text-foreground">{row.sourceName.split(" · ")[0]}</span>{acctLabel ? <AccountChip short={acct?.short ?? acctLabel} mark={acct?.mark} label={acctLabel} /> : <span>· {KIND_LABEL[row.kind]}</span>}</> : "Loading"}</span>
        {row.url && (
          <a href={row.url} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-foreground transition-colors hover:bg-card-hover" title="Open in the source app (O)">
            Open in {row.sourceName.split(" · ")[0]}<ArrowUpRight className="size-3.5" />
          </a>
        )}
        <IconButton label={copied ? "Copied" : "Copy link"} hint="Y" size="sm" onClick={copy} disabled={!row.url}><Copy /></IconButton>
        <IconButton label="Close preview" hint="Esc" size="sm" onClick={onClose}><X /></IconButton>
      </header>
      <div ref={body} className="min-h-0 flex-1 overflow-y-auto">
        {q.isError ? (
          <LoadError what="This item" error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />
        ) : !q.data ? (
          <div className="flex flex-col gap-3 p-4"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-1/2" /><Skeleton className="mt-3 h-24 w-full" /></div>
        ) : (
          <Body d={q.data} words={words} quote={quote} />
        )}
      </div>
      <footer className="flex h-8 shrink-0 items-center gap-3 border-t border-border bg-faint px-3 text-11 text-muted-foreground">
        <button type="button" onClick={onAsk} className="inline-flex items-center gap-1.5 hover:text-foreground"><Sparkles className="size-3" />Ask about this<Kbd className="ml-0.5">{MOD}⇧J</Kbd></button>
        <span className="ml-auto inline-flex items-center gap-1.5">Open <Kbd>O</Kbd></span>
        <button type="button" onClick={onNext} className="inline-flex items-center gap-1.5 hover:text-foreground">Next <Kbd>J</Kbd></button>
      </footer>
    </section>
  );
}

function Classification({ d }: { d: ItemDetail }) {
  const c = d.classification;
  if (!c.lane && c.importance == null) return null;
  const by = c.by === "jev" ? "by Jev" : c.by === "rules" ? "by rules" : c.by === "fixture" ? "by Jev (sample)" : "";
  const level = c.importance == null ? null : c.importance >= 0.75 ? "important" : c.importance >= 0.5 ? "useful" : c.importance >= 0.25 ? "routine" : "noise";
  return (
    <p className="text-11 text-muted-foreground" data-testid="classification">
      {c.lane && <>Lane <span className="font-medium text-foreground">{LANE_LABEL[c.lane]}</span></>}
      {level && <>{c.lane ? " · " : ""}{level}</>}
      {by && <> · {by}</>}
    </p>
  );
}

function Props({ items: all }: { items: { label: string; value: ReactNode }[] }) {
  // a provider id is not a value anyone reads (an Attio editor UUID, a HubSpot owner number)
  const items = all.filter((p) => !(typeof p.value === "string" && (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(p.value) || (/owner|edited by/i.test(p.label) && /^\d+$/.test(p.value)))));
  if (!items.length) return null;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-lg border border-border bg-faint p-3">
      {items.map((p) => (
        <div key={p.label} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-11 text-muted-foreground">{p.label}</dt>
          <dd className="truncate text-13">{p.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function People({ d }: { d: ItemDetail }) {
  const nav = useNavigate();
  const ppl = d.row.people;
  if (!ppl.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {ppl.slice(0, 8).map((p) => (
        <button key={`${p.entityId}-${p.role}`} type="button" onClick={() => nav(`/people/${p.entityId}`)} className="inline-flex h-6 items-center gap-1.5 rounded-full border border-border bg-card pl-0.5 pr-2 text-xs transition-colors hover:bg-card-hover">
          <Avatar name={p.name} size="sm" /><span>{p.name}</span><span className="text-11 text-muted-foreground">{p.role}</span>
        </button>
      ))}
    </div>
  );
}

function Related({ rows: all }: { rows: ResultRow[] }) {
  // the same person or company from two CRMs is one related entry
  const seen = new Set<string>();
  const rows = all.filter((r) => { if (r.kind !== "person" && r.kind !== "company") return true; const k = `${r.kind}|${r.title.toLowerCase()}`; if (seen.has(k)) return false; seen.add(k); return true; });
  if (!rows.length) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="label-caps">Related</p>
      {rows.map((r) => (
        <Link key={r.id} to={`/item/${r.id}`} className="flex h-8 items-center gap-2 rounded-md px-1.5 text-xs transition-colors hover:bg-card-hover">
          <SourceLogo platform={r.platform} size={14} />
          <span className="w-14 shrink-0 text-11 text-muted-foreground">{KIND_LABEL[r.kind]}</span>
          <span className="min-w-0 flex-1 truncate">{r.kind === "message" && r.snippet ? <><span className="text-muted-foreground">{r.title} · </span>{r.snippet}</> : r.title}</span>
          <span className="tnum text-11 text-muted-foreground">{fmtRelative(r.occurredAt)}</span>
        </Link>
      ))}
    </div>
  );
}

function Messages({ d, words, quote }: { d: ItemDetail; words: string[]; quote: string | null }) {
  const msgs = d.parts.filter((p) => p.kind === "message");
  // The matching message open, the others folded (search-ux-mobbin.md 2.5).
  const match = (() => {
    const needle = (quote ?? words[0] ?? "").toLowerCase();
    const i = needle ? msgs.findIndex((m) => m.text.toLowerCase().includes(needle)) : -1;
    return i >= 0 ? i : msgs.length - 1;
  })();
  const [open, setOpen] = useState<Set<number>>(new Set([match]));
  useEffect(() => setOpen(new Set([match])), [d.row.id, match]);
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border">
      {msgs.map((m, i) => {
        const isOpen = open.has(i);
        return (
          <div key={i} className="border-b border-border last:border-b-0">
            <button type="button" onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })} aria-expanded={isOpen}
              className="flex h-9 w-full items-center gap-2 px-3 text-left transition-colors hover:bg-card-hover">
              <Avatar name={displayName(m.author) ?? "?"} size="sm" />
              <span className="shrink-0 text-xs font-medium" title={m.author ?? undefined}>{displayName(m.author)}</span>
              {!isOpen && <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{m.text}</span>}
              <span className="tnum ml-auto shrink-0 text-11 text-muted-foreground">{m.at ? fmtRelative(m.at) : ""}</span>
            </button>
            {isOpen && <p className="whitespace-pre-wrap px-3 pb-3 pl-10 text-13 leading-relaxed"><Marked text={m.text} words={words} quote={quote} /></p>}
          </div>
        );
      })}
    </div>
  );
}

function Sections({ d, words, quote }: { d: ItemDetail; words: string[]; quote: string | null }) {
  const secs = d.parts.filter((p) => p.kind === "section");
  if (!secs.length) return <p className="whitespace-pre-wrap text-13 leading-relaxed"><Marked text={d.body} words={words} quote={quote} /></p>;
  return (
    <div className="flex flex-col gap-3">
      {secs.map((s, i) => (
        <div key={i} className="flex flex-col gap-1">
          {s.title && <p className="text-xs font-semibold">{s.title}</p>}
          <p className="whitespace-pre-wrap text-13 leading-relaxed text-foreground/90"><Marked text={s.text} words={words} quote={quote} /></p>
        </div>
      ))}
    </div>
  );
}

function Body({ d, words, quote }: { d: ItemDetail; words: string[]; quote: string | null }) {
  const r = d.row;
  const f = r.facets;
  const nav = useNavigate();
  const head = (sub: ReactNode) => (
    <div className="flex flex-col gap-1">
      <h2 className="text-15 font-semibold leading-snug tracking-tight">{r.title}</h2>
      <p className="text-xs text-muted-foreground">{sub}</p>
      <Classification d={d} />
    </div>
  );
  const wrap = (children: ReactNode) => <div className="fade-in flex flex-col gap-4 p-4">{children}<Related rows={d.related} /></div>;

  switch (f.kind) {
    case "email_thread":
      return wrap(<>
        {head(<>{f.messageCount} {f.messageCount === 1 ? "message" : "messages"} · {fmtDateTime(r.occurredAt)}{f.hasAttachment && <span className="ml-1.5 inline-flex items-center gap-1"><Paperclip className="size-3" />attachment</span>}</>)}
        <People d={d} />
        {d.parts.length ? <Messages d={d} words={words} quote={quote} /> : <Sections d={d} words={words} quote={quote} />}
      </>);
    case "event":
      return wrap(<>
        {head(<span className="tnum">{fmtRange(f.start, f.end)}</span>)}
        <div className="flex flex-col gap-1.5 text-13">
          {f.location && !(f.joinUrl && /^(microsoft teams meeting|google meet|zoom( meeting)?)$/i.test(f.location.trim())) && <span className="inline-flex items-center gap-2"><MapPin className="size-3.5 text-muted-foreground" />{f.location}</span>}
          {f.joinUrl && <a href={f.joinUrl} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-2 font-medium underline-offset-2 hover:underline"><Video className="size-3.5 text-muted-foreground" />Join the call</a>}
        </div>
        {(f.attendees ?? []).some((a) => a.name || a.email) && <div className="flex flex-col gap-1">
          <p className="label-caps">Attendees</p>
          {(f.attendees ?? []).filter((a) => a.name || a.email).map((a) => (
            <div key={a.email ?? a.name} className="flex h-7 items-center gap-2 text-13">
              <Avatar name={a.name ?? nameForAddress(r.people, a.email) ?? a.email ?? "?"} size="sm" /><span>{a.name ?? nameForAddress(r.people, a.email) ?? a.email}</span>{!a.name && nameForAddress(r.people, a.email) && <span className="truncate text-11 text-muted-foreground">{a.email}</span>}
              <span className="ml-auto text-11 text-muted-foreground">{{ accepted: "Going", tentative: "Maybe", declined: "No", needsAction: "Invited" }[a.response ?? "needsAction"] ?? a.response}</span>
            </div>
          ))}
        </div>}
        {d.body && <div className="flex flex-col gap-1"><p className="label-caps">Description</p><p className="whitespace-pre-wrap text-13 leading-relaxed text-foreground/90"><Marked text={d.body} words={words} quote={quote} /></p></div>}
      </>);
    case "person":
    case "company": {
      const ent = r.people[0]?.entityId;
      return wrap(<>
        <div className="flex items-center gap-3">
          <Avatar name={r.title} size="lg" className={f.kind === "company" ? "rounded-md" : undefined} />
          <div className="min-w-0">
            <h2 className="text-15 font-semibold tracking-tight">{r.title}</h2>
            <p className="truncate text-xs text-muted-foreground">{f.kind === "person" ? [f.jobTitle, f.companyName].filter(Boolean).join(" at ") : f.domain}</p>
          </div>
        </div>
        <Props items={d.properties} />
        <button type="button" onClick={() => nav(`/?q=${encodeURIComponent(`with:"${r.title}"`)}`)} className="inline-flex h-8 w-fit items-center gap-2 rounded-md border border-border bg-card px-3 text-13 font-medium transition-colors hover:border-border-strong hover:bg-card-hover">
          <SearchIcon className="size-3.5" />Search everything about {r.title.split(" ")[0]}<Kbd>P</Kbd>
        </button>
        {ent && <Link to={`/${f.kind === "person" ? "people" : "companies"}/${ent}`} className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground">Open the timeline<ChevronRight className="size-3" /></Link>}
        {ent && f.kind === "person" && <PersonMatches id={ent} />}
      </>);
    }
    case "deal":
      return wrap(<>
        {head(<>{f.companyName} · updated {fmtRelative(r.updatedAt ?? r.occurredAt)}</>)}
        <div className="flex items-baseline gap-3"><span className="tnum text-xl font-semibold tracking-tight">{fmtMoney(f.amount, f.currency)}</span>{f.stage && <Badge>{stageLabel(f.stage)}</Badge>}</div>
        <Props items={d.properties.filter((p) => p.label !== "Amount" && p.label !== "Stage" && !(p.label === "Owner" && !ownerName(String(p.value ?? ""))))} />
        <People d={d} />
        <Sections d={{ ...d, body: dealNotes(d.body) }} words={words} quote={quote} />
      </>);
    case "task":
      return wrap(<>
        {head(<span className="inline-flex items-center gap-1.5"><span className="font-mono">{f.key}</span> · <StateIcon type={f.stateType} />{f.state}</span>)}
        <Props items={d.properties} />
        <Sections d={d} words={words} quote={quote} />
        {d.parts.some((p) => p.kind === "message") && <><p className="label-caps">Comments</p><Messages d={{ ...d, parts: d.parts.filter((p) => p.kind === "message") }} words={words} quote={quote} /></>}
      </>);
    case "message":
      return wrap(<>
        {head(<>{f.channel ? (f.channel.startsWith("#") || r.platform !== "slack" ? f.channel : `#${f.channel}`) : r.title} · {fmtDateTime(r.occurredAt)}{f.replyCount ? ` · ${f.replyCount} replies` : ""}</>)}
        {d.parts.some((p) => p.kind === "message") ? <Messages d={d} words={words} quote={quote} /> : (
          <div className="flex gap-2.5">
            <Avatar name={r.people.find((p) => p.role === "author" || p.role === "from")?.name ?? "?"} size="md" />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-13 font-medium">{r.people.find((p) => p.role === "author" || p.role === "from")?.name ?? f.sender}</span>
              <p className="whitespace-pre-wrap text-13 leading-relaxed"><Marked text={d.body} words={words} quote={quote} /></p>
            </div>
          </div>
        )}
      </>);
    case "meeting_note":
      return wrap(<>
        {head(<span className="tnum">{fmtDateTime(r.occurredAt)}{f.durationMin ? ` · ${f.durationMin} min` : ""} · {f.attendees?.length ?? 0} people</span>)}
        {f.takeaways?.length ? (
          <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-faint p-3">
            <p className="label-caps">Takeaways</p>
            <ul className="flex flex-col gap-1">{f.takeaways.map((t) => <li key={t} className="flex gap-2 text-13"><span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground" /><span><Marked text={t} words={words} quote={quote} /></span></li>)}</ul>
          </div>
        ) : null}
        <Sections d={{ ...d, parts: d.parts.filter((p) => p.title !== "Takeaways") }} words={words} quote={quote} />
        <People d={d} />
        <TranscriptNote has={!!f.hasTranscript} />
      </>);
    default:
      return wrap(<>
        {head(<>{fmtDateTime(r.occurredAt)}</>)}
        <Props items={d.properties} />
        <Sections d={d} words={words} quote={quote} />
      </>);
  }
}

function TranscriptNote({ has }: { has: boolean }) {
  const [open, setOpen] = useState(false);
  if (has) return null;
  return (
    <button type="button" onClick={() => setOpen(!open)} className="inline-flex w-fit items-center gap-1 text-11 text-muted-foreground hover:text-foreground">
      <ChevronDown className={cn("size-3 transition-transform", !open && "-rotate-90")} />No transcript indexed
      {open && <span className="ml-1">Granola sent none for this meeting, or the source is set to summaries only.</span>}
    </button>
  );
}

function PersonMatches({ id }: { id: string }) {
  const q = useEntity(id);
  return q.data ? <Matches detail={q.data} compact /> : null;
}

/** A CRM deal's body repeats its fields ("Stage contractsent. 84000 USD. Closes 2026-11-14"); keep the notes. */
function dealNotes(body: string): string {
  return body.split(/(?<=\.)\s+/).filter((x) => !/^(Stage|Closes|Pipeline|Owner)\b|^\d[\d.,]*\s+[A-Z]{3}\.?$/.test(x.trim())).join(" ").replace(/\.\.+/g, ".").trim();
}
