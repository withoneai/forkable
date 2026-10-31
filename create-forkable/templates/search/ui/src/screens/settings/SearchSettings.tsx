import { useQuery } from "@tanstack/react-query";
import { Copy, Crown, X } from "lucide-react";
import type { Capability, SettingsData } from "@/contract/api-types";
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

const MODELS: { value: string; label: string; provider: SettingsData["embedding"]["provider"] }[] = [
  { value: "local:hash-v1", label: "Sample embedder (local, not semantic)", provider: "local" },
  { value: "text-embedding-3-small", label: "OpenAI text-embedding-3-small", provider: "openai" },
  { value: "gemini-embedding-001", label: "Gemini embedding 001", provider: "gemini" },
  { value: "embed-v4.0", label: "Cohere embed v4", provider: "cohere" },
  { value: "mistral-embed", label: "Mistral embed", provider: "mistral-ai" },
];

const REASON: Record<NonNullable<Capability["reason"]>, string> = {
  no_build_for_platform: "There is no pgvector build for this computer yet",
  extension_unavailable: "The database does not have the vector extension",
  cannot_create_extension: "The database user cannot create the vector extension",
  flags_missing: "Postgres started without the extension paths",
  forced: "SEARCH_FORCE_KEYWORD is set",
  embedding_not_granted: "No embedding model is in your grant",
};

export function CapabilityNote({ cap, sampleEmbedder }: { cap: Capability; sampleEmbedder?: boolean }) {
  if (cap.mode === "hybrid" && sampleEmbedder) {
    return (
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Hybrid search runs on the sample embedder.</span> pgvector {cap.pgvector ?? ""} is on, but the Sample embedder (local, not semantic) only stands in for a real model.
      </p>
    );
  }
  if (cap.mode === "hybrid") {
    return (
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-success-text">Hybrid search is on.</span> Keyword and semantic results are fused, pgvector {cap.pgvector ?? ""} on the {cap.where} database.
      </p>
    );
  }
  const sql = "create extension if not exists vector;";
  return (
    <div className="flex flex-col gap-2 rounded-md border border-warning-text/30 bg-warning-text/[0.06] p-3 text-xs" role="status">
      <p><span className="font-medium text-warning-text">Semantic search is off.</span> {cap.reason ? REASON[cap.reason] : "Search runs on keywords only"}. Results still come back, matched by words.</p>
      {cap.where === "external" && (
        <div className="flex h-8 items-center gap-2 rounded-md border border-border bg-card pl-2.5 pr-1">
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
        if (r.effect) toast({ title: "Re-embedding your index", detail: `${r.effect.reembed.chunks.toLocaleString()} chunks, about ${r.effect.reembed.estimateCalls} calls on your grant` });
        else if (done) toast({ title: done });
      },
      onError: (e) => toast({ title: "Did not save", detail: e.message, tone: "destructive" }),
    });

  if (q.isError) return <LoadError what="Search settings" error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} className="rounded-lg border border-border bg-card" />;
  if (!s) return <Skeleton className="h-80 w-full rounded-lg" />;

  const vipRows = (vips.data ?? []).filter((e) => s.vipEntityIds.includes(e.id));
  const others = (vips.data ?? []).filter((e) => !s.vipEntityIds.includes(e.id));
  const model = MODELS.find((m) => m.value === s.embedding.model) ?? { value: s.embedding.model, label: s.embedding.model, provider: s.embedding.provider };

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <SectionTitle title="Semantic search" hint="One embedding model for the whole index. It runs through One on your grant." />
        {me.data && <CapabilityNote cap={me.data.capability} sampleEmbedder={s.embedding.provider === "local"} />}
        <SettingsCard>
          <SettingRow label="Embedding model" hint={model.provider === "local" ? "Sample embedder (local, not semantic). Fine for the demo, not for real search." : "Changing it re-embeds every chunk."}>
            <Select label="Embedding model" value={model.value} options={(MODELS.some((m) => m.value === model.value) ? MODELS : [model, ...MODELS]).map((m) => ({ value: m.value, label: m.label }))}
              onChange={(v) => { const m = MODELS.find((x) => x.value === v)!; put({ embedding: { provider: m.provider, model: m.value, dims: 1536 } }); }} />
          </SettingRow>
          <SettingRow label="Rerank with Jev" hint="Reorders the top 30 for queries of three words or more. The first order shows at once.">
            <Switch label="Rerank with Jev" checked={s.rerank} onChange={(v) => put({ rerank: v })} />
          </SettingRow>
        </SettingsCard>
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle title="Lanes" hint="Jev sorts recent items into VIPs, Needs you, Waiting, FYI and Low. Filter with lane: or L then a letter." />
        <SettingsCard>
          <SettingRow label="Sort into lanes" hint="Only items from the last 90 days are judged.">
            <Switch label="Sort into lanes" checked={s.lanesOn} onChange={(v) => put({ lanesOn: v })} />
          </SettingRow>
        </SettingsCard>
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle title="VIPs" hint="Anything that links to a VIP lands in the VIPs lane, newsletters and receipts aside." />
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
        <SectionTitle title="Slack" hint="Since 2025, Slack lets apps outside its Marketplace read history once a minute." />
        <SettingsCard>
          <SettingRow label="Slack app tier" hint={s.slackTier === "limited" ? "Limited: one history call a minute, newest channels first." : "Marketplace: the normal rate limits apply."}>
            <Segmented label="Slack app tier" value={s.slackTier} onChange={(v) => put({ slackTier: v })} options={[{ key: "limited", label: "Limited" }, { key: "marketplace", label: "Marketplace" }]} />
          </SettingRow>
        </SettingsCard>
        {s.embedding.provider === "local" && <p className="text-11 text-muted-foreground"><Badge tone="outline">Sample</Badge> The sample answers from fixtures, so these settings change what you see but call nothing.</p>}
      </section>
    </div>
  );
}
