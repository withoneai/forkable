import type { Checkpoint } from "@builder/core/types";
import { humanError } from "@/lib/api";
import { useRestore } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { Button, Dialog } from "@/components/ui";

export const RESTORE_COPY =
  "Restore makes a new version with these files. Data in your app's database and anything already sent through One stay as they are.";

export function RestoreDialog({ projectId, checkpoint, onClose, busy, onRestored }: { projectId: string; checkpoint: Checkpoint | null; onClose: () => void; busy?: boolean; onRestored?: () => void }) {
  const restore = useRestore(projectId);
  return (
    <Dialog open={!!checkpoint} onClose={onClose} title="Restore this version" size="sm">
      {checkpoint && (
        <div className="flex flex-col gap-3 p-4 text-13">
          <div className="flex flex-col gap-0.5 rounded-md border border-border bg-faint px-3 py-2">
            <span className="truncate font-medium">{checkpoint.subject}</span>
            <span className="font-mono text-11 text-muted-foreground">{checkpoint.shortSha}</span>
          </div>
          <p className="text-muted-foreground">{RESTORE_COPY}</p>
          {busy && <p className="text-xs text-warning-text">The agent is working. Restore waits until you stop it.</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              disabled={busy}
              loading={restore.isPending}
              onClick={() =>
                restore.mutate(checkpoint.sha, {
                  onSuccess: (r) => {
                    onClose();
                    onRestored?.();
                    toast({ title: "Restored", detail: r.checkpoint ? `New version ${r.checkpoint.shortSha}` : "Nothing changed" });
                  },
                  onError: (e) => toast({ title: "Could not restore", detail: humanError(e), tone: "destructive" }),
                })
              }
            >
              Restore
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
