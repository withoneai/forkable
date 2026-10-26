import { Database } from "lucide-react";
import { useMailboxId } from "@/lib/mailbox";
import { useSettings } from "@/lib/queries";
import { fmtBytes } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";
import { LoadError } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { SectionTitle, SettingRow } from "./SettingsLayout";

export function DatabaseSettings() {
  const mailboxId = useMailboxId();
  const q = useSettings(mailboxId);
  const db = q.data?.database;
  return (
    <div className="flex flex-col gap-4">
      <SectionTitle title="Database" hint="Postgres everywhere. Locally an embedded build in your home folder; hosted, the same schema on a managed Postgres." />
      {!db && q.isError ? <LoadError what="Database details" error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} className="rounded-lg border border-border bg-card" /> : !db ? <Skeleton className="h-[200px] w-full rounded-lg" /> : (
        <div className="rounded-lg border border-border bg-card px-4">
          <SettingRow label="In use">
            <span className="flex items-center gap-2 text-13"><Database className="size-3.5 text-muted-foreground" />{db.kind === "embedded" ? "Embedded Postgres" : "External Postgres"} <Badge tone="outline">{db.kind}</Badge></span>
          </SettingRow>
          <SettingRow label="Connection"><span className="font-mono text-xs text-muted-foreground">{db.url}</span></SettingRow>
          <SettingRow label="Size"><span className="tnum text-13">{fmtBytes(db.sizeBytes)}</span></SettingRow>
          {db.dataDir && <SettingRow label="Data directory"><span className="font-mono text-xs text-muted-foreground">{db.dataDir}</span></SettingRow>}
        </div>
      )}
    </div>
  );
}
