// After Save, when the new sources need more than Search may read today: one card
// in the sheet instead of three places. 1 Update the Connect app (Search runs the
// update and waits for the approval in One), 2 Grant the platform (Sign in with
// One in a popup; the callback attaches the waiting sources), 3 Indexing (the
// saved sources leave "waiting" and start their first run).
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, LogIn, RefreshCw } from "lucide-react";
import type { ApiSource, ConnectSetupResponse } from "@/contract/api-types";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button, Spinner } from "@/components/ui/Button";
import { ApprovalLink } from "@/screens/ConnectSetup";

type Phase = "todo" | "working" | "done" | "failed";

export function FinishStep({ platform, sourceIds, needsAppUpdate, onOpenSource, onLater }: {
  platform: string; sourceIds: string[]; needsAppUpdate: boolean; onOpenSource: (id: string) => void; onLater: () => void;
}) {
  const [app, setApp] = useState<Phase>(needsAppUpdate ? "todo" : "done");
  const [setup, setSetup] = useState<ConnectSetupResponse | null>(null);
  const [grant, setGrant] = useState<Phase>("todo");
  const [srcs, setSrcs] = useState<ApiSource[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const popup = useRef<Window | null>(null);

  // 1. the Connect app: start the update, then follow it until One says approved
  const startApp = async () => {
    setApp("working");
    setNote(null);
    try { setSetup(await api.createConnectApp()); } catch (e) { setApp("failed"); setNote((e as Error).message); }
  };
  useEffect(() => {
    if (app !== "working") return;
    const t = setInterval(async () => {
      try {
        const s = await api.pollConnectApp();
        setSetup(s);
        if (s.create.state === "approved") setApp("done");
        if (s.create.state === "failed") { setApp("failed"); setNote(s.create.message ?? "The update did not finish."); }
      } catch { /* keep polling */ }
    }, 2000);
    return () => clearInterval(t);
  }, [app]);

  // 2. the grant: Sign in with One in a popup; /connected tells us it finished
  const startGrant = () => {
    setGrant("working");
    setNote(null);
    popup.current = window.open("/api/one/authorize?returnTo=/connected", "search-signin", "width=520,height=760");
    if (!popup.current) window.location.href = "/api/one/authorize?returnTo=/connected";
  };
  useEffect(() => {
    const onMsg = (e: MessageEvent) => { if (e.origin === window.location.origin && (e.data as { type?: string })?.type === "search:signed-in") void checkSources(true); };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 3. the saved sources, until none is waiting
  const checkSources = async (afterSignIn = false) => {
    const list = await Promise.all(sourceIds.map((id) => api.source(id).catch(() => null)));
    const ok = list.filter((s): s is ApiSource => !!s);
    setSrcs(ok);
    const waiting = ok.some((s) => s.health.status === "awaiting_grant");
    if (!waiting && ok.length) setGrant("done");
    else if (afterSignIn) { setGrant("failed"); setNote(`${platform} is still not in your grant. Sign in again and turn ${platform} on in the list of tools.`); }
  };
  useEffect(() => {
    if (grant !== "working") return;
    const t = setInterval(() => {
      if (popup.current && popup.current.closed) { popup.current = null; void checkSources(true); }
      else void checkSources(false);
    }, 2500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grant]);
  useEffect(() => { void checkSources(false); /* a source may already be live */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // in order: nothing reads as granted or indexing until the app is approved
  const granted = app === "done" && grant === "done";
  const indexing = granted;
  return (
    <div className="flex flex-col gap-3" data-testid="finish-connect">
      <Step n={1} title="Update your Connect app" phase={app}
        body={app === "done" ? (needsAppUpdate ? `Approved. The app now asks for what ${platform} needs.` : "Nothing to change in the app.") : `Search adds what these ${platform} sources read to the app, and you approve it in One.`}>
        {app === "todo" && <Button variant="primary" icon={<ArrowRight />} onClick={() => void startApp()} data-testid="finish-app">Update and approve in One</Button>}
        {app === "working" && (setup?.create.approvalUrl ? <ApprovalLink url={setup.create.approvalUrl} /> : <span className="flex items-center gap-2 text-xs text-muted-foreground"><Spinner /> Preparing the update...</span>)}
        {app === "failed" && <Button icon={<RefreshCw />} onClick={() => void startApp()}>Try again</Button>}
      </Step>
      <Step n={2} title={`Grant ${platform}`} phase={app !== "done" ? "todo" : grant} disabled={app !== "done"}
        body={granted ? `${platform} is in your grant.` : `Sign in with One again and turn ${platform} on. A small window opens and closes by itself.`}>
        {app === "done" && !granted && (
          <Button variant={grant === "working" ? "default" : "primary"} icon={<LogIn />} loading={grant === "working"} onClick={startGrant} data-testid="finish-grant">
            {grant === "failed" ? "Sign in again" : "Sign in with One"}
          </Button>
        )}
      </Step>
      <Step n={3} title="Indexing" phase={indexing ? "done" : "todo"} disabled={!indexing}
        body={indexing ? `Started. ${srcs.length === 1 ? "The first run is going." : `${srcs.length} sources are running their first pass.`}` : "Starts as soon as the grant arrives."}>
        {indexing && srcs[0] && <Button variant="primary" icon={<ArrowRight />} className="self-start" onClick={() => onOpenSource(srcs[0]!.id)} data-testid="finish-open">Open {srcs.length > 1 ? "the first source" : "the source"}</Button>}
      </Step>
      {note && <p className="rounded-lg border border-border bg-card px-3 py-2 text-13 text-warning-text">{note}</p>}
      {!indexing && (
        <button type="button" onClick={onLater} className="self-start px-1 text-xs text-muted-foreground hover:text-foreground">
          Do this later. The sources wait, and the next sign-in that grants {platform} starts them.
        </button>
      )}
    </div>
  );
}

function Step({ n, title, body, phase, disabled, children }: { n: number; title: string; body: string; phase: Phase; disabled?: boolean; children?: React.ReactNode }) {
  return (
    <section className={cn("flex items-start gap-3 rounded-xl border border-border bg-card p-3", disabled && "opacity-60")}>
      <span className={cn("tnum mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-11", phase === "done" ? "bg-foreground text-background" : "border border-border-strong text-muted-foreground")}>
        {phase === "done" ? <Check className="size-3 stroke-[3]" /> : phase === "working" ? <Spinner className="size-3" /> : n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <p className="text-13 font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">{body}</p>
        </div>
        {children}
      </div>
    </section>
  );
}
