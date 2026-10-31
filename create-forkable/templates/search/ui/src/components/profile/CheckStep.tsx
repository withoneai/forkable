// Step 2 of New profile, Check: what the AI's map will put in search, judged by
// eye. Three real records as result rows first, then anything to fix in plain
// words (each with where it gets fixed and an "Ask AI to fix"), then the few
// choices a person makes (name, refresh, start from). The field map and the
// record id, link and title fallback sit behind "Edit fields" and "Advanced".
import { forwardRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, ExternalLink, Sparkles, X } from "lucide-react";
import type { DraftPreview } from "@/contract/api-types";
import { cn, fmtRelative, KIND_LABEL } from "@/lib/utils";
import { SourceLogo } from "@/components/SourceLogo";
import { AccountMark } from "@/components/AccountChip";
import { markFor } from "@/lib/accounts";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { fieldName, type MapRow, type PlainIssue } from "./fieldmap";
import { BACKFILLS, refreshSentence, Row, SCHEDULES, Segmented, type Identity } from "./IdentityStep";

export type Section = "fields" | "advanced";

export function CheckStep({ platform, noun, preview, previewLoading, issues, checking, rows, identity, onIdent, name, onName, calls, open, onOpen, onAskFix, fields, advanced, accounts = [], chosenAccounts = [], onAccounts }: {
  platform: string; noun: string;
  /** Every account of the platform in the grant; the row shows only with two or more. */
  accounts?: { key: string; label: string }[]; chosenAccounts?: string[]; onAccounts?: (keys: string[]) => void;
  preview: DraftPreview | undefined; previewLoading: boolean;
  issues: PlainIssue[]; checking: boolean;
  rows: MapRow[]; identity: Identity; onIdent: (p: Partial<Identity>) => void;
  name: string; onName: (v: string) => void; calls: number;
  open: Record<Section, boolean>; onOpen: (s: Section, v: boolean) => void;
  onAskFix: (text: string) => void;
  fields: React.ReactNode; advanced: React.ReactNode;
}) {
  const searchable = rows.filter((r) => r.path && (r.target === "title" || r.target === "body"));
  const shortBody = rows.some((r) => r.target === "body" && r.path) && (preview?.samples ?? []).every((s) => (s.item.body ?? "").length < 20);
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2" aria-label="How it looks in search">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-13 font-medium">How {noun}s will look in search</h2>
          <span className="text-11 text-muted-foreground">{preview?.samples.length ? `${Math.min(3, preview.samples.length)} sample ${noun}s` : ""}</span>
        </div>
        <ResultsPreview preview={preview} loading={previewLoading} platform={platform} />
      </section>

      {issues.length > 0 && (
        <section className="flex flex-col gap-2" aria-label="To fix" data-testid="check-issues">
          {issues.map((i, k) => (
            <div key={k} className={cn("flex items-start gap-2.5 rounded-lg border px-3 py-2.5", i.level === "error" ? "border-destructive-text/40 bg-destructive-text/5" : "border-border bg-card")}>
              {i.level === "error" ? <X className="mt-0.5 size-3.5 shrink-0 text-destructive-text" /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning-text" />}
              <p className="min-w-0 flex-1 text-13">{i.text}</p>
              <div className="flex shrink-0 items-center gap-1.5">
                {i.fixAt === "fields" || i.fixAt === "advanced" ? (
                  <Button size="sm" onClick={() => onOpen(i.fixAt as Section, true)} data-testid="issue-fix">{i.fixAt === "fields" ? "Fix in fields" : "Fix in Advanced"}</Button>
                ) : null}
                <Button size="sm" variant="ghost" icon={<Sparkles />} onClick={() => onAskFix(i.text)}>Ask AI to fix</Button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="flex flex-col gap-5" aria-label="Settings">
        <Row label="Name" hint="Shown in Settings.">
          <Input value={name} onChange={(e) => onName(e.target.value)} aria-label="Profile name" data-testid="profile-name" className="max-w-[360px]" />
        </Row>
        {accounts.length > 1 && onAccounts && (
          <Row label="Accounts" hint={`Each one becomes its own source. Results say which ${platform} they came from.`}>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Accounts" data-testid="accounts">
              {accounts.map((a) => {
                const on = chosenAccounts.includes(a.key);
                const last = on && chosenAccounts.length === 1;
                return (
                  <button key={a.key} type="button" role="checkbox" aria-checked={on} disabled={last} title={last ? "Keep at least one account" : undefined}
                    onClick={() => onAccounts(on ? chosenAccounts.filter((k) => k !== a.key) : [...chosenAccounts, a.key])}
                    data-testid={`account-${a.label}`}
                    className={cn("flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs transition-colors duration-100", on ? "border-border-strong bg-card text-foreground" : "border-border bg-faint text-muted-foreground hover:text-foreground", last && "cursor-default")}>
                    <span className={cn("flex size-3.5 items-center justify-center rounded-sm border", on ? "border-foreground bg-foreground text-background" : "border-border-strong")}>{on && <Check className="size-2.5 stroke-[3]" />}</span>
                    <AccountMark text={markFor(a.label, accounts.map((x) => x.label))} />
                    {a.label}
                  </button>
                );
              })}
            </div>
          </Row>
        )}
        <Row label="Refresh" hint={refreshSentence(identity, platform, noun)}>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented label="Refresh" value={identity.every as (typeof SCHEDULES)[number]["key"]} options={SCHEDULES} onChange={(k) => onIdent({ every: k })} />
            {identity.every === "custom" && <Input mono className="w-[160px]" value={identity.cron} onChange={(e) => onIdent({ cron: e.target.value })} placeholder="*/30 8-18 * * 1-5" aria-label="Cron" />}
          </div>
        </Row>
        <Row label="Start from" hint="How far back the first sync reads.">
          <Segmented label="Start from" value={identity.backfill} options={BACKFILLS} onChange={(k) => onIdent({ backfill: k })} />
        </Row>
        <Row label="Searchable text" hint="Other fields stay out of search.">
          <p className="text-13">
            {searchable.length ? searchable.map((r) => fieldName(r.path)).join(", ") : <span className="text-muted-foreground">Only titles.</span>}
            {shortBody && <span className="ml-2 text-11 text-warning-text">Short. Pick a longer text field in Edit fields.</span>}
          </p>
        </Row>
      </section>

      <Disclosure title="Edit fields" hint="Which field becomes the title, date and text. The AI already picked them." open={open.fields} onToggle={(v) => onOpen("fields", v)} testId="edit-fields">{fields}</Disclosure>
      <Disclosure title="Advanced" hint={`Record id, the link to open in ${platform}, the title when empty.`} open={open.advanced} onToggle={(v) => onOpen("advanced", v)} testId="advanced">{advanced}</Disclosure>

      <p className="text-11 text-muted-foreground" data-testid="cost-line">
        Uses about {calls} {platform} {calls === 1 ? "request" : "requests"} per refresh. You can see each one in Access.{checking ? " Checking..." : ""}
      </p>
    </div>
  );
}

const Disclosure = forwardRef<HTMLDivElement, { title: string; hint: string; open: boolean; onToggle: (v: boolean) => void; testId: string; children: React.ReactNode }>(function Disclosure({ title, hint, open, onToggle, testId, children }, ref) {
  return (
    <section ref={ref} className="rounded-xl border border-border" data-testid={testId}>
      <button type="button" aria-expanded={open} onClick={() => onToggle(!open)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
        <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform duration-100", !open && "-rotate-90")} />
        <span className="text-13 font-medium">{title}</span>
        <span className="min-w-0 flex-1 truncate text-11 text-muted-foreground">{hint}</span>
      </button>
      {open && <div className="border-t border-border p-3">{children}</div>}
    </section>
  );
});

/** Up to three sample records exactly as result rows, with Open in the platform when the link is a real page. */
function ResultsPreview({ preview, loading, platform }: { preview: DraftPreview | undefined; loading: boolean; platform: string }) {
  const rows = (preview?.samples ?? []).slice(0, 3);
  if (!preview) return <Skeleton className="h-[132px] w-full rounded-xl" />;
  if (!rows.length) return <p className="rounded-xl border border-border bg-card px-3 py-3 text-13 text-muted-foreground">No sample records to show yet. The first sync fills this in.</p>;
  return (
    <ul className={cn("divide-y divide-border overflow-hidden rounded-xl border border-border bg-card transition-opacity", loading && "opacity-60")} data-testid="results-preview">
      {rows.map((s, k) => (
        <li key={k} className="flex flex-col gap-1 px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <SourceLogo platform={s.row.platform} size={16} />
            <span className="w-14 shrink-0 truncate text-11 text-muted-foreground">{s.row.facets.kind === "task" && s.row.facets.key ? s.row.facets.key : KIND_LABEL[s.row.kind]}</span>
            <span className={cn("min-w-0 flex-1 truncate text-13 font-medium", s.row.title === "(untitled)" && "text-muted-foreground")}>{s.row.title}</span>
            <span className="tnum shrink-0 text-11 text-muted-foreground">{s.row.occurredAt ? fmtRelative(s.row.occurredAt) : "no date"}</span>
            {s.item.url && /^https:\/\//.test(s.item.url) && (
              <a href={s.item.url} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-1 text-11 text-muted-foreground hover:text-foreground">Open in {platform} <ExternalLink className="size-3" /></a>
            )}
          </div>
          {s.row.snippet && <p className="truncate pl-24 text-xs text-muted-foreground">{s.row.snippet}</p>}
        </li>
      ))}
    </ul>
  );
}
