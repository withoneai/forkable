// "Connect accounts": opens One's consent (Sign in with One) in a popup so the
// user can add connections or change access. The callback runs ensureSources,
// so new connections become sources at once; /connected posts back and we refresh.
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { keys } from "@/lib/queries";
import { toast } from "@/lib/toast";

const URL = "/api/one/authorize?returnTo=/connected";

export function useConnectMore() {
  const qc = useQueryClient();
  const popup = useRef<Window | null>(null);
  const [open, setOpen] = useState(false);

  const done = () => {
    popup.current = null;
    setOpen(false);
    void qc.invalidateQueries();
  };

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || (e.data as { type?: string })?.type !== "search:signed-in") return;
      done();
      toast({ title: "Connections updated", detail: "New connections show up as sources and start indexing." });
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => { if (popup.current?.closed) done(); }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const start = () => {
    popup.current = window.open(URL, "search-connect", "width=520,height=760");
    if (!popup.current) { window.location.href = URL; return; }
    setOpen(true);
    void qc.invalidateQueries({ queryKey: keys.sources });
  };

  return { start, open };
}
