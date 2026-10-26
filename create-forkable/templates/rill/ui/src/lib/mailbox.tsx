import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ApiMailbox, MeResponse } from "@rill/core/api-types";
import { useMe } from "./queries";

const KEY = "rill.mailbox";

interface MailboxCtx {
  me: MeResponse | undefined;
  loading: boolean;
  mailboxes: ApiMailbox[];
  mailbox: ApiMailbox | null;
  mailboxId: string | null;
  select: (id: string) => void;
}

const Ctx = createContext<MailboxCtx | null>(null);

export function MailboxProvider({ children }: { children: ReactNode }) {
  const me = useMe();
  const [picked, setPicked] = useState<string | null>(() => {
    try { return localStorage.getItem(KEY); } catch { return null; }
  });
  const mailboxes = me.data?.mailboxes ?? [];
  const mailbox = useMemo(() => {
    if (mailboxes.length === 0) return null;
    return mailboxes.find((m) => m.id === picked) ?? mailboxes.find((m) => m.source === "live") ?? mailboxes[0]!;
  }, [mailboxes, picked]);
  const select = useCallback((id: string) => {
    setPicked(id);
    try { localStorage.setItem(KEY, id); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    if (mailbox && mailbox.id !== picked) select(mailbox.id);
  }, [mailbox, picked, select]);
  const value = useMemo<MailboxCtx>(() => ({
    me: me.data,
    loading: me.isPending,
    mailboxes,
    mailbox,
    mailboxId: mailbox?.id ?? null,
    select,
  }), [me.data, me.isPending, mailboxes, mailbox, select]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMailbox(): MailboxCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useMailbox outside MailboxProvider");
  return v;
}

/** For screens that only render when a mailbox exists. */
export function useMailboxId(): string {
  const { mailboxId } = useMailbox();
  if (!mailboxId) throw new Error("No mailbox");
  return mailboxId;
}
