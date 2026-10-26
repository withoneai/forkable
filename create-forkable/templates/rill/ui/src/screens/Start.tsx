import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useOneConnect } from "@withone/connect/react";
import { ArrowRight, Check, ListChecks, Mail, PenLine, Plus, ShieldCheck } from "lucide-react";
import type { ApiMailbox, MailboxEvent, VipSuggestion } from "@rill/core/api-types";
import { LANES, type Lane } from "@rill/core/types";
import { api } from "@/lib/api";
import { useMailbox } from "@/lib/mailbox";
import { keys, useGoals, useSuggestions, useVips } from "@/lib/queries";
import { useMailboxEvents } from "@/lib/sse";
import { toast } from "@/lib/toast";
import { cn, LANE_LABEL } from "@/lib/utils";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Input, Textarea } from "@/components/ui/Input";
import { Slider } from "@/components/ui/Slider";
import { Avatar } from "@/components/ui/Avatar";
import { Skeleton } from "@/components/ui/Skeleton";

type Step = 1 | 2 | 3 | 4;
const STEPS: { n: Step; label: string }[] = [
  { n: 1, label: "Sign in" },
  { n: 2, label: "Goals" },
  { n: 3, label: "VIPs" },
  { n: 4, label: "Sort" },
];

export function Start() {
  const { me, loading, mailbox, select } = useMailbox();
  const [params] = useSearchParams();
  const [step, setStep] = useState<Step>(() => {
    // Dev convenience: /start?step=3 opens a later step when a mailbox exists.
    const n = Number(params.get("step"));
    return n >= 1 && n <= 4 ? (n as Step) : 1;
  });
  const [created, setCreated] = useState<ApiMailbox | null>(null);
  const nav = useNavigate();
  const mb = created ?? mailbox;

  useEffect(() => {
    // A mailbox exists but onboarding was not finished: pick up at goals.
    if (!loading && mailbox && !mailbox.onboarded && step === 1 && !created) setStep(2);
  }, [loading, mailbox, step, created]);

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center px-5">
        <div className="flex items-center gap-2"><Logo size={16} /><span className="text-13 font-semibold tracking-tight">Rill</span></div>
        <ol className="flex items-center gap-1" aria-label={`Step ${step} of 4`}>
          {STEPS.map((s) => (
            <li key={s.n} aria-current={s.n === step ? "step" : undefined} className="flex items-center gap-1">
              <span className={cn("flex h-6 items-center gap-1.5 rounded-md px-2 text-xs transition-colors duration-100", s.n === step ? "bg-muted font-medium text-foreground" : s.n < step ? "text-foreground/70" : "text-muted-foreground/70")}>
                {s.n < step ? <Check className="size-3" /> : <span className="tnum text-11">{s.n}</span>}
                {s.label}
              </span>
              {s.n < 4 && <span className="h-px w-3 bg-border" aria-hidden />}
            </li>
          ))}
        </ol>
        <span />
      </header>
      <main className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto px-5 py-8">
        {step === 1 && <Welcome me={me} onMailbox={(m) => {
          setCreated(m); select(m.id);
          // The sample ships with goals and VIPs already set, so it opens straight onto the inbox.
          if (m.onboarded) nav("/inbox/vip"); else setStep(2);
        }} />}
        {step === 2 && mb && <Goals mailboxId={mb.id} onNext={() => setStep(3)} onSkip={() => setStep(4)} />}
        {step === 3 && mb && <Vips mailboxId={mb.id} onNext={() => setStep(4)} onBack={() => setStep(2)} />}
        {step === 4 && mb && <LiveSort mailboxId={mb.id} />}
      </main>
    </div>
  );
}

