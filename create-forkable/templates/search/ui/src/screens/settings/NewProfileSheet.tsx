// The New profile flow (SPEC 10, search-ux-mobbin.md 2.9): a full-screen sheet
// over the app in two steps. Source picks the platform and its models (the AI
// maps them); Check shows sample records as results, anything to fix in plain
// words, and the few choices, with the field map and the identity behind
// "Edit fields" and "Advanced". A new integration is a profile, never code, and
// saving starts indexing on the user's grant. The primary button only ever says
// what it does; problems show next to the control that fixes them.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, ChevronRight, Sparkles, X } from "lucide-react";
import type { ProfileDraft, SearchProfile, ValidationReport } from "@/contract/api-types";
import { api, ApiError, type CatalogRow } from "@/lib/api";
import { useServerEvent } from "@/lib/events";
import { useKeys } from "@/lib/keys";
import { keys, useCatalog } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { cn, MOD } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Kbd } from "@/components/ui/Kbd";
import { Tabs } from "@/components/ui/Tabs";
import { PlatformStep, type DraftStage } from "@/components/profile/PlatformStep";
import { defaultPicks, ModelsStep } from "@/components/profile/ModelsStep";
import { FieldsStep } from "@/components/profile/FieldsStep";
import { CheckStep, type Section } from "@/components/profile/CheckStep";
import { FinishStep } from "@/components/profile/FinishStep";
import { AdvancedFields, SCHEDULES, type Identity } from "@/components/profile/IdentityStep";
import { humanizeIssue, leafPaths, missingTargets, rowsFromProposal, rowsToPatch, targetLabel, type MapRow, type PlainIssue, type Target } from "@/components/profile/fieldmap";
import { onControl } from "@/components/profile/keys";
import { applyMapOps, describeOp, MappingAssistant, type AssistMessage, type AssistOp } from "@/components/profile/MappingAssistant";

const STEPS = ["Source", "Check", "Connect"] as const;
// server checks that are context, not something to fix
const QUIET = new Set(["fetch", "actions", "hashes", "pagination", "size", "incremental", "schema-ok"]);

