import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, Inbox as InboxIcon, PenLine, Sparkles } from "lucide-react";
import { LANES, type Lane } from "@rill/core/types";
import { cn, LANE_LABEL } from "@/lib/utils";
import { Logo } from "@/components/Logo";
import { Spinner } from "@/components/ui/Button";
import { ProviderLogos, SAMPLE, LANE_COUNTS, useSignIn } from "./signin-shared";

// The sign-in screen: the split. Sign in on the left, the product itself on the
// right, cycling through the five lanes of the Acme sample so the first
// screen shows what Rill does instead of describing it.
export function SignIn() {
  const s = useSignIn();
  return (
    <div className="grid h-full grid-cols-1 bg-background lg:grid-cols-[minmax(440px,5fr)_7fr]">
      <section className="flex min-h-0 flex-col px-8 py-6 sm:px-12">
        <div className="flex items-center gap-2"><Logo size={18} /><span className="text-15 font-semibold tracking-tight">Rill</span></div>
        <div className="mx-auto flex w-full max-w-[380px] flex-1 flex-col justify-center gap-8 py-10">
          <div className="slide-up flex flex-col gap-3">
            <h1 className="text-3xl font-semibold tracking-[-0.02em] text-balance">The inbox that knows what matters.</h1>
            <p className="text-15 text-muted-foreground text-pretty">Rill reads your Gmail or Outlook, puts what counts on top and drafts the replies. Nothing sends without you.</p>
          </div>

          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={s.signIn}
              disabled={!s.configured || s.connecting}
              className="group flex h-11 items-center gap-2.5 rounded-lg bg-foreground px-4 text-background shadow-[inset_0_1px_0_rgb(255_255_255/0.12)] transition-[filter,opacity] duration-100 hover:brightness-110 disabled:opacity-45"
            >
              {s.connecting ? <Spinner /> : <Logo size={15} className="text-background" />}
              <span className="text-13 font-medium">Sign in with One</span>
              <ProviderLogos className="ml-auto flex items-center gap-1.5 rounded-md bg-background/95 px-1.5 py-1" />
            </button>
            <div className="flex items-center gap-3 text-11 text-muted-foreground"><span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" /></div>
            <button
              type="button"
              onClick={s.openSample}
              disabled={s.sampleBusy}
              className="group flex h-11 items-center gap-2.5 rounded-lg border border-border bg-card px-4 transition-colors duration-100 hover:border-border-strong hover:bg-card-hover"
            >
              {s.sampleBusy ? <Spinner /> : <InboxIcon className="size-4 stroke-[1.75] text-muted-foreground" />}
              <span className="text-13 font-medium">Explore the Acme sample inbox</span>
              <ArrowRight className="ml-auto size-3.5 text-muted-foreground transition-transform duration-100 group-hover:translate-x-0.5" />
            </button>
            {!s.configured ? (
              <p className="text-11 text-muted-foreground">
                Sign in is not set up on this {s.me?.local ? "computer" : "server"} yet.{" "}
                {s.me?.local && <Link to="/setup/connect" className="font-medium text-foreground underline underline-offset-2">Set it up</Link>}
              </p>
            ) : (
              <p className="text-11 text-muted-foreground">No account needed for the sample. A founder's week at Acme Inc, already sorted.</p>
            )}
          </div>

          <ol className="flex flex-col gap-2.5 border-t border-border pt-6 text-xs">
            {[
              ["Connect Gmail or Outlook", "Pick exactly what Rill may do. Read only works."],
              ["Set your goals and VIPs", "Two minutes. They decide what lands on top."],
              ["Open a sorted inbox", "With a reply drafted wherever one is owed."],
            ].map(([t, d], i) => (
              <li key={t} className="flex items-start gap-3">
                <span className="tnum flex size-5 shrink-0 items-center justify-center rounded-full border border-border text-11 text-muted-foreground">{i + 1}</span>
                <span className="flex flex-col gap-0.5"><span className="font-medium text-foreground">{t}</span><span className="text-muted-foreground">{d}</span></span>
              </li>
            ))}
          </ol>
        </div>
        <p className="text-11 text-muted-foreground">Secured by One. You connect your own accounts and can revoke them any time.</p>
      </section>

      <section aria-hidden className="relative hidden min-h-0 overflow-hidden border-l border-border bg-faint lg:block">
        <div className="pointer-events-none absolute inset-0 [background-image:radial-gradient(color-mix(in_oklch,var(--muted-foreground)_22%,transparent)_1px,transparent_1px)] [background-size:20px_20px] [mask-image:radial-gradient(ellipse_at_30%_40%,black,transparent_75%)]" />
        <ProductWindow />
      </section>
    </div>
  );
}

