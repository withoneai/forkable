import { useQuery } from "@tanstack/react-query";
import { Copy, Crown, X } from "lucide-react";
import type { MeResponse, SettingsData } from "@/contract/api-types";
import { api } from "@/lib/api";
import { useMe, useSettings, useSettingsMutation } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { IconButton } from "@/components/ui/IconButton";
import { Skeleton } from "@/components/ui/Skeleton";
import { LoadError } from "@/components/ui/EmptyState";
import { Switch } from "@/components/ui/Switch";
import { SectionTitle, Segmented, Select, SettingRow, SettingsCard } from "./SettingsLayout";
import { COPY, meaningState, PRIORITY } from "@/lib/copy";

/** The AI that reads for meaning. The label is the company; the exact model shows under the row. */
const MODELS: { value: string; label: string; provider: SettingsData["embedding"]["provider"] }[] = [
  { value: "local:hash-v1", label: "Sample, words only", provider: "local" },
  { value: "text-embedding-3-small", label: "OpenAI", provider: "openai" },
  { value: "gemini-embedding-001", label: "Gemini", provider: "gemini" },
  { value: "embed-v4.0", label: "Cohere", provider: "cohere" },
  { value: "mistral-embed", label: "Mistral", provider: "mistral-ai" },
];


/** Search by meaning, on or off, with the reason in plain words. The state comes from meaningState, shared with every screen. */
export function MeaningNote({ me, offerPick }: { me: Pick<MeResponse, "capability" | "settings">; offerPick?: boolean }) {
  const m = meaningState(me);
  const cap = me.capability;
  if (m.sample) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="meaning-note" data-on="false">
        <span className="font-medium text-foreground">{COPY.meaningSample}</span>{offerPick && " Pick an AI below to turn it on with your own account."}
      </p>
    );
  }
  if (m.on) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="meaning-note" data-on="true">
        <span className="font-medium text-success-text">{COPY.meaningOn}</span> Search finds what you mean as well as the words you type.
      </p>
    );
  }
  // copy-ok: the SQL a database owner runs, word for word
  const sql = "create extension if not exists vector;";
  return (
    <div className="flex flex-col gap-2 rounded-md border border-warning-text/30 bg-warning-text/[0.06] p-3 text-xs" role="status" data-testid="meaning-note" data-on="false">
      <p><span className="font-medium text-warning-text">{COPY.meaningOff}</span> {m.why}. Results still come back, matched by your words.</p>
      {cap.where === "external" && <p className="text-muted-foreground">To turn it on, run this once on your database:</p>}
      {cap.where === "external" && (
        <div className="flex h-8 items-center gap-2 rounded-md border border-border bg-card pl-2.5 pr-1" data-copy="advanced">
          <span className="min-w-0 flex-1 truncate font-mono text-xs">{sql}</span>
          <IconButton size="sm" label="Copy the SQL" onClick={() => void navigator.clipboard.writeText(sql).then(() => toast({ title: "Copied" }))}><Copy /></IconButton>
        </div>
      )}
    </div>
  );
}

