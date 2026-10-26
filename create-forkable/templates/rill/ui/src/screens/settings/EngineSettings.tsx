import { useEffect, useState } from "react";
import type { EngineOption } from "@rill/core/api-types";
import type { WriterEngine } from "@rill/core/types";
import { useMailboxId } from "@/lib/mailbox";
import { useEngines, useSettings, useSettingsMutation } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { SectionTitle } from "./SettingsLayout";

const GROUPS: { key: WriterEngine; title: string; hint: string }[] = [
  { key: "local", title: "On this machine", hint: "Runs the agent you already have. Tool-less, so an email cannot make it do anything." },
  { key: "one", title: "Through One", hint: "Runs on your One grant. Every call lands in the same ledger as Gmail." },
  { key: "connect", title: "Your own model", hint: "Connect your account like you connected Gmail. Revoke any time." },
];

const STATUS: Record<EngineOption["status"], { label: string; tone: BadgeTone }> = {
  ready: { label: "Signed in", tone: "success" },
  signed_out: { label: "Not signed in", tone: "warning" },
  missing: { label: "Not installed", tone: "neutral" },
  available: { label: "Available", tone: "neutral" },
  unavailable: { label: "Unavailable", tone: "neutral" },
};

/** Map an option id to the settings triple the server stores. */
function toSettings(o: EngineOption): { writerEngine: WriterEngine; writerProvider: string; writerModel: string | null } {
  const provider = o.group === "local" ? o.id : o.id.replace(/^one-/, "").replace(/^connect-own$/, "anthropic");
  return { writerEngine: o.group, writerProvider: provider, writerModel: o.model ?? null };
}

export function EngineSettings() {
  const mailboxId = useMailboxId();
  const eng = useEngines();
  const settings = useSettings(mailboxId);
  const save = useSettingsMutation(mailboxId);
  const [picked, setPicked] = useState<string | null>(null);
  const options = eng.data?.options ?? [];
  const current = options.find((o) => {
    const s = settings.data; if (!s) return false;
    const t = toSettings(o);
    return t.writerEngine === s.writerEngine && t.writerProvider === s.writerProvider;
  });
  useEffect(() => { if (current && picked === null) setPicked(current.id); }, [current, picked]);
  const chosen = options.find((o) => o.id === picked);
  const dirty = !!chosen && chosen.id !== current?.id;

  const use = () => {
    if (!chosen) return;
    save.mutate(toSettings(chosen), { onSuccess: () => toast({ title: `Drafts now written by ${chosen.name}` }) });
  };

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle title="Who writes your drafts" hint="Jev still judges every email. Same prompts and the same validator on every engine. Only the transport changes." />
      {eng.isPending && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">Looking for installed agents and checking who is signed in.</p>
          <ListSkeleton rows={3} />
        </div>
      )}
      {GROUPS.map((g) => {
        const opts = options.filter((o) => o.group === g.key);
        if (!opts.length) return null;
        if (g.key === "local" && eng.data && !eng.data.local) return null;
        return (
          <section key={g.key} className="flex flex-col gap-2" aria-label={g.title}>
            <div>
              <h3 className="text-13 font-semibold">{g.title}</h3>
              <p className="text-xs text-muted-foreground">{g.hint}</p>
            </div>
            <div role="radiogroup" className="overflow-hidden rounded-lg border border-border bg-card">
              {opts.map((o) => {
                const usable = o.status === "ready" || o.status === "available";
                const on = picked === o.id;
                return (
                  <button
                    key={o.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={!usable}
                    onClick={() => setPicked(o.id)}
                    className={cn("flex w-full items-center gap-3 border-b border-border px-3 py-2.5 text-left transition-colors last:border-b-0", usable ? "hover:bg-faint" : "opacity-55", on && "bg-muted/60 hover:bg-muted/60")}
                  >
                    <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors", on ? "border-foreground" : "border-border-strong")} aria-hidden>
                      {on && <span className="size-2 rounded-full bg-foreground" />}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-center gap-1.5">
                        <span className="text-13 font-medium">{o.name}</span>
                        <Badge tone={STATUS[o.status].tone}>{STATUS[o.status].label}</Badge>
                        {current?.id === o.id && <Badge tone="outline">In use</Badge>}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">{o.detail}</span>
                      {o.install && <span className="truncate font-mono text-11 text-muted-foreground">{o.install}</span>}
                    </span>
                    <span className="shrink-0 text-11 text-muted-foreground">{o.cost}</span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
      <div className="flex items-center justify-between gap-3">
        <span className="text-11 text-muted-foreground">Drafts are never sent without you.</span>
        <Button variant="primary" size="sm" disabled={!dirty} loading={save.isPending} onClick={use}>Use this</Button>
      </div>
    </div>
  );
}