function useCycle(n: number, ms: number) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % n), ms);
    return () => clearInterval(t);
  }, [n, ms]);
  return i;
}

function ProductWindow() {
  const i = useCycle(LANES.length, 3200);
  const lane: Lane = LANES[i];
  const rows = SAMPLE.filter((r) => r.lane === lane);
  return (
    <div className="absolute left-14 top-[14%] w-[920px] overflow-hidden rounded-xl border border-border bg-background shadow-float">
      <div className="flex h-9 items-center gap-1.5 border-b border-border px-3">
        <span className="size-2.5 rounded-full bg-border-strong" /><span className="size-2.5 rounded-full bg-border-strong" /><span className="size-2.5 rounded-full bg-border-strong" />
        <span className="ml-3 text-11 text-muted-foreground">dana@acme.com</span>
      </div>
      <div className="grid grid-cols-[180px_1fr]">
        <nav className="flex flex-col gap-0.5 border-r border-border p-2">
          <div className="flex items-center gap-2 px-2 pb-2 pt-1"><Logo size={13} /><span className="text-13 font-semibold">Rill</span></div>
          <div className="flex h-7 items-center gap-2 rounded-md px-2 text-xs text-muted-foreground"><Sparkles className="size-3.5" />Brief</div>
          {LANES.map((l) => (
            <div key={l} className={cn("flex h-7 items-center rounded-md px-2 text-xs transition-colors duration-200", l === lane ? "bg-muted font-medium text-foreground" : "text-muted-foreground")}>
              {LANE_LABEL[l]}<span className="tnum ml-auto text-11">{LANE_COUNTS[l]}</span>
            </div>
          ))}
        </nav>
        <div className="flex min-h-[720px] flex-col">
          <div className="flex h-11 items-center gap-2 border-b border-border px-4">
            <span className="text-13 font-semibold">{LANE_LABEL[lane]}</span>
            <span className="tnum text-11 text-muted-foreground">{LANE_COUNTS[lane]}</span>
          </div>
          <div key={lane} className="fade-in flex flex-col">
            {rows.map((r) => (
              <div key={r.from} className="flex h-11 items-center gap-3 border-b border-border px-4 text-xs">
                <span className={cn("size-1.5 shrink-0 rounded-full", r.unread ? "bg-accent" : "bg-transparent")} />
                <span className={cn("w-[120px] shrink-0 truncate", r.unread && "font-semibold")}>{r.from}</span>
                {r.reason && (
                  <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-11", r.reason === "Rill drafted" ? "bg-accent/12 text-accent" : "bg-muted text-muted-foreground")}>{r.reason}</span>
                )}
                <span className={cn("min-w-0 flex-1 truncate", r.unread ? "font-medium" : "text-muted-foreground")}>{r.subject}</span>
                <span className="tnum shrink-0 text-11 text-muted-foreground">{r.time}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <DraftCard />
    </div>
  );
}

function DraftCard() {
  return (
    <div className="absolute right-[24%] top-[380px] w-[360px] rounded-lg border border-border bg-card p-3 shadow-pop">
      <div className="flex items-center gap-1.5 text-11 text-muted-foreground"><PenLine className="size-3" />Rill drafted a reply to Riley Chen</div>
      <p className="mt-2 text-xs leading-relaxed">Hi Riley, let's take the 12th. Please confirm the venue before they release it, and send the invoice my way.</p>
      <div className="mt-3 flex items-center gap-2 text-11 text-muted-foreground">
        <Check className="size-3" />Waits for your keypress
        <span className="ml-auto rounded border border-border px-1.5 py-0.5 font-mono text-10">⌘ ↵</span>
      </div>
    </div>
  );
}