export function NewProfileSheet({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState<CatalogRow | null>(null);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [creating, setCreating] = useState(false);
  const [stages, setStages] = useState<DraftStage[]>([]);
  const [rows, setRows] = useState<Record<string, MapRow[]>>({});
  const [identity, setIdentity] = useState<Record<string, Identity>>({});
  const [active, setActive] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [version, setVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [, setReproposing] = useState(false);
  const [picks, setPicks] = useState<string[]>([]);
  // the accounts this profile indexes (two Gmails): all of them unless the user unticks one
  const [accountKeys, setAccountKeys] = useState<string[]>([]);
  // saved, but the grant does not cover it yet: the Connect step finishes it in this sheet
  const [finish, setFinish] = useState<{ sourceIds: string[]; needsAppUpdate: boolean } | null>(null);
  const [mapping, setMapping] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const creatingRef = useRef(false);
  const mappingRef = useRef(false);
  // the mapping assistant: closed until asked (Assistant, Cmd+J, or Ask AI to fix); one Undo snapshot per applied message
  const [assistOpen, setAssistOpen] = useState(false);
  const [sections, setSections] = useState<Record<Section, boolean>>({ fields: false, advanced: false });
  const [assistMsgs, setAssistMsgs] = useState<AssistMessage[]>([]);
  const [assistBusy, setAssistBusy] = useState(false);
  const undoSnaps = useRef(new Map<number, { rows: Record<string, MapRow[]>; identity: Record<string, Identity>; selected: string[]; name: string }>());
  const msgId = useRef(0);

  // ?platform=zendesk preselects (from "Available in your grant").
  const all = useCatalog("");
  const preselected = useRef(false);
  useEffect(() => {
    const want = params.get("platform");
    if (preselected.current || !want || !all.data) return;
    const row = all.data.platforms.find((p) => p.platform === want);
    if (row) { preselected.current = true; setPicked(row); }
  }, [all.data, params]);

  useServerEvent((e) => {
    if (e.type === "draft" && (creatingRef.current || mappingRef.current)) setStages((s) => [...s.filter((x) => x.stage !== e.stage), { stage: e.stage, message: e.message }]);
  });

  const selected = draft?.edits.selected ?? [];
  const models = draft?.proposal?.models ?? [];
  const modelOf = (pid: string) => models.find((m) => m.profile.id === pid);
  const samplesOf = (pid: string): unknown[] => { const m = modelOf(pid); return m ? draft?.samples[m.profile.list.actionId]?.sample ?? [] : []; };
  const pid = active && selected.includes(active) ? active : selected[0] ?? null;

  const initFromDraft = (d: ProfileDraft) => {
    const r: Record<string, MapRow[]> = {};
    const id: Record<string, Identity> = {};
    for (const m of d.proposal?.models ?? []) {
      const sample = d.samples[m.profile.list.actionId]?.sample[0];
      r[m.profile.id] = rowsFromProposal(m, sample);
      const inc = m.profile.incremental;
      id[m.profile.id] = {
        idPath: m.profile.list.idPath, urlTemplate: m.profile.fields.url ?? "", titleTemplate: "",
        every: typeof m.profile.schedule?.every === "string" && SCHEDULES.some((s) => s.key === m.profile.schedule!.every) ? m.profile.schedule.every : "15m",
        cron: "", backfill: "365d", incremental: inc.strategy === "watermark" ? inc.field : null,
      };
    }
    setRows(r);
    setIdentity(id);
    setName(d.proposal?.models.filter((m) => d.edits.selected.includes(m.profile.id)).length === 1 ? d.proposal!.models.find((m) => d.edits.selected.includes(m.profile.id))!.profile.title : `${picked?.name ?? d.platform}`);
  };

  // Every edit goes to the draft (debounced), then the preview and the checks refresh.
  const patchFor = (p: string): Partial<SearchProfile> | null => {
    const m = modelOf(p);
    const r = rows[p];
    const id = identity[p];
    if (!m || !r || !id) return null;
    const base = rowsToPatch(r, m.profile, { urlTemplate: id.urlTemplate || undefined, titleTemplate: id.titleTemplate || undefined });
    return { ...base, schedule: { every: id.every === "custom" ? "15m" : id.every }, incremental: m.profile.incremental.strategy === "watermark" ? { ...m.profile.incremental, initial: id.backfill } : m.profile.incremental };
  };
  const editsKey = JSON.stringify([rows, identity, selected]);
  useEffect(() => {
    if (!draft || step < 1) return;
    const t = setTimeout(async () => {
      const profiles = Object.fromEntries(selected.map((p) => [p, patchFor(p)]).filter(([, v]) => v));
      try {
        await api.patchDraft(draft.id, { edits: { selected, profiles } });
        setVersion((v) => v + 1);
        // the checks always read the map just saved, never an older one
        await runValidate();
      } catch (e) { toast({ title: "Could not save the change", detail: (e as Error).message, tone: "destructive" }); }
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editsKey, step, draft?.id]);

  const preview = useQuery({
    queryKey: ["draft-preview", draft?.id, pid, version],
    queryFn: () => api.previewDraft(draft!.id, pid!),
    enabled: !!draft && !!pid && step === 1 && version > 0,
    placeholderData: (prev) => prev,
  });

  const runValidate = async () => {
    if (!draft) return;
    setChecking(true);
    try { setReport(await api.validateDraft(draft.id)); } catch (e) { toast({ title: "Checks did not run", detail: (e as Error).message, tone: "destructive" }); }
    finally { setChecking(false); }
  };

  const create = async () => {
    if (!picked) return;
    if (draft && draft.platform === picked.platform) return;
    creatingRef.current = true;
    setCreating(true);
    setStages([]);
    try {
      // not in the grant yet is fine: it is set up from the docs, and Save adds
      // the exact actions the chosen models call to the Connect app's ask
      const d = await api.createDraft({ platform: picked.platform });
      setDraft(d);
      setPicks(defaultPicks(d));
      setAccountKeys(d.accounts.map((a) => a.key));
      initFromDraft(d);
    } catch (e) {
      toast({ title: `Could not read ${picked.name}`, detail: (e as Error).message, tone: "destructive" });
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  };

  const setSelected = async (next: string[]) => {
    if (!draft) return;
    setDraft({ ...draft, edits: { ...draft.edits, selected: next } });
    try { setDraft(await api.patchDraft(draft.id, { edits: { selected: next, profiles: {} } })); } catch { /* the debounced patch retries */ }
  };

  const askAssistant = async (text: string) => {
    if (!draft) return;
    const user: AssistMessage = { id: ++msgId.current, role: "user", text };
    const history = assistMsgs.filter((m) => !m.error).map((m) => ({ role: m.role, text: m.changes?.length ? `${m.text}\n(Changed: ${m.changes.join("; ")}${m.undone ? ", then undone" : ""})` : m.text }));
    setAssistMsgs((all) => [...all, user]);
    setAssistBusy(true);
    try {
      const res = await api.assistDraft(draft.id, {
        message: text, history,
        state: { step: STEPS[step], active: pid, selected, name, rows: Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v.map((r) => ({ path: r.path, target: r.target }))])), identity },
      });
      const ops = res.ops as AssistOp[];
      const id = ++msgId.current;
      const reprop = ops.find((o): o is Extract<AssistOp, { op: "repropose" }> => o.op === "repropose");
      if (ops.length && !reprop) {
        undoSnaps.current.clear();
        undoSnaps.current.set(id, { rows, identity, selected, name });
        setAssistMsgs((all) => all.map((m) => ({ ...m, undoable: false })));
        const next = applyMapOps(rows, identity, ops);
        setRows(next.rows);
        setIdentity(next.identity);
        let sel = selected;
        for (const o of ops) {
          if (o.op === "select" && !sel.includes(o.model)) sel = [...sel, o.model];
          if (o.op === "unselect") sel = sel.filter((x) => x !== o.model);
          if (o.op === "name") setName(o.value);
        }
        if (sel !== selected) await setSelected(sel);
      }
      setAssistMsgs((all) => [...all, { id, role: "assistant", text: res.reply, changes: ops.map((o) => describeOp(o, (m) => modelOf(m)?.profile.title ?? m)).filter(Boolean), undoable: ops.length > 0 && !reprop }]);
      if (reprop) {
        setReproposing(true);
        try { const d = await api.repropose(draft.id, reprop.hint); setDraft(d); initFromDraft(d); }
        catch (e) { toast({ title: "Could not propose again", detail: (e as Error).message, tone: "destructive" }); }
        finally { setReproposing(false); }
      }
    } catch (e) {
      setAssistMsgs((all) => [...all, { id: ++msgId.current, role: "assistant", text: (e as Error).message, error: true }]);
    } finally { setAssistBusy(false); }
  };

  const undoAssistant = async (id: number) => {
    const snap = undoSnaps.current.get(id);
    if (!snap) return;
    undoSnaps.current.delete(id);
    setRows(snap.rows);
    setIdentity(snap.identity);
    setName(snap.name);
    if (snap.selected.join("|") !== selected.join("|")) await setSelected(snap.selected);
    setAssistMsgs((all) => all.map((m) => (m.id === id ? { ...m, undone: true, undoable: false } : m)));
    toast({ title: "Undone" });
  };

  // the picks already mapped: Continue goes on, any change maps again
  const mappedPicks = !!draft?.proposal && [...picks].sort().join("|") === [...(draft?.picked ?? [])].sort().join("|");
  const mapPicks = async () => {
    if (!draft || !picks.length) return;
    mappingRef.current = true;
    setMapping(true);
    setStages([]);
    try {
      const d = await api.pickModels(draft.id, picks);
      setDraft(d);
      initFromDraft(d);
      const got = d.proposal?.models.length ?? 0;
      if (got === picks.length) { setReport(null); setStep(1); }
      else if (got) toast({ title: `Mapped ${got} of ${picks.length}`, detail: "The others say why. Continue with what mapped, or change the picks." });
      else toast({ title: "Nothing mapped", detail: "No picked model returned records Search could read. Try other models.", tone: "destructive" });
    } catch (e) {
      toast({ title: "Could not map the models", detail: (e as Error).message, tone: "destructive" });
    } finally {
      mappingRef.current = false;
      setMapping(false);
    }
  };

  const setTarget = (p: string, path: string, target: Target) => {
    setRows((all) => {
      const list = all[p] ?? [];
      const single = target !== "skip" && target !== "property" && target !== "labels";
      return { ...all, [p]: list.map((r) => r.path === path ? { ...r, target, by: "user" as const } : single && r.target === target ? { ...r, target: "skip" as Target, by: "user" as const } : r) };
    });
    if (target === "id") setIdentity((all) => ({ ...all, [p]: { ...all[p]!, idPath: path } }));
    if (target === "url") setIdentity((all) => ({ ...all, [p]: { ...all[p]!, urlTemplate: `{{ item.${path} }}` } }));
  };
  const resetRows = (p: string) => {
    const m = modelOf(p);
    if (!m || !draft) return;
    setRows((all) => ({ ...all, [p]: rowsFromProposal(m, draft.samples[m.profile.list.actionId]?.sample[0]) }));
    toast({ title: "Back to the AI proposal" });
  };
  const setIdent = (p: string, patch: Partial<Identity>) => {
    setIdentity((all) => ({ ...all, [p]: { ...all[p]!, ...patch } }));
    if (patch.idPath) setTarget(p, patch.idPath, "id");
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      // the actions these models call join the Connect app's ask first (none on the sample)
      const ask = await api.widenAsk(draft.id, selected);
      const res = await api.saveDraft(draft.id, { name: name.trim() || undefined, profiles: selected, ...(draft.accounts.length > 1 ? { connectionKeys: accountKeys } : {}) });
      await qc.invalidateQueries({ queryKey: keys.sources });
      await qc.invalidateQueries({ queryKey: keys.profiles });
      const n = ask.added.length;
      if ((res.awaitingGrant || n) && ask.next !== "sample") {
        // finish here: update the app if its ask changed, grant, watch indexing start
        const setup = await api.connectSetup().catch(() => null);
        setFinish({ sourceIds: res.sourceIds, needsAppUpdate: n > 0 || !!setup?.create.askChanged });
        setStep(2);
        return;
      }
      toast({ title: `Indexing ${picked?.name ?? draft.platform}`, detail: `${res.sourceIds.length} ${res.sourceIds.length === 1 ? "source" : "sources"} created, first run started` });
      nav(`/sources/${res.sourceIds[0]}`);
    } catch (e) {
      const r = e instanceof ApiError ? (e.data as { report?: ValidationReport } | null)?.report : undefined;
      if (r) setReport(r);
      toast({ title: "Not saved", detail: (e as Error).message, tone: "destructive" });
    } finally { setSaving(false); }
  };

  // Anything to fix, per model, in plain words: required fields the map lacks
  // (checked here, before the server ever sees an empty one), then the server's checks.
  const nounOf = (p: string) => (modelOf(p)?.profile.model ?? "record").replace(/-/g, " ").replace(/s$/, "");
  const issuesFor = (p: string): PlainIssue[] => {
    const ctx = { platform: picked?.name ?? draft?.platform ?? "the app", noun: nounOf(p) };
    const out: PlainIssue[] = missingTargets(rows[p] ?? []).map((t) => humanizeIssue({ check: "schema", level: "error", message: `fields.${t === "id" ? "idPath" : t}` }, ctx));
    for (const i of report?.issues ?? []) {
      if (i.level === "ok" || (i.profileId && i.profileId !== p) || (i.level === "warn" && QUIET.has(i.check))) continue;
      const h = humanizeIssue(i, ctx);
      if (!out.some((x) => x.text === h.text || (x.target && x.target === h.target))) out.push(h);
    }
    return out.sort((a, b) => Number(b.level === "error") - Number(a.level === "error"));
  };
  const issues = pid ? issuesFor(pid) : [];
  const blocking = selected.reduce((n, p) => n + issuesFor(p).filter((i) => i.level === "error").length, 0);

  // What the primary does. It never carries an error; the count beside it does.
  const onModels = step === 0 && !!draft && draft.platform === picked?.platform;
  const gate: { label: string; ok: boolean } = useMemo(() => {
    if (step === 0 && !onModels) {
      if (!picked) return { label: "Pick a platform", ok: false };
      if (creating) return { label: `Reading ${picked.name}...`, ok: false };
      return { label: "Continue", ok: true };
    }
    if (step === 2) return { label: "Close", ok: true };
    if (step === 0) {
      if (mapping) return { label: "Mapping...", ok: false };
      if (!picks.length) return { label: "Pick at least one model", ok: false };
      if (mappedPicks && selected.length) return { label: "Continue", ok: true };
      return { label: `Map ${picks.length} ${picks.length === 1 ? "model" : "models"}`, ok: true };
    }
    const label = saving ? "Saving..." : draft && !draft.inGrant ? "Save, then grant it" : "Save and start indexing";
    return { label, ok: !saving && !checking && blocking === 0 && !!report?.ok };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, onModels, picked, creating, selected, rows, report, checking, saving, blocking, picks, mapping, mappedPicks]);

  const next = () => {
    if (!gate.ok) return;
    if (step === 0 && !onModels) void create();
    else if (step === 0 && !mappedPicks) void mapPicks();
    else if (step === 0) setStep(1);
    else if (step === 2) { if (finish) nav(`/sources/${finish.sourceIds[0]}`); else onClose(); }
    else void save();
  };
  const back = () => { if (step === 2) return; if (step === 1) setStep(0); else if (onModels) setDraft(null); };
  const showIssues = () => {
    const firstBad = selected.find((p) => issuesFor(p).some((i) => i.level === "error"));
    if (firstBad && firstBad !== pid) setActive(firstBad);
    document.querySelector('[data-testid="check-issues"]')?.scrollIntoView({ block: "center", behavior: "smooth" });
  };
  const askFix = (text: string) => { setAssistOpen(true); void askAssistant(`Fix this: ${text}`); };
  // once saved there is nothing to discard: closing goes to the source
  const dirty = !!draft && !finish;
  const attemptClose = () => { if (dirty) setConfirmLeave(true); else onClose(); };
  const discard = () => { if (draft) void api.discardDraft(draft.id).catch(() => {}); onClose(); };

  const inAssistant = (e: KeyboardEvent) => !!(e.target as HTMLElement | null)?.closest?.('[data-testid="mapping-assistant"]');
  useKeys({
    escape: (e) => { if (confirmLeave) return false; if (inAssistant(e)) { setAssistOpen(false); return; } attemptClose(); },
    // Enter continues on Source; saving takes Cmd+Enter, and Enter inside the field map picks a field
    enter: (e) => { if (confirmLeave || onControl(e) || step === 1) return false; next(); },
    "mod+enter": (e) => { if (confirmLeave || inAssistant(e)) return false; next(); },
    "mod+j": () => { if (confirmLeave || !draft) return false; setAssistOpen((v) => !v); },
  }, { priority: 20, whileTyping: true });

  const multi = selected.length > 1 && step === 1;
  const calls = pid ? 1 + ((rows[pid] ?? []).some((r) => r.target === "from" || r.target === "assignee") ? 1 : 0) : 1;
  const starters = issues.slice(0, 3).map((i) => `Fix: ${i.text}`);

  return (
    <div role="dialog" aria-modal="true" aria-label="New profile" data-testid="new-profile-sheet" className="fade-in fixed inset-0 z-40 flex flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border px-4">
        <button type="button" aria-label="Close" onClick={attemptClose} className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-card-hover hover:text-foreground"><X className="size-4" /></button>
        <span className="text-13 font-semibold">New profile</span>
        <ol className="mx-auto flex min-w-0 items-center gap-1 overflow-x-auto scrollbar-none" aria-label="Steps">
          {(finish ? STEPS : STEPS.slice(0, 2)).map((s, i) => (
            <li key={s} className="flex shrink-0 items-center gap-1">
              {i > 0 && <ChevronRight className="size-3 text-muted-foreground/60" />}
              <button type="button" disabled={i > step || step === 2} onClick={() => setStep(i)} aria-current={i === step ? "step" : undefined}
                className={cn("flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors", i === step ? "bg-muted text-foreground" : i < step ? "text-foreground hover:bg-card-hover" : "text-muted-foreground/70")}>
                <span className={cn("tnum flex size-4 items-center justify-center rounded-full text-10", i < step ? "bg-foreground text-background" : i === step ? "border border-foreground" : "border border-border-strong")}>
                  {i < step ? <Check className="size-2.5 stroke-[3]" /> : i + 1}
                </span>
                <span className="hidden md:inline">{s}</span>
              </button>
            </li>
          ))}
        </ol>
        <span className="w-[120px] shrink-0 truncate text-right text-11 text-muted-foreground">{picked && (step > 0 || onModels) ? picked.name : ""}</span>
        {draft && !assistOpen && (
          <Button size="sm" icon={<Sparkles />} onClick={() => setAssistOpen(true)} data-testid="assist-open">Assistant</Button>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-[960px] flex-col gap-5 px-6 py-6">
          {(step > 0 || onModels) && (
            <div>
              <h1 className="text-xl font-semibold tracking-tight">{step === 0 ? "Models" : step === 1 ? "Check" : `Connect ${picked?.name ?? draft?.platform}`}</h1>
              <p className="mt-0.5 text-13 text-muted-foreground">
                {step === 0 ? `Pick what to search in ${picked?.name}. Search only reads.` : step === 1 ? `This is what Search will index from ${picked?.name ?? draft?.platform}. The AI set it up; change anything, then save.` : "Saved. Two quick steps and indexing starts."}
              </p>
            </div>
          )}
          {multi && pid && (
            <Tabs size="sm" value={pid} onChange={setActive} options={selected.map((p) => ({ key: p, label: modelOf(p)?.profile.title ?? p, count: issuesFor(p).filter((i) => i.level === "error").length || undefined }))} />
          )}
          {step === 0 && !onModels && <PlatformStep picked={picked} onPick={(p) => { setPicked(p); if (draft && draft.platform !== p.platform) setDraft(null); }} onSubmit={next} creating={creating} stages={stages} />}
          {onModels && draft && <ModelsStep draft={draft} picks={picks} onPicks={setPicks} mapping={mapping} stages={stages} />}
          {step === 2 && finish && (
            <FinishStep platform={picked?.name ?? draft?.platform ?? ""} sourceIds={finish.sourceIds} needsAppUpdate={finish.needsAppUpdate}
              onOpenSource={(id) => nav(`/sources/${id}`)} onLater={() => nav(`/sources/${finish.sourceIds[0]}`)} />
          )}
          {step === 1 && pid && rows[pid] && identity[pid] && (
            <CheckStep
              platform={picked?.name ?? draft?.platform ?? ""} noun={nounOf(pid)}
              preview={preview.data} previewLoading={preview.isFetching}
              issues={issues} checking={checking}
              rows={rows[pid]!} identity={identity[pid]!} onIdent={(p) => setIdent(pid, p)}
              name={name} onName={setName} calls={calls}
              open={sections} onOpen={(k, v) => setSections((all) => ({ ...all, [k]: v }))}
              onAskFix={askFix}
              accounts={draft?.accounts ?? []} chosenAccounts={accountKeys} onAccounts={setAccountKeys}
              fields={<FieldsStep embedded rows={rows[pid]!} samples={samplesOf(pid)} onChange={(path, t) => setTarget(pid, path, t)} onReset={() => resetRows(pid)} preview={preview.data} previewLoading={preview.isFetching} />}
              advanced={<AdvancedFields pid={pid} identity={identity[pid]!} onChange={(p) => setIdent(pid, p)} samples={samplesOf(pid)} paths={leafPaths(samplesOf(pid)[0])} report={report} checking={checking} platform={picked?.name ?? draft?.platform ?? ""} noun={nounOf(pid)} />}
            />
          )}
        </div>
      </div>
      {draft && assistOpen && (
        <div className="fixed inset-y-14 right-0 z-10 w-[360px] max-w-full shadow-pop lg:static lg:z-auto lg:shadow-none">
          <MappingAssistant messages={assistMsgs} busy={assistBusy} onSend={(t) => void askAssistant(t)} onUndo={(id) => void undoAssistant(id)} onClose={() => setAssistOpen(false)} starters={starters} />
        </div>
      )}
      </div>

      <footer className="flex h-14 shrink-0 items-center gap-3 border-t border-border bg-faint px-4">
        <Button variant="ghost" icon={<ArrowLeft />} onClick={back} disabled={(step === 0 && !onModels) || step === 2}>Back</Button>
        <span className="mx-auto hidden text-11 text-muted-foreground md:inline">
          {step === 1 ? <>Press <Kbd>{MOD}</Kbd> <Kbd>↵</Kbd> to save and start</> : <>Press <Kbd>↵</Kbd> to continue</>}
        </span>
        {step === 1 && blocking > 0 && (
          <button type="button" onClick={showIssues} data-testid="to-fix" className="text-xs font-medium text-destructive-text hover:underline">
            {blocking} {blocking === 1 ? "thing" : "things"} to fix
          </button>
        )}
        <Button variant="primary" onClick={next} disabled={!gate.ok} loading={saving || creating || mapping} data-testid="sheet-primary" className="max-w-[420px] truncate">
          {gate.label}
        </Button>
      </footer>

      <Dialog open={confirmLeave} onClose={() => setConfirmLeave(false)} title="Discard this profile?" size="sm">
        <div className="flex flex-col gap-4 p-4">
          <p className="text-13 text-muted-foreground">The draft and your field choices go away. Nothing was indexed yet.</p>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setConfirmLeave(false)}>Keep editing</Button>
            <Button variant="destructive" onClick={discard} data-testid="discard">Discard</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
