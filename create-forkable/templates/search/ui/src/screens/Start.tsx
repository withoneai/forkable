// /start: Sign in with One, or the Acme sample. The split layout: sign in on
// the left, Search itself on the right, so the first screen shows the product
// instead of describing it.
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useOneConnect } from "@withone/connect/react";
import { ArrowRight, Building2, Search as SearchIcon, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { keys, useMe } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/Logo";
import { SourceLogo } from "@/components/SourceLogo";
import { Spinner } from "@/components/ui/Button";

const BUILT_IN = ["gmail", "hubspot", "slack", "notion", "linear", "google-calendar"];

export function Start() {
  const me = useMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [sampleBusy, setSampleBusy] = useState(false);
  const connect = useOneConnect({ authorizeUrl: "/api/one/authorize" });
  const configured = me.data?.connect.configured ?? false;
  const signedIn = me.data?.signedIn ?? false;

  useEffect(() => {
    if (connect.status === "connected") void qc.invalidateQueries({ queryKey: keys.me }).then(() => nav("/"));
    if (connect.status === "error" && connect.error) toast({ title: "Sign in did not finish", detail: connect.error.message, tone: "destructive" });
  }, [connect.status, connect.error, qc, nav]);

  const openSample = async () => {
    setSampleBusy(true);
    try {
      await api.sampleSources();
      await qc.invalidateQueries({ queryKey: keys.me });
      await qc.invalidateQueries({ queryKey: keys.sources });
      nav("/");
    } catch (e) {
      toast({ title: "Could not open the sample", detail: (e as Error).message, tone: "destructive" });
    } finally {
      setSampleBusy(false);
    }
  };

  return (
    <div className="grid h-full grid-cols-1 bg-background lg:grid-cols-[minmax(440px,5fr)_7fr]">
      <section className="flex min-h-0 flex-col overflow-y-auto px-8 py-6 sm:px-12">
        <div className="flex items-center gap-2"><Logo size={20} /><span className="text-15 font-semibold tracking-tight">Search</span></div>
        <div className="mx-auto flex w-full max-w-[380px] flex-1 flex-col justify-center gap-8 py-10">
          <div className="slide-up flex flex-col gap-3">
            <h1 className="text-3xl font-semibold tracking-[-0.02em] text-balance">One search box for everything you connect.</h1>
            <p className="text-15 text-muted-foreground text-pretty">Mail, calendars, CRMs, docs, issues and chat in one index you own. An assistant on the right reads the results, cites every claim and suggests a better search.</p>
          </div>

          <div className="flex flex-col gap-3">
            {signedIn && (
              <button type="button" onClick={() => nav("/")} data-testid="open-search"
                className="group flex h-11 items-center gap-2.5 rounded-lg bg-primary px-4 text-primary-foreground transition-colors duration-100 hover:bg-primary-hover active:bg-primary-pressed">
                <SearchIcon className="size-4 stroke-[2]" />
                <span className="text-13 font-medium">Open Search</span>
                <ArrowRight className="ml-auto size-3.5 transition-transform duration-100 group-hover:translate-x-0.5" />
              </button>
            )}
            <button
              type="button"
              onClick={connect.open}
              disabled={!configured || connect.status === "connecting"}
              data-testid="sign-in"
              className={cn("group flex h-11 items-center gap-2.5 rounded-lg px-4 transition-[filter,opacity] duration-100",
                // not set up yet: an outline, so the sample is the obvious next step
                configured ? "bg-foreground text-background shadow-[inset_0_1px_0_rgb(255_255_255/0.12)] hover:brightness-110 disabled:opacity-45" : "border border-dashed border-border-strong text-muted-foreground")}
            >
              {connect.status === "connecting" ? <Spinner /> : <Logo size={16} />}
              <span className="text-13 font-medium">Sign in with One</span>
              <span className="ml-auto flex items-center gap-1.5 rounded-md bg-background/95 px-1.5 py-1">
                {BUILT_IN.slice(0, 4).map((p) => <SourceLogo key={p} platform={p} size={14} />)}
              </span>
            </button>
            <div className="flex items-center gap-3 text-11 text-muted-foreground"><span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" /></div>
            <button
              type="button"
              onClick={() => void openSample()}
              disabled={sampleBusy}
              data-testid="try-sample"
              className={cn("group flex h-11 items-center gap-2.5 rounded-lg px-4 transition-colors duration-100",
                configured ? "border border-border bg-card hover:border-border-strong hover:bg-card-hover" : "bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-pressed")}
            >
              {sampleBusy ? <Spinner /> : <Building2 className={cn("size-4 stroke-[1.75]", configured ? "text-muted-foreground" : "")} />}
              <span className="text-13 font-medium">Try the Acme sample</span>
              <ArrowRight className="ml-auto size-3.5 text-muted-foreground transition-transform duration-100 group-hover:translate-x-0.5" />
            </button>
            {!configured ? (
              <p className="text-11 text-muted-foreground">
                Sign in is not set up on this computer yet. <Link to="/setup/connect" className="font-medium text-foreground underline underline-offset-2">Set it up</Link>
              </p>
            ) : (
              <p className="text-11 text-muted-foreground">No account needed for the sample. Acme Inc's tools, already indexed.</p>
            )}
          </div>

          <ol className="flex flex-col gap-2.5 border-t border-border pt-6 text-xs">
            {[
              ["Sign in with One", "Pick the tools Search may read. Read only, always."],
              ["Let it index", "Each source fills in on its own and stays fresh."],
              ["Search, or ask", "Filters like from: and after:, or a plain question."],
            ].map(([t, d], i) => (
              <li key={t} className="flex items-start gap-3">
                <span className="tnum flex size-5 shrink-0 items-center justify-center rounded-full border border-border text-11 text-muted-foreground">{i + 1}</span>
                <span className="flex flex-col gap-0.5"><span className="font-medium text-foreground">{t}</span><span className="text-muted-foreground">{d}</span></span>
              </li>
            ))}
          </ol>
        </div>
        <p className="text-11 text-muted-foreground">Integrations and Sign in with One come built in. Secured by One. You connect your own accounts and can revoke them any time.</p>
      </section>

      <section aria-hidden className="relative hidden min-h-0 overflow-hidden border-l border-border bg-faint lg:block">
        <div className="pointer-events-none absolute inset-0 [background-image:radial-gradient(color-mix(in_oklch,var(--muted-foreground)_22%,transparent)_1px,transparent_1px)] [background-size:20px_20px] [mask-image:radial-gradient(ellipse_at_30%_40%,black,transparent_75%)]" />
        <ProductWindow />
      </section>
    </div>
  );
}

type Row = { platform: string; type: string; title: string; context: string; meta: string };
const ROWS: Row[] = [
  { platform: "hubspot", type: "Deal", title: "Globex renewal 2027", context: "Contract sent · $84,000", meta: "Nov 14" },
  { platform: "gmail", type: "Mail", title: "Priya Shah · Re: Globex renewal terms", context: "(5)", meta: "6h" },
  { platform: "outlook-mail", type: "Mail", title: "Marco Bellini · Globex legal redline, final", context: "", meta: "2d" },
  { platform: "granola", type: "Meeting", title: "Globex contract review", context: "42 min", meta: "Thu" },
  { platform: "slack", type: "Message", title: "Dana: Globex is basically closed, waiting on signature", context: "#deals", meta: "1d" },
  { platform: "linear", type: "Issue", title: "SSO for Globex rollout", context: "ACME-311 · In Progress", meta: "Mia" },
  { platform: "notion", type: "Doc", title: "Globex account plan", context: "in Accounts", meta: "9d" },
];

function useCycle(n: number, ms: number) {
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(() => setI((x) => (x + 1) % n), ms); return () => clearInterval(t); }, [n, ms]);
  return i;
}

