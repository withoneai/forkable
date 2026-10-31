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

const NAMES: Record<EngineChoice, string> = { auto: "Auto", "claude-code": "Claude Code", codex: "Codex", one: "Models through One" };

/** Keeps a saved value the list no longer has, so the select never lies. */
const withValue = (list: { value: string; label: string }[], v: string) => (list.some((m) => m.value === v) ? list : [{ value: v, label: v }, ...list]);

function autoDetail(e: EngineStatus): string {
  const now = e.choice === "auto" || e.effective === "auto" ? (e.local ? `Now: ${e.local.name}.` : "Now: models through One, nothing found here.") : "";
  return `Claude Code, else Codex, else models through One. ${now}`.trim();
}

function EngineChoiceCard({ engine, onPick, saving }: { engine: EngineStatus; onPick: (c: EngineChoice) => void; saving: boolean }) {
  const cli = (id: "claude-code" | "codex") => engine.clis.find((c) => c.id === id);
  const rows: { key: EngineChoice; detail: string; disabled: string | null; badge?: string }[] = engine.hosted
    ? [{ key: "one", detail: "Anthropic on your grant. This server is hosted, so there is no local agent to run.", disabled: null }]
    : [
      { key: "auto", detail: autoDetail(engine), disabled: null },
      ...(["claude-code", "codex"] as const).map((id) => {
        const c = cli(id);
        const detail = c?.installed ? `Found at ${c.path}${c.signedIn ? ", signed in" : ""}. Your own subscription, no tools.` : "Not found on this computer.";
        return { key: id as EngineChoice, detail, disabled: c?.ready ? null : (c?.reason ?? "Not installed") };
      }),
      { key: "one", detail: "Anthropic on your grant. Every call shows in Access, Activity.", disabled: null },
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
      {!engine.hosted && engine.reason === "unavailable" && <p className="text-xs text-warning-text">{NAMES[engine.effective]} is not ready, so models through One answer until it is.</p>}
      {!engine.hosted && <p className="text-xs text-muted-foreground">If the local agent fails, that turn tries models through One on your grant. Both calls show in Access, Activity.</p>}
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
    const label = kind === "chat" ? "Chat model" : "Proposal model";
    if (runs === "claude-code") {
      const key = kind === "chat" ? "localChatModel" : "localProposalModel";
      return <Select label={label} value={s[key]} options={withValue(cli?.models ?? [{ value: "default", label: "Claude Code default" }], s[key])} onChange={(v) => put({ [key]: v })} />;
    }
    if (runs === "codex") return <Select label={label} value="default" options={[{ value: "default", label: "Codex default" }]} onChange={() => {}} />;
    const key = kind === "chat" ? "chatModel" : "proposalModel";
    return <Select label={label} value={s[key]} options={withValue(CHAT_MODELS, s[key])} onChange={(v) => put({ [key]: v })} />;
  };
  const where = runs === "one" ? "through One on your grant" : `on ${engine?.local?.name} on this computer`;

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <SectionTitle title="AI engine" hint="Who writes chat answers, the answer strip and New profile proposals. Jev judgments (lanes, matches, reranking) and embeddings always run through One on your grant; they are not writing.">
          {engine && !engine.hosted && <Button size="sm" loading={checking} onClick={checkAgain}>Check again</Button>}
        </SectionTitle>
        {engineQ.isError ? <LoadError what="The engine" error={engineQ.error} onRetry={() => void engineQ.refetch()} retrying={engineQ.isFetching} className="rounded-lg border border-border bg-card py-6" />
          : !engine ? <Skeleton className="h-40 w-full rounded-lg" />
          : <EngineChoiceCard engine={engine} saving={save.isPending} onPick={(c) => put({ engine: c })} />}
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle title="Models" hint={`These run ${where}.${runs !== "one" ? ` A failed local turn falls back to ${fallback} through One.` : ""}`} />
        <SettingsCard>
          <SettingRow label="Chat and answers" hint={runs === "codex" ? "Codex picks its own model." : "Writes answers in the dock and the answer strip, citing only what Search found."}>
            {modelSelect("chat")}
          </SettingRow>
          <SettingRow label="New profile proposals" hint={runs === "codex" ? "Codex picks its own model." : "Proposes the field map when you add a platform. Without a model, rules suggest one instead."}>
            {modelSelect("proposal")}
          </SettingRow>
          <SettingRow label="Judgments" hint="Lanes, matches and reranking. Jev, through One on your grant.">
            <span className="font-mono text-xs text-muted-foreground">{s.jevModel}</span>
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