export function SearchSettings() {
  const me = useMe();
  const q = useSettings();
  const save = useSettingsMutation();
  const s = q.data;
  const vips = useQuery({ queryKey: ["entities", "people"], queryFn: () => api.entities("", "person") });

  const put = (patch: Partial<SettingsData>, done?: string) =>
    save.mutate(patch, {
      onSuccess: (r) => {
        if (r.effect) toast({ title: "Getting search by meaning ready", detail: `Search reads ${r.effect.reembed.chunks.toLocaleString()} pieces again, about ${r.effect.reembed.estimateCalls} calls through One.` });
        else if (done) toast({ title: done });
      },
      onError: (e) => toast({ title: "Did not save", detail: e.message, tone: "destructive" }),
    });

  if (q.isError) return <LoadError what="Search settings" error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} className="rounded-lg border border-border bg-card" />;
  if (!s) return <Skeleton className="h-80 w-full rounded-lg" />;

  const vipRows = (vips.data ?? []).filter((e) => s.vipEntityIds.includes(e.id));
  const others = (vips.data ?? []).filter((e) => !s.vipEntityIds.includes(e.id));
  // the sample's reader is stored as "hash-v1" with provider local: it is the "Sample, words only" choice
  const model = (s.embedding.provider === "local" ? MODELS[0] : MODELS.find((m) => m.value === s.embedding.model)) ?? { value: s.embedding.model, label: s.embedding.model, provider: s.embedding.provider };

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <SectionTitle title={COPY.meaning} hint="Finds what you mean, not only the words you type. One AI reads everything for meaning, through One." />
        {me.data && <MeaningNote me={{ capability: me.data.capability, settings: s }} offerPick />}
        <SettingsCard>
          <SettingRow label="AI that reads for meaning" hint={model.provider === "local" ? "The sample matches words only. Fine for the demo, not for your own search." : "Changing it reads everything again."}>
            <Select label="AI that reads for meaning" value={model.value} options={(MODELS.some((m) => m.value === model.value) ? MODELS : [model, ...MODELS]).map((m) => ({ value: m.value, label: m.label }))}
              onChange={(v) => { const m = MODELS.find((x) => x.value === v)!; put({ embedding: { provider: m.provider, model: m.value, dims: 1536 } }); }} />
          </SettingRow>
          <SettingRow label="Put the best results first" hint="Puts the best of the top 30 first when you type three words or more. The first order shows at once, then the better one. Done by Jev, the AI model Search uses to judge results.">
            <Switch label="Put the best results first" checked={s.rerank} onChange={(v) => put({ rerank: v })} />
          </SettingRow>
        </SettingsCard>
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle title={PRIORITY} hint="Sorts recent items into VIPs, Needs you, Waiting, FYI and Low. Pick Priority under Filter, or press L then a letter. Done by Jev, an AI model." />
        <SettingsCard>
          <SettingRow label="Sort by priority" hint="Only items from the last 90 days are sorted.">
            <Switch label="Sort by priority" checked={s.lanesOn} onChange={(v) => put({ lanesOn: v })} />
          </SettingRow>
        </SettingsCard>
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle title="VIPs" hint="Anything about a VIP goes to the top, under VIPs. Newsletters and receipts stay out." />
        <div className="overflow-hidden rounded-lg border border-border bg-card" data-testid="vip-list">
          {vips.isPending ? <Skeleton className="m-3 h-8" /> : vipRows.length === 0 ? <p className="px-4 py-3 text-13 text-muted-foreground">No VIPs yet.</p> : vipRows.map((e) => (
            <div key={e.id} className="flex h-11 items-center gap-3 border-b border-border px-3 last:border-b-0">
              <Avatar name={e.name} size="md" />
              <span className="text-13 font-medium">{e.name}</span>
              <span className="truncate text-xs text-muted-foreground">{e.subtitle}</span>
              <Crown className="ml-auto size-3.5 text-accent" aria-label="VIP" />
              <IconButton size="sm" label={`Remove ${e.name}`} onClick={() => put({ vipEntityIds: s.vipEntityIds.filter((x) => x !== e.id) })}><X /></IconButton>
            </div>
          ))}
          {others.length > 0 && (
            <div className="flex items-center gap-2 border-t border-border bg-faint px-3 py-2">
              <span className="text-11 text-muted-foreground">Add</span>
              <Select label="Add a VIP" value="" className="max-w-[260px]" options={[{ value: "", label: "Pick a person" }, ...others.map((e) => ({ value: e.id, label: e.subtitle ? `${e.name}, ${e.subtitle}` : e.name }))]}
                onChange={(v) => { if (v) put({ vipEntityIds: [...s.vipEntityIds, v] }); }} />
            </div>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle title="Slack" hint="Slack lets most apps read one page of history a minute, so a large Slack fills in over a few hours, newest channels first." />
        <details className="group rounded-lg border border-border bg-card px-4 py-2.5" data-copy="advanced" data-testid="slack-advanced">
          <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">Advanced</summary>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-border pt-2.5">
            <div className="min-w-0">
              <p className="text-13 font-medium">Slack app tier</p>
              <p className="text-xs text-muted-foreground">{s.slackTier === "limited" ? "Limited: one history call a minute (apps outside the Slack Marketplace, since 2025)." : "Marketplace: the normal rate limits apply."}</p>
            </div>
            <Segmented label="Slack app tier" value={s.slackTier} onChange={(v) => put({ slackTier: v })} options={[{ key: "limited", label: "Limited" }, { key: "marketplace", label: "Marketplace" }]} />
          </div>
        </details>
        {s.embedding.provider === "local" && <p className="text-11 text-muted-foreground"><Badge tone="outline">Sample</Badge> The sample is made up, so these settings change what you see but call nothing.</p>}
      </section>
    </div>
  );
}
