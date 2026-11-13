import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { SettingsData } from "@/contract/api-types";
import { api, type EngineChoice, type EngineStatus } from "@/lib/api";
import { keys, useChats, useEngine, useSettings, useSettingsMutation } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { cn, fmtAgo } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { Skeleton } from "@/components/ui/Skeleton";
import { LoadError } from "@/components/ui/EmptyState";
import { SectionTitle, Select, SettingRow, SettingsCard } from "./SettingsLayout";

/** Anthropic models through One on the grant. */
const CHAT_MODELS = [
  { value: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
  { value: "claude-opus-5-5", label: "Claude Opus 5.5" },
  { value: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
];

const NAMES: Record<EngineChoice, string> = { auto: "Auto", "claude-code": "Claude Code", codex: "Codex", one: "Claude through One" };

/** Keeps a saved value the list no longer has, so the select never lies. */
const withValue = (list: { value: string; label: string }[], v: string) => (list.some((m) => m.value === v) ? list : [{ value: v, label: v }, ...list]);

function autoDetail(e: EngineStatus): string {
  const now = e.choice === "auto" || e.effective === "auto" ? (e.local ? `Now: ${e.local.name}.` : "Now: Claude through One, nothing found here.") : "";
  return `Claude Code, else Codex, else Claude through One. ${now}`.trim();
}

/** Where each agent was found, closed by default: a path is for the curious, not the choice. */
function WhereFound({ clis }: { clis: EngineStatus["clis"] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <button type="button" className="self-start text-11 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid="engine-where-toggle">
        {open ? "Hide where they are" : "Where they are on this computer"}
      </button>
      {open && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-faint px-2.5 py-2 text-11" data-copy="advanced" data-testid="engine-where">
          {clis.map((c) => <div key={c.id} className="contents"><dt className="text-muted-foreground">{NAMES[c.id]}</dt><dd className="min-w-0 truncate font-mono" title={c.path ?? ""}>{c.path}</dd></div>)}
        </dl>
      )}
    </div>
  );
}

function EngineChoiceCard({ engine, onPick, saving }: { engine: EngineStatus; onPick: (c: EngineChoice) => void; saving: boolean }) {
  const cli = (id: "claude-code" | "codex") => engine.clis.find((c) => c.id === id);
  const rows: { key: EngineChoice; detail: string; disabled: string | null; badge?: string }[] = engine.hosted
    ? [{ key: "one", detail: "Claude, through your One connection. Search runs online here, so there is no agent on this computer to use.", disabled: null }]
    : [
      { key: "auto", detail: autoDetail(engine), disabled: null },
      ...(["claude-code", "codex"] as const).map((id) => {
        const c = cli(id);
        const detail = c?.installed ? `On this computer${c.signedIn ? ", signed in" : ""}. Your own subscription, no tools.` : "Not found on this computer.";
        return { key: id as EngineChoice, detail, disabled: c?.ready ? null : (c?.reason ?? "Not installed") };
      }),
      { key: "one", detail: "Claude, through your One connection. Every call shows in Access, Activity.", disabled: null },
    ];
  const locked = engine.override !== null;
  return (
    <div className="flex flex-col gap-2">
      <div role="radiogroup" aria-label="AI engine" className="overflow-hidden rounded-lg border border-border bg-card">
        {rows.map((r) => {
          const on = engine.choice === r.key || (engine.hosted && r.key === "one");
          const off = !!r.disabled || locked || saving;
          const running = r.key === "one" ? engine.engine === "one" : r.key === "auto" ? false : engine.local?.id === r.key;
          return (
            <button
              key={r.key}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={off}
              onClick={() => onPick(r.key)}
              className={cn("flex w-full items-center gap-3 border-b border-border px-3 py-2.5 text-left transition-colors last:border-b-0", off ? "cursor-default" : "hover:bg-faint", r.disabled && "opacity-55", on && "bg-muted/60 hover:bg-muted/60")}
            >
              <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-full border", on ? "border-foreground" : "border-border-strong")} aria-hidden>
                {on && <span className="size-2 rounded-full bg-foreground" />}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-center gap-1.5">
                  <span className="text-13 font-medium">{NAMES[r.key]}</span>
                  {r.disabled && <Badge tone={/signed in/i.test(r.disabled) ? "warning" : "neutral"}>{r.disabled}</Badge>}
                  {running && <Badge tone="outline">In use</Badge>}
                </span>
                <span className="truncate text-xs text-muted-foreground">{r.detail}</span>
              </span>
            </button>
          );
        })}
      </div>
      {locked && <p className="text-xs text-muted-foreground">SEARCH_LOCAL_ENGINE is set on the server, so it decides ({NAMES[engine.override!]}). Unset it to choose here.</p>}
      {!engine.hosted && engine.reason === "unavailable" && <p className="text-xs text-warning-text">{NAMES[engine.effective]} is not ready, so Claude through One answers until it is.</p>}
      {!engine.hosted && <p className="text-xs text-muted-foreground">If the agent on this computer fails, that turn goes to Claude through One. Both calls show in Access, Activity.</p>}
      {!engine.hosted && engine.clis.some((c) => c.installed) && <WhereFound clis={engine.clis.filter((c) => c.installed)} />}
    </div>
  );
}

export function AssistantSettings() {
  const q = useSettings();
  const save = useSettingsMutation();
  const chats = useChats();
  const engineQ = useEngine();
  const engine = engineQ.data;
  const qc = useQueryClient();
  const [checking, setChecking] = useState(false);
  const s = q.data;
  const put = (patch: Partial<SettingsData>) => save.mutate(patch, { onSuccess: () => toast({ title: "Saved" }), onError: (e) => toast({ title: "Did not save", detail: e.message, tone: "destructive" }) });
  const checkAgain = () => {
    setChecking(true);
    api.redetectEngine()
      .then((e) => qc.setQueryData(keys.engine, e))
      .catch((e: Error) => toast({ title: "Could not check", detail: e.message, tone: "destructive" }))
      .finally(() => setChecking(false));
  };

  if (q.isError) return <LoadError what="Assistant settings" error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} className="rounded-lg border border-border bg-card" />;
  if (!s) return <Skeleton className="h-60 w-full rounded-lg" />;

  const runs = engine?.local?.id ?? "one";
  const cli = engine?.clis.find((c) => c.id === runs);
  const fallback = CHAT_MODELS.find((m) => m.value === s.chatModel)?.label ?? s.chatModel;
  const modelSelect = (kind: "chat" | "proposal") => {
    const label = kind === "chat" ? "Chat AI model" : "Setup AI model";
    if (runs === "claude-code") {
      const key = kind === "chat" ? "localChatModel" : "localProposalModel";
      return <Select label={label} value={s[key]} options={withValue(cli?.models ?? [{ value: "default", label: "Claude Code default" }], s[key])} onChange={(v) => put({ [key]: v })} />;
    }
    if (runs === "codex") return <Select label={label} value="default" options={[{ value: "default", label: "Codex default" }]} onChange={() => {}} />;
    const key = kind === "chat" ? "chatModel" : "proposalModel";
    return <Select label={label} value={s[key]} options={withValue(CHAT_MODELS, s[key])} onChange={(v) => put({ [key]: v })} />;
  };
  const where = runs === "one" ? "through One" : `on ${engine?.local?.name} on this computer`;

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <SectionTitle title="AI engine" hint="Who writes chat answers, the answer strip and the setup of a new source. Jev sorts by priority, matches people and orders results, and search by meaning always runs through One. Neither one writes.">
          {engine && !engine.hosted && <Button size="sm" loading={checking} onClick={checkAgain}>Check again</Button>}
        </SectionTitle>
        {engineQ.isError ? <LoadError what="The engine" error={engineQ.error} onRetry={() => void engineQ.refetch()} retrying={engineQ.isFetching} className="rounded-lg border border-border bg-card py-6" />
          : !engine ? <Skeleton className="h-40 w-full rounded-lg" />
          : <EngineChoiceCard engine={engine} saving={save.isPending} onPick={(c) => put({ engine: c })} />}
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle title="AI models" hint={`These run ${where}.${runs !== "one" ? ` A failed local turn falls back to ${fallback} through One.` : ""}`} />
        <SettingsCard>
          <SettingRow label="Chat and answers" hint={runs === "codex" ? "Codex picks its own AI model." : "Writes answers in the dock and the answer strip, citing only what Search found."}>
            {modelSelect("chat")}
          </SettingRow>
          <SettingRow label="New source setup" hint={runs === "codex" ? "Codex picks its own AI model." : "Suggests which fields to read when you add a source. Without an AI model, simple rules suggest them."}>
            {modelSelect("proposal")}
          </SettingRow>
          <SettingRow label="Judgments" hint="Priority, spotting the same person, and result order. Runs through One.">
            <span className="text-xs text-muted-foreground" title={`AI model: ${s.jevModel}`}>Jev, latest</span>
          </SettingRow>
        </SettingsCard>
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle title="Chat history" hint="Kept in your own database. Deleting a chat removes it here only." />
        {chats.isError ? <LoadError what="Chats" error={chats.error} onRetry={() => void chats.refetch()} retrying={chats.isFetching} className="rounded-lg border border-border bg-card py-8" />
          : !chats.data ? <Skeleton className="h-24 w-full rounded-lg" />
          : chats.data.length === 0 ? <p className="rounded-lg border border-dashed border-border-strong p-4 text-13 text-muted-foreground">No chats yet. Press ⌘J to ask about your results.</p>
          : (
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              {chats.data.map((c) => (
                <div key={c.id} className="flex h-11 items-center gap-3 border-b border-border px-3 last:border-b-0">
                  <span className="min-w-0 flex-1 truncate text-13">{c.title}</span>
                  <span className="text-11 text-muted-foreground">{fmtAgo(c.updatedAt)}</span>
                  <ConfirmButton size="sm" variant="ghost" confirmLabel="Delete it" onConfirm={() => void api.deleteChat(c.id).then(() => qc.invalidateQueries({ queryKey: keys.chats })).catch((e: Error) => toast({ title: "Could not delete it", detail: e.message, tone: "destructive" }))}>Delete</ConfirmButton>
                </div>
              ))}
            </div>
          )}
      </section>
    </div>
  );
}
