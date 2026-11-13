import { useMe } from "@/lib/queries";
import { Skeleton } from "@/components/ui/Skeleton";
import { LoadError } from "@/components/ui/EmptyState";
import { MeaningNote } from "./SearchSettings";
import { COPY, meaningState } from "@/lib/copy";
import { SectionTitle, SettingRow, SettingsCard } from "./SettingsLayout";

/** Where her data lives, in plain words first; the real folder, address and versions (as the server reports them) under Advanced. */
export function DatabaseSettings() {
  const me = useMe();
  if (me.isError) return <LoadError what="Database" error={me.error} onRetry={() => void me.refetch()} retrying={me.isFetching} className="rounded-lg border border-border bg-card" />;
  const cap = me.data?.capability;
  if (!cap || !me.data) return <Skeleton className="h-48 w-full rounded-lg" />;
  const db = me.data.database ?? null;
  const embedded = (db?.kind ?? cap.where) === "embedded";
  const meaning = meaningState(me.data);
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <SectionTitle title="Where your data lives" hint={embedded
          ? "Everything Search reads is kept on this computer. Nothing leaves it except the calls you see in Access."
          : "Everything Search reads is kept in the database you set up. Nothing leaves it except the calls you see in Access."} />
        <MeaningNote me={me.data} />
        <SettingsCard>
          <SettingRow label="Where" hint={embedded ? "Search keeps its own database and starts it with the app." : "A database someone set up for Search."}>
            <span className="text-xs font-medium" data-testid="data-where">{embedded ? COPY.onThisComputer : "Your own database"}</span>
          </SettingRow>
          <SettingRow label={COPY.meaning}>
            <span className="text-xs">{meaning.on ? COPY.wordsAndMeaning : COPY.wordsOnly}</span>
          </SettingRow>
        </SettingsCard>
      </section>

      <details className="group flex flex-col gap-3" data-copy="advanced" data-testid="database-advanced">
        <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">Advanced</summary>
        <div className="mt-3 flex flex-col gap-6">
          <SettingsCard>
            <SettingRow label="Database" hint={db?.version ? `Postgres ${db.version}` : undefined}>
              <span className="text-xs text-muted-foreground">{embedded ? "Embedded, started with Search" : "External"}</span>
            </SettingRow>
            {db?.dataDir && (
              <SettingRow label="Data folder"><span className="font-mono text-xs text-muted-foreground" data-testid="data-dir">{db.dataDir}</span></SettingRow>
            )}
            <SettingRow label="Connection" hint="The password never shows here.">
              <span className="break-all font-mono text-xs text-muted-foreground" data-testid="data-url">{db?.url ?? "Sign in to see it"}</span>
            </SettingRow>
            <SettingRow label="Search by meaning in the database" hint={cap.mode === "hybrid" ? `pgvector ${cap.pgvector ?? ""}` : undefined}>
              <span className="text-xs">{cap.mode === "hybrid" ? "Available" : "Not available"}</span>
            </SettingRow>
            {cap.vectorSchema && (
              <SettingRow label="Meaning data kept in"><span className="font-mono text-xs text-muted-foreground">{cap.vectorSchema}</span></SettingRow>
            )}
          </SettingsCard>
          <section className="flex flex-col gap-3">
            <SectionTitle title="Use your own Postgres" hint="Set SEARCH_DATABASE_URL in .env and restart. Supabase works; use the session pooler on 5432, not the transaction pooler on 6543." />
            <pre className="overflow-x-auto rounded-md border border-border bg-faint p-3 font-mono text-xs">SEARCH_DATABASE_URL=postgres://user:password@host:5432/search</pre>
          </section>
        </div>
      </details>
    </div>
  );
}
