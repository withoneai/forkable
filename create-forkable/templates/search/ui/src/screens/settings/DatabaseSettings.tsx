import { useMe } from "@/lib/queries";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { LoadError } from "@/components/ui/EmptyState";
import { CapabilityNote } from "./SearchSettings";
import { SectionTitle, SettingRow, SettingsCard } from "./SettingsLayout";

export function DatabaseSettings() {
  const me = useMe();
  if (me.isError) return <LoadError what="Database" error={me.error} onRetry={() => void me.refetch()} retrying={me.isFetching} className="rounded-lg border border-border bg-card" />;
  const cap = me.data?.capability;
  if (!cap) return <Skeleton className="h-48 w-full rounded-lg" />;
  const embedded = cap.where === "embedded";
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <SectionTitle title="Database" hint="Your index lives in Postgres you own. Nothing leaves it except the calls you see in Access." />
        <CapabilityNote cap={cap} />
        <SettingsCard>
          <SettingRow label="Where" hint={embedded ? "Embedded Postgres 18.4, started with Search, data in ~/.search/db." : "An external Postgres from SEARCH_DATABASE_URL."}>
            <Badge tone="outline">{embedded ? "Embedded" : "External"}</Badge>
          </SettingRow>
          <SettingRow label="Connection" hint="The password never shows here.">
            <span className="font-mono text-xs text-muted-foreground">{embedded ? "postgres://search:••••@127.0.0.1:55441/search" : "postgres://••••@••••/search"}</span>
          </SettingRow>
          <SettingRow label="Search mode">
            <span className="text-xs">{cap.mode === "hybrid" ? `Hybrid, pgvector ${cap.pgvector ?? ""}` : "Keyword only"}</span>
          </SettingRow>
          {cap.vectorSchema && (
            <SettingRow label="Vector schema"><span className="font-mono text-xs text-muted-foreground">{cap.vectorSchema}</span></SettingRow>
          )}
        </SettingsCard>
      </section>
      <section className="flex flex-col gap-3">
        <SectionTitle title="Use your own Postgres" hint="Set SEARCH_DATABASE_URL in .env and restart. Supabase works; use the session pooler on 5432, not the transaction pooler on 6543." />
        <pre className="overflow-x-auto rounded-md border border-border bg-faint p-3 font-mono text-xs">SEARCH_DATABASE_URL=postgres://user:password@host:5432/search</pre>
      </section>
    </div>
  );
}