function Welcome({ me, onMailbox }: { me: ReturnType<typeof useMailbox>["me"]; onMailbox: (m: ApiMailbox) => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<"sample" | null>(null);
  const connect = useOneConnect({
    authorizeUrl: "/api/one/authorize",
    connector: "gmail",
    onSuccess: () => { qc.invalidateQueries({ queryKey: keys.me }); },
    onError: (message) => toast({ title: "Sign in did not finish", detail: message, tone: "destructive" }),
  });
  const configured = me?.connect.configured ?? false;

  const createSample = async () => {
    setBusy("sample");
    try {
      const m = await api.createSampleMailbox();
      await qc.invalidateQueries({ queryKey: keys.me });
      onMailbox(m);
    } catch (e) {
      toast({ title: "Could not open that mailbox", detail: (e as Error).message, tone: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="slide-up flex w-full max-w-[460px] flex-col gap-8 pt-[7vh]">
      <div className="flex flex-col gap-4">
        <Logo size={36} />
        <h1 className="text-28 font-semibold tracking-tight">Your goals and your VIPs decide what you see first.</h1>
        <p className="text-13 text-muted-foreground">
          Rill is an AI email client on your own Gmail or Outlook. It sorts every email into five lanes, writes the reply, and never sends without your keypress.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Button variant="primary" icon={<Mail />} className="h-10 justify-start px-3.5 text-13" disabled={!configured || connect.status === "connecting"} loading={connect.status === "connecting"} onClick={connect.open}>
          Sign in with One
          <span className="ml-auto text-11 font-normal opacity-80">Gmail or Outlook, custom access</span>
        </Button>
        {!configured && (
          <p className="px-1 text-11 text-muted-foreground">
            Sign in is not set up on this {me?.local ? "computer" : "server"} yet. The sample inbox works without it.
            {me?.local && <> <Link to="/setup/connect" className="font-medium text-foreground underline underline-offset-2">Set up Sign in with One</Link></>}
          </p>
        )}
        <Button icon={<ArrowRight />} className="h-10 justify-start px-3.5 text-13" loading={busy === "sample"} onClick={() => void createSample()}>
          Try the Acme sample inbox
          <span className="ml-auto text-11 font-normal text-muted-foreground">No keys, recorded judgments</span>
        </Button>
      </div>
      <ul className="flex flex-col gap-2.5 text-xs text-muted-foreground">
        <li className="flex items-start gap-2.5"><ListChecks className="mt-0.5 size-3.5 shrink-0 stroke-[1.75]" /><span><span className="text-foreground">Reads and sorts</span> with exactly the mail actions you grant, in your One account.</span></li>
        <li className="flex items-start gap-2.5"><PenLine className="mt-0.5 size-3.5 shrink-0 stroke-[1.75]" /><span><span className="text-foreground">Writes drafts.</span> Only your keypress sends. The writer has no tools.</span></li>
        <li className="flex items-start gap-2.5"><ShieldCheck className="mt-0.5 size-3.5 shrink-0 stroke-[1.75]" /><span><span className="text-foreground">Lists every call</span> under Access, including the ones One refused.</span></li>
      </ul>
      <div className="flex items-center gap-3 rounded-md border border-border bg-faint px-3 py-2 font-mono text-11 text-muted-foreground" aria-label="Example receipt">
        <span className="text-foreground">Gmail · delete</span>
        <span className="flex-1 border-b border-dotted border-border-strong" aria-hidden />
        <span className="text-destructive-text">declined, 403</span>
      </div>
    </div>
  );
}

type GoalPick = { title: string; detail: string; weight: number; custom?: boolean };

function Goals({ mailboxId, onNext, onSkip }: { mailboxId: string; onNext: () => void; onSkip: () => void }) {
  const qc = useQueryClient();
  const sug = useSuggestions(mailboxId);
  const existing = useGoals(mailboxId);
  const [picked, setPicked] = useState<GoalPick[]>([]);
  const [custom, setCustom] = useState({ title: "", detail: "" });
  const [customOpen, setCustomOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const options = useMemo(() => {
    const base = sug.data?.goals ?? [];
    const extra = picked.filter((p) => !base.some((g) => g.title === p.title));
    return [...base, ...extra];
  }, [sug.data, picked]);

  useEffect(() => {
    if (existing.data && picked.length === 0 && existing.data.length > 0) {
      setPicked(existing.data.slice(0, 3).map((g) => ({ title: g.title, detail: g.detail, weight: g.weight })));
    }
  }, [existing.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (g: { title: string; detail: string }) => {
    setPicked((p) => {
      const has = p.some((x) => x.title === g.title);
      if (has) return p.filter((x) => x.title !== g.title);
      if (p.length >= 3) { toast({ title: "Three goals is the limit for now", detail: "Pause one in Settings later" }); return p; }
      return [...p, { title: g.title, detail: g.detail, weight: 7 }];
    });
  };
  const addCustom = () => {
    if (!custom.title.trim()) return;
    setPicked((p) => {
      if (p.length >= 3) { toast({ title: "Three goals is the limit for now", detail: "Pause one in Settings later" }); return p; }
      return [...p, { title: custom.title.trim(), detail: custom.detail.trim(), weight: 7, custom: true }];
    });
    setCustom({ title: "", detail: "" });
    setCustomOpen(false);
  };
  const save = async () => {
    setSaving(true);
    try {
      const current = existing.data ?? [];
      for (const g of current) if (!picked.some((p) => p.title === g.title)) await api.deleteGoal(mailboxId, g.id);
      for (const p of picked) {
        const found = current.find((g) => g.title === p.title);
        if (found) { if (found.weight !== p.weight || found.detail !== p.detail) await api.updateGoal(mailboxId, found.id, { weight: p.weight, detail: p.detail }); }
        else await api.createGoal(mailboxId, { title: p.title, detail: p.detail, weight: p.weight });
      }
      await qc.invalidateQueries({ queryKey: keys.goals(mailboxId) });
      onNext();
    } catch (e) {
      toast({ title: "Goals did not save", detail: (e as Error).message, tone: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <div className="slide-up flex w-full max-w-[640px] flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Pick up to three goals</h1>
        <p className="mt-1 text-13 text-muted-foreground">Jev judges every email against these. A title and one plain-English line of what counts.</p>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {sug.isPending && Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[72px] w-full rounded-lg" />)}
        {options.map((g) => {
          const on = picked.find((p) => p.title === g.title);
          return (
            <div key={g.title} className={cn("flex flex-col rounded-lg border transition-colors duration-100", on ? "border-foreground/40 bg-card shadow-[0_1px_2px_rgb(0_0_0/0.03)]" : "border-border bg-card hover:border-border-strong")}>
              <button type="button" onClick={() => toggle(g)} aria-pressed={!!on} className="flex flex-1 items-start gap-3 px-3 py-2.5 text-left">
                <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border transition-colors", on ? "border-foreground bg-foreground text-background" : "border-border-strong")}>{on && <Check className="size-3 stroke-[3]" />}</span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-13 font-medium leading-snug">{g.title}</span>
                  <span className="text-xs text-muted-foreground">{g.detail}</span>
                </span>
              </button>
              {on && (
                <div className="fade-in flex items-center gap-3 border-t border-border px-3 py-1.5">
                  <span className="w-11 text-11 text-muted-foreground">Priority</span>
                  <Slider label={`Priority for ${g.title}`} format={priorityLabel} value={on.weight} onChange={(w) => setPicked((p) => p.map((x) => (x.title === g.title ? { ...x, weight: w } : x)))} />
                </div>
              )}
            </div>
          );
        })}
        {!customOpen && !sug.isPending && (
          <button type="button" onClick={() => setCustomOpen(true)} className="flex min-h-[72px] items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong text-13 text-muted-foreground transition-colors hover:bg-faint hover:text-foreground">
            <Plus className="size-3.5" /> Type your own
          </button>
        )}
      </div>
      {customOpen && (
        <form className="slide-up flex flex-col gap-2 rounded-lg border border-border bg-card p-3" onSubmit={(e) => { e.preventDefault(); addCustom(); }}>
          <p className="label-caps">Your own goal</p>
          <Input autoFocus placeholder="Title, like: Renew the three biggest contracts" value={custom.title} onChange={(e) => setCustom({ ...custom, title: e.target.value })} aria-label="Goal title" />
          <Textarea placeholder="What counts, in one line. What does not count helps too." value={custom.detail} onChange={(e) => setCustom({ ...custom, detail: e.target.value })} aria-label="Goal detail" className="min-h-[52px]" />
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setCustomOpen(false)}>Cancel</Button>
            <Button size="sm" type="submit" icon={<Plus />} disabled={!custom.title.trim()}>Add goal</Button>
          </div>
        </form>
      )}
      <div className="flex items-center justify-between">
        <span className="tnum text-xs text-muted-foreground">{picked.length} of 3 picked · change these any time in Settings</span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onSkip}>Skip for now</Button>
          <Button variant="primary" onClick={() => void save()} loading={saving} disabled={picked.length === 0} trailing={<ArrowRight className="size-3.5" />}>Next, your VIPs</Button>
        </div>
      </div>
    </div>
  );
}

function Vips({ mailboxId, onNext, onBack }: { mailboxId: string; onNext: () => void; onBack: () => void }) {
  const qc = useQueryClient();
  const sug = useSuggestions(mailboxId);
  const existing = useVips(mailboxId);
  const [on, setOn] = useState<Set<string> | null>(null);
  const [saving, setSaving] = useState(false);
  const list: VipSuggestion[] = sug.data?.vips ?? [];
  useEffect(() => { if (sug.data && on === null) setOn(new Set(sug.data.vips.map((v) => v.email))); }, [sug.data, on]);

  const save = async () => {
    setSaving(true);
    try {
      const have = new Set((existing.data ?? []).map((v) => v.match.toLowerCase()));
      for (const v of list) {
        if (!on?.has(v.email) || have.has(v.email.toLowerCase())) continue;
        await api.createVip(mailboxId, { name: v.name, matchKind: "address", match: v.email, tier: "key" });
      }
      await qc.invalidateQueries({ queryKey: keys.vips(mailboxId) });
      onNext();
    } catch (e) {
      toast({ title: "VIPs did not save", detail: (e as Error).message, tone: "destructive" });
    } finally { setSaving(false); }
  };
  const picked = list.filter((v) => on?.has(v.email) ?? true).length;

  return (
    <div className="slide-up flex w-full max-w-[560px] flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Confirm your VIPs</h1>
        <p className="mt-1 text-13 text-muted-foreground">Suggested from who you write to most. Their emails always land on top. Untick anyone you like.</p>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {sug.isPending && <div className="p-3"><Skeleton className="h-32 w-full" /></div>}
        {list.map((v) => {
          const checked = on?.has(v.email) ?? true;
          return (
            <label key={v.email} className={cn("flex h-12 cursor-default items-center gap-3 border-b border-border px-3 transition-colors last:border-b-0 hover:bg-faint", !checked && "opacity-60")}>
              <input type="checkbox" className="sr-only" checked={checked} onChange={() => setOn((s) => { const n = new Set(s); checked ? n.delete(v.email) : n.add(v.email); return n; })} />
              <span aria-hidden className={cn("flex size-4 shrink-0 items-center justify-center rounded-sm border transition-colors", checked ? "border-foreground bg-foreground text-background" : "border-border-strong")}>{checked && <Check className="size-3 stroke-[3]" />}</span>
              <Avatar name={v.name} size="md" />
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate text-13 font-medium">{v.name} <span className="font-normal text-muted-foreground">{v.email}</span></span>
                <span className="truncate text-11 text-muted-foreground">{v.reason}</span>
              </span>
              <span className="tnum text-11 text-muted-foreground">{v.sentCount} sent</span>
            </label>
          );
        })}
        {!sug.isPending && list.length === 0 && <p className="p-4 text-13 text-muted-foreground">No suggestions yet. Add VIPs in Settings any time.</p>}
      </div>
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}>Back</Button>
        <div className="flex items-center gap-3">
          <span className="tnum text-xs text-muted-foreground">{picked} of {list.length}</span>
          <Button variant="ghost" onClick={onNext}>Skip</Button>
          <Button variant="primary" onClick={() => void save()} loading={saving} trailing={<ArrowRight className="size-3.5" />}>Sort my inbox</Button>
        </div>
      </div>
    </div>
  );
}

function LiveSort({ mailboxId }: { mailboxId: string }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { mailbox } = useMailbox();
  const [counts, setCounts] = useState<Record<Lane, number>>(() => Object.fromEntries(LANES.map((l) => [l, 0])) as Record<Lane, number>);
  const [recent, setRecent] = useState<{ threadId: string; lane: Lane; from?: string; subject?: string }[]>([]);
  const live = useMailboxEvents(mailboxId, (e: MailboxEvent) => {
    if (e.type === "judged") {
      setCounts((c) => ({ ...c, [e.lane]: c[e.lane] + 1 }));
      setRecent((r) => [{ threadId: e.threadId, lane: e.lane, from: e.from, subject: e.subject }, ...r].slice(0, 7));
    }
  });
  const shown = useMemo(() => {
    // Server counts are the truth once they arrive; event counts fill the gap.
    const server = mailbox?.counts;
    if (!server) return counts;
    return Object.fromEntries(LANES.map((l) => [l, Math.max(server[l], counts[l])])) as Record<Lane, number>;
  }, [counts, mailbox?.counts]);
  const sorted = LANES.reduce((n, l) => n + shown[l], 0);
  const total = live.progress?.total ?? 0;
  const judged = live.progress?.judged ?? 0;
  const done = (total > 0 && judged >= total) || (total === 0 && sorted > 0 && !live.syncing);
  const [opening, setOpening] = useState(false);

  const openInbox = async () => {
    setOpening(true);
    try {
      await api.updateSettings(mailboxId, { onboarded: true });
      await qc.invalidateQueries({ queryKey: keys.me });
      nav("/inbox/vip");
    } catch (e) {
      toast({ title: "Could not finish", detail: (e as Error).message, tone: "destructive" });
      setOpening(false);
    }
  };

  return (
    <div className="slide-up flex w-full max-w-[600px] flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          {done ? <>Sorted. <span className="tnum">{sorted}</span> emails in five lanes.</> : "Sorting your inbox"}
        </h1>
        <p className="mt-1 text-13 text-muted-foreground">
          {!done && total > 0 && <><span className="tnum font-medium text-foreground">{judged} of {total}</span> so far. </>}
          {!done && total === 0 && "Connecting to Jev. "}
          Jev reads each email once and answers a fixed set of questions. Your goals and VIPs decide the lane.
        </p>
      </div>
      <div className="h-[3px] w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={total || 1} aria-valuenow={done ? (total || 1) : judged}>
        <div className={cn("h-full rounded-full transition-[width] duration-300 ease-out", done ? "bg-muted-foreground/50" : "bg-foreground")} style={{ width: done ? "100%" : total ? `${(judged / total) * 100}%` : "0%" }} />
      </div>
      <div className="grid grid-cols-5 gap-2">
        {LANES.map((l) => (
          <div key={l} className="flex flex-col gap-1 rounded-lg border border-border bg-card px-3 py-2.5">
            <span className="text-11 text-muted-foreground">{LANE_LABEL[l]}</span>
            <span className="tnum text-xl font-semibold leading-none tracking-tight">{shown[l]}</span>
          </div>
        ))}
      </div>
      <div className="flex min-h-[132px] flex-col" aria-live="polite">
        {recent.length === 0 && !done && (
          <p className="text-xs text-muted-foreground">Emails appear here as Jev places them.</p>
        )}
        {recent.length === 0 && done && (
          <p className="text-xs text-muted-foreground">Every lane is ready. The brief of your inbox is waiting on the other side.</p>
        )}
        {recent.map((r, i) => (
          <div key={`${r.threadId}-${i}`} className={cn("fade-in flex h-7 items-center gap-2 text-xs", i > 0 && "text-muted-foreground")}>
            <span className={cn("w-[128px] shrink-0 truncate", i === 0 && "font-medium")}>{r.from ?? r.threadId}</span>
            <span className="min-w-0 flex-1 truncate">{r.subject ?? ""}</span>
            <ArrowRight className="size-3 shrink-0 text-muted-foreground/70" />
            <Chip>{LANE_LABEL[r.lane]}</Chip>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-11 text-muted-foreground">{done ? "Lanes update live as new mail arrives." : "You can open the inbox now. Sorting keeps going in the background."}</span>
        <Button variant="primary" onClick={() => void openInbox()} loading={opening} trailing={<ArrowRight className="size-3.5" />}>Open your inbox</Button>
      </div>
    </div>
  );
}

const priorityLabel = (w: number) => (w >= 8 ? "High" : w >= 5 ? "Medium" : "Low");
