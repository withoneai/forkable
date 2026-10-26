import { useState } from "react";
import { Send } from "lucide-react";
import { useCompose } from "@/lib/queries";
import { useMailbox } from "@/lib/mailbox";
import { toast } from "@/lib/toast";
import { Dialog } from "../ui/Dialog";
import { Button } from "../ui/Button";
import { Field, Input, Textarea } from "../ui/Input";
import { AttendeeInput, type Attendee } from "../calendar/AttendeeInput";

/** A new, non-reply draft, saved straight to the mailbox's Drafts (Gmail or
 *  Outlook). It stops at "saved", the way "Save to Drafts" does in the Reader:
 *  you send it from your mail app. */
export function ComposeDialog({ mailboxId, open, onClose }: { mailboxId: string; open: boolean; onClose: () => void }) {
  const [to, setTo] = useState<Attendee[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const compose = useCompose(mailboxId);
  const mailName = useMailbox().mailbox?.mailProvider === "outlook-mail" ? "Outlook" : "Gmail";

  const reset = () => { setTo([]); setSubject(""); setBody(""); };
  const close = () => { onClose(); reset(); };
  const submit = () => {
    if (to.length === 0 || !subject.trim() || compose.isPending) return;
    compose.mutate(
      { to: to.map((a) => a.email), subject: subject.trim(), body },
      {
        onSuccess: () => { toast({ title: `Saved to ${mailName} Drafts`, detail: subject.trim() }); close(); },
        onError: (e) => toast({ title: "Not saved", detail: e.message, tone: "destructive" }),
      },
    );
  };

  return (
    <Dialog open={open} onClose={close} title="New message">
      <form className="flex flex-col gap-3 p-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label="To">
          <AttendeeInput mailboxId={mailboxId} value={to} onChange={setTo} autoFocus />
        </Field>
        <Field label="Subject">
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" aria-label="Subject" />
        </Field>
        <Field label="Message">
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} placeholder="Write your message" aria-label="Message" />
        </Field>
        <div className="flex items-center justify-end gap-1.5 pt-1">
          <Button type="button" size="sm" variant="ghost" onClick={close}>Cancel</Button>
          <Button type="submit" variant="primary" size="sm" icon={<Send />} loading={compose.isPending} disabled={to.length === 0 || !subject.trim()}>
            Save to Drafts
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
