import { useState } from "react";
import { Archive, MailOpen, Star } from "lucide-react";
import { oneFetch, type OneClientError } from "../lib/one-client";
import { Button } from "../lib/one-ui";

type Op = "archive" | "unarchive" | "read" | "unread" | "star" | "unstar";

export interface GmailThreadActionsProps {
  threadId: string;
  starred?: boolean;
  /** Called after Gmail took the change, so the list can refetch. */
  onDone?: (op: Op) => void;
}

/** Archive, mark unread and star, with an Undo for archive. Writes on the user's grant. */
export function GmailThreadActions({ threadId, starred, onDone }: GmailThreadActionsProps) {
  const [busy, setBusy] = useState<Op | null>(null);
  const [note, setNote] = useState<{ text: string; undo?: Op } | null>(null);

  async function run(op: Op) {
    setBusy(op);
    try {
      await oneFetch(`/api/gmail/threads/${encodeURIComponent(threadId)}/modify`, { method: "POST", body: { op } });
      setNote(op === "archive" ? { text: "Archived", undo: "unarchive" } : null);
      onDone?.(op);
    } catch (e) {
      setNote({ text: (e as OneClientError).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div data-block="gmail-thread-actions" className="flex items-center gap-1">
      {note && (
        <span className="mr-1 flex items-center gap-1.5 text-11 text-muted-foreground">
          {note.text}
          {note.undo && (
            <button className="rounded-sm font-medium text-accent underline-offset-2 hover:underline" onClick={() => run(note.undo!)}>
              Undo
            </button>
          )}
        </span>
      )}
      <Button variant="ghost" title="Archive (E)" onClick={() => run("archive")} disabled={busy !== null} icon>
        <Archive className="size-4" />
      </Button>
      <Button variant="ghost" title="Mark unread" onClick={() => run("unread")} disabled={busy !== null} icon>
        <MailOpen className="size-4" />
      </Button>
      <Button variant="ghost" title={starred ? "Unstar" : "Star"} onClick={() => run(starred ? "unstar" : "star")} disabled={busy !== null} icon>
        <Star className={starred ? "size-4 fill-current" : "size-4"} />
      </Button>
    </div>
  );
}
