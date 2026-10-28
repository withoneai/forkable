import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { oneFetch, type OneClientError, type OneMeta } from "../lib/one-client";
import { Button, SourceChip } from "../lib/one-ui";
import type { DraftInput } from "../gmail/types";

export interface GmailComposeProps {
  open: boolean;
  onClose: () => void;
  initial?: Partial<DraftInput>;
  /** Off by default: the component saves to Drafts and the user sends from Gmail. */
  allowSend?: boolean;
}

/** A new message saved to the user's Gmail Drafts. Cmd+Enter saves. */
export function GmailCompose({ open, onClose, initial, allowSend = false }: GmailComposeProps) {
  const [to, setTo] = useState(initial?.to?.join(", ") ?? "");
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [state, setState] = useState<{ kind: "idle" | "saving" | "saved" | "sent" | "error"; text?: string; meta?: OneMeta }>({ kind: "idle" });
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setState({ kind: "idle" });
      setTimeout(() => first.current?.focus(), 0);
    }
  }, [open]);

  if (!open) return null;

  async function submit(path: "/api/gmail/drafts" | "/api/gmail/send") {
    setState({ kind: "saving" });
    const input: DraftInput = { to: to.split(",").map((s) => s.trim()).filter(Boolean), subject, body, threadId: initial?.threadId };
    try {
      const r = await oneFetch<{ id: string }>(path, { method: "POST", body: input });
      setState({ kind: path === "/api/gmail/send" ? "sent" : "saved", meta: r.meta });
    } catch (e) {
      setState({ kind: "error", text: (e as OneClientError).message });
    }
  }

  return (
    <div
      data-block="gmail-compose"
      role="dialog"
      aria-label="New message"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit("/api/gmail/drafts");
      }}
      className="flex w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-card shadow-overlay"
    >
      <div className="flex h-11 items-center gap-2 border-b border-border px-3">
        <span className="text-13 font-medium text-foreground">New message</span>
        <SourceChip meta={state.meta ?? null} />
        <Button variant="ghost" size="sm" icon onClick={onClose} className="ml-auto" aria-label="Close">
          <X className="size-4" />
        </Button>
      </div>
      <Field label="To">
        <input ref={first} value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@company.com" className="w-full bg-transparent text-13 outline-none" />
      </Field>
      <Field label="Subject">
        <input value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full bg-transparent text-13 outline-none" />
      </Field>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} className="resize-none bg-transparent px-3 py-2 text-13 leading-relaxed text-foreground outline-none" />
      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        <span className="text-11 text-muted-foreground">
          {state.kind === "saving" ? "Saving..." : state.kind === "saved" ? "Saved to Gmail Drafts" : state.kind === "sent" ? "Sent" : state.kind === "error" ? state.text : "Cmd+Enter saves to Drafts"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {allowSend && (
            <Button onClick={() => submit("/api/gmail/send")} disabled={state.kind === "saving"}>
              Send
            </Button>
          )}
          <Button variant="primary" onClick={() => submit("/api/gmail/drafts")} disabled={state.kind === "saving"}>
            Save draft
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2 border-b border-border px-3 py-2 text-foreground focus-within:bg-foreground/3">
      <span className="w-14 shrink-0 text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
