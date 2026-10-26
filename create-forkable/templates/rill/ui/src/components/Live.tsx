import { createContext, useContext, type ReactNode } from "react";
import { useMailboxEvents, type MailboxLive } from "@/lib/sse";

const Ctx = createContext<MailboxLive | null>(null);

export function LiveProvider({ mailboxId, children }: { mailboxId: string | null; children: ReactNode }) {
  const live = useMailboxEvents(mailboxId);
  return <Ctx.Provider value={live}>{children}</Ctx.Provider>;
}

export function useLive(): MailboxLive {
  return useContext(Ctx) ?? { connected: false, syncing: false, progress: null, reconnectRequired: false, last: null };
}
