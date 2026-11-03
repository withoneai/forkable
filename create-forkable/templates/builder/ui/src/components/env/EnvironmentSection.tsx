// A project's Environment (Access): every name the code reads, with
// file:line, set or missing, where each value is stored, and the secure
// input to set, replace or remove it. The agent sees these names and
// whether each is set, never a value.

import { KeyRound } from "lucide-react";
import { useProjectEnv } from "@/lib/queries";
import { EmptyState, ListSkeleton, LoadError } from "@/components/ui";
import { AddEnvRow, EnvRow } from "./EnvRow";

export function EnvironmentSection({ projectId, onOpenFile }: { projectId: string; onOpenFile?: (path: string, line: number) => void }) {
  const env = useProjectEnv(projectId);
  if (env.isLoading) return <ListSkeleton rows={2} />;
  if (!env.data) return <LoadError what="This app's environment" error={env.error} onRetry={() => env.refetch()} />;
  const d = env.data;
  return (
    <div className="flex flex-col gap-2" data-testid="environment-section">
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {d.vars.length === 0 ? (
          <EmptyState className="py-8" icon={<KeyRound />} title="This app reads no environment variables" detail="When its code reads process.env or c.env, each name shows here with where it is used. The agent asks by name; you set the value here." />
        ) : (
          d.vars.map((v) => <EnvRow key={v.name} projectId={projectId} v={v} onOpenFile={onOpenFile} />)
        )}
        <div className="border-t border-border"><AddEnvRow projectId={projectId} /></div>
      </div>
      <p className="text-11 text-muted-foreground">
        Saved to {d.store.label}, outside the project. The preview gets them when it starts, and Vercel gets them as sensitive variables when you publish. The agent only ever sees the names.
      </p>
    </div>
  );
}
