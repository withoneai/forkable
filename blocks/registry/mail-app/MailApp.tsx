import { useState } from "react";
import { PenSquare } from "lucide-react";
import { GmailInbox } from "../gmail-inbox/GmailInbox";
import { GmailThread } from "../gmail-thread/GmailThread";
import { GmailThreadActions } from "../gmail-thread-actions/GmailThreadActions";
import { GmailCompose } from "../gmail-compose/GmailCompose";
import { GmailAiReply } from "../gmail-ai-reply/GmailAiReply";
import { Button } from "../lib/one-ui";
import type { MailThread } from "../gmail/types";

/** A whole mail client from the Gmail components. About 40 lines; make it yours. */
export function MailApp() {
  const [open, setOpen] = useState<MailThread | null>(null);
  const [composing, setComposing] = useState(false);
  const [refresh, setRefresh] = useState(0);

  return (
    <div data-block="mail-app" className="relative flex h-full min-h-0 overflow-hidden rounded-xl border border-border bg-card shadow-soft">
      <div className="flex w-[22rem] shrink-0 flex-col border-r border-border">
        <div className="flex h-12 items-center gap-2 px-3">
          <span className="text-13 font-semibold text-foreground">Mail</span>
          <Button variant="primary" className="ml-auto" onClick={() => setComposing(true)}>
            <PenSquare className="size-3.5" /> Compose
          </Button>
        </div>
        <GmailInbox className="min-h-0 flex-1" selectedId={open?.id} onSelect={setOpen} refreshKey={refresh} />
      </div>
      <GmailThread
        className="min-w-0 flex-1"
        threadId={open?.id ?? null}
        actions={
          open && (
            <GmailThreadActions
              threadId={open.id}
              starred={open.starred}
              onDone={(op) => {
                setRefresh((n) => n + 1);
                if (op === "star" || op === "unstar") setOpen({ ...open, starred: op === "star" });
              }}
            />
          )
        }
        footer={open && <GmailAiReply threadId={open.id} replyTo={open.from.email} subject={open.subject} />}
      />
      {composing && (
        <div className="absolute right-4 bottom-4 w-[28rem]">
          <GmailCompose open onClose={() => setComposing(false)} />
        </div>
      )}
    </div>
  );
}