function Pill({ n, on }: { n: number; on?: boolean }) {
  return <span className={cn("tnum mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-sm px-1 align-[1px] text-10 font-medium", on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{n}</span>;
}

function ProductWindow() {
  const sel = useCycle(3, 2600);
  const selRow = [0, 2, 3][sel]!;
  return (
    <div className="absolute left-10 top-[12%] w-[min(960px,calc(100%-2.5rem))] overflow-hidden rounded-xl border border-border bg-background shadow-float">
      <div className="flex h-9 items-center gap-1.5 border-b border-border px-3">
        <span className="size-2.5 rounded-full bg-border-strong" /><span className="size-2.5 rounded-full bg-border-strong" /><span className="size-2.5 rounded-full bg-border-strong" />
        <span className="ml-3 text-11 text-muted-foreground">localhost:5680</span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex min-h-[680px] flex-col border-r border-border">
          <div className="flex h-11 items-center gap-2 border-b border-border px-4">
            <SearchIcon className="size-4 text-muted-foreground" />
            <span className="font-mono text-13">globex renewal <span className="rounded-sm bg-muted px-1">with:globex.com</span> <span className="rounded-sm bg-muted px-1">after:30d</span></span>
          </div>
          <div className="flex h-9 items-center gap-1 border-b border-border px-3 text-xs">
            {[["All", 11], ["Mail", 3], ["Deals", 2], ["Meetings", 2], ["Chat", 2], ["Issues", 1]].map(([l, c], i) => (
              <span key={l} className={cn("inline-flex h-6 items-center gap-1.5 rounded-md px-2 font-medium", i === 0 ? "bg-muted text-foreground" : "text-muted-foreground")}>{l}<span className="tnum text-11 text-muted-foreground">{c}</span></span>
            ))}
          </div>
          <div className="flex flex-col py-1">
            {ROWS.map((r, i) => (
              <div key={r.title} className={cn("relative flex h-9 items-center gap-2.5 px-3 text-xs transition-colors duration-300", i === selRow && "bg-muted")}>
                {i === selRow && <span className="absolute inset-y-1 left-0 w-[2px] rounded-full bg-accent" />}
                <SourceLogo platform={r.platform} size={16} />
                <span className="w-14 shrink-0 text-11 text-muted-foreground">{r.type}</span>
                <span className="min-w-0 truncate font-medium">{r.title}</span>
                <span className="min-w-0 truncate text-muted-foreground">{r.context}</span>
                <span className="tnum ml-auto shrink-0 text-11 text-muted-foreground">{r.meta}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col">
          <div className="flex h-11 items-center gap-2 border-b border-border px-3 text-13 font-medium"><Sparkles className="size-3.5 text-accent" />Assistant</div>
          <div className="flex flex-col gap-3 p-3 text-xs">
            <p className="self-end rounded-lg bg-muted px-2.5 py-1.5">Where are we with Globex?</p>
            <p className="text-11 text-muted-foreground">Searched 2 ways · read 11 items</p>
            <p className="leading-relaxed">
              Priya Shah is your champion on the $84,000 renewal<Pill n={1} on={sel === 0} />. Globex legal sent the final redline two days ago<Pill n={2} on={sel === 1} />, and on Thursday's call Priya asked for a multi-year discount before signing<Pill n={3} on={sel === 2} />.
            </p>
            <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-2.5">
              <span className="text-11 text-muted-foreground">Try a narrower search</span>
              <span className="flex flex-wrap gap-1 font-mono text-11"><span className="rounded-sm bg-muted px-1">+ with:globex.com</span><span className="rounded-sm bg-muted px-1">+ after:14d</span></span>
              <span className="flex items-center justify-between text-11"><span className="text-muted-foreground">7 results</span><span className="rounded-md bg-primary px-2 py-0.5 font-medium text-primary-foreground">Apply</span></span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
