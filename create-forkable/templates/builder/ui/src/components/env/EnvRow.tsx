// One app value: its name, where the code reads it, set or missing and
// where it is stored, with Set, Replace and Remove. Setting opens the
// secure input in place. The value goes to the local server once and the
// field is cleared; nothing ever shows it again.

import { useEffect, useRef, useState } from "react";
import { FileCode2, KeyRound, Lock, Plus } from "lucide-react";
import type { ProjectEnvVar } from "@builder/core/api-types";
import { validateAppName, validateAppValue } from "@builder/core/envvars";
import { fieldErrors, humanError } from "@/lib/api";
import { useRemoveProjectEnv, useSaveProjectEnv } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { cn, fmtAgo } from "@/lib/utils";
import { Badge, Button, ConfirmButton, Input } from "@/components/ui";
import { SecretInput } from "./SecretInput";

export function TargetChip({ target }: { target: ProjectEnvVar["target"] }) {
  return <Badge tone="outline">{target === "publish" ? "Published app" : "Preview and published"}</Badge>;
}

/** The secure editor for one value: input, Save, Cancel. */
function Editor({ projectId, name, secret, onDone, autoFocus = true }: { projectId: string; name: string; secret: boolean; onDone: () => void; autoFocus?: boolean }) {
  const [value, setValue] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const save = useSaveProjectEnv(projectId);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);
  const check = value.trim() ? validateAppValue(name, value) : null;
  const submit = () => {
    if (!value.trim() || check?.level === "error") return setErr(check?.message ?? "Paste the value first.");
    save.mutate({ [name]: value }, {
      onSuccess: () => {
        setValue("");
        setErr(null);
        toast({ title: `${name} saved`, detail: "The preview restarts with it." });
        onDone();
      },
      onError: (e) => setErr(fieldErrors(e)[name] ?? humanError(e)),
    });
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <div className="min-w-0 flex-1">
          <SecretInput
            ref={ref}
            value={value}
            onChange={(v) => { setValue(v); setErr(null); }}
            secret={secret}
            check={check}
            placeholder={`Paste ${name}`}
            aria-label={`Value for ${name}`}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); submit(); }
              if (e.key === "Escape") { e.stopPropagation(); onDone(); }
            }}
          />
        </div>
        <Button size="sm" variant="primary" loading={save.isPending} onClick={submit}>Save</Button>
        <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
      {(err || (check && check.level !== "ok" && check.message)) && (
        <p className={cn("text-11", err || check?.level === "error" ? "text-destructive-text" : "text-warning-text")} role={err ? "alert" : undefined}>{err ?? check?.message}</p>
      )}
    </div>
  );
}

export function EnvRow({ projectId, v, onOpenFile, defaultOpen = false, compact = false }: {
  projectId: string;
  v: ProjectEnvVar;
  onOpenFile?: (path: string, line: number) => void;
  defaultOpen?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen && !v.present);
  const remove = useRemoveProjectEnv(projectId);
  return (
    <div className={cn("flex flex-col gap-2 border-b border-border last:border-b-0", compact ? "px-2.5 py-2" : "px-3 py-2.5")} data-testid={`env-row-${v.name}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <KeyRound className="size-3.5 shrink-0 stroke-[1.75] text-muted-foreground" />
        <span className="font-mono text-xs font-medium">{v.name}</span>
        {!compact && <TargetChip target={v.target} />}
        {v.client && <Badge tone="warning">In the page</Badge>}
        <span className="ml-auto flex items-center gap-1.5">
          {v.present ? (
            <span className="flex items-center gap-1.5 text-11 text-muted-foreground">
              <Lock className="size-3 text-success-text" />
              <span className="text-foreground">Set</span>
              {v.hint && <span className="font-mono">{v.hint}</span>}
              <span>· {v.whereLabel}{v.updatedAt ? ` · ${fmtAgo(v.updatedAt)}` : ""}</span>
            </span>
          ) : (
            <Badge tone={v.needed ? "warning" : "outline"}>{v.needed ? "Missing" : "Not set"}</Badge>
          )}
          {!open && (
            v.present ? (
              <>
                <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Replace</Button>
                <ConfirmButton size="sm" variant="ghost" confirmLabel="Remove it" loading={remove.isPending} onConfirm={() => remove.mutate(v.name, { onError: (e) => toast({ title: "Could not remove it", detail: humanError(e), tone: "destructive" }) })}>Remove</ConfirmButton>
              </>
            ) : (
              <Button size="sm" variant={v.needed ? "primary" : "default"} onClick={() => setOpen(true)}>Set</Button>
            )
          )}
        </span>
      </div>
      {(v.why || v.sites.length > 0) && !compact && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-5 text-11 text-muted-foreground">
          {v.why && <span>{v.why}</span>}
          {v.sites.map((s) => (
            <button key={`${s.file}:${s.line}`} type="button" disabled={!onOpenFile} onClick={() => onOpenFile?.(s.file, s.line)} className="inline-flex items-center gap-0.5 rounded-sm px-1 font-mono text-foreground/80 enabled:hover:bg-muted enabled:hover:underline">
              <FileCode2 className="size-3" />{s.file}:{s.line}
            </button>
          ))}
        </div>
      )}
      {open && <div className={compact ? "" : "pl-5"}><Editor projectId={projectId} name={v.name} secret={v.secret} onDone={() => setOpen(false)} /></div>}
    </div>
  );
}

/** Add a value the code does not read yet (or the agent will add next). */
export function AddEnvRow({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const check = name ? validateAppName(name) : null;
  if (!open) {
    return (
      <div className="px-3 py-2">
        <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => setOpen(true)}>Add a variable</Button>
      </div>
    );
  }
  if (picked) {
    return (
      <div className="flex flex-col gap-1.5 px-3 py-2.5">
        <p className="font-mono text-xs font-medium">{picked}</p>
        <Editor projectId={projectId} name={picked} secret onDone={() => { setPicked(null); setName(""); setOpen(false); }} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5 px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && check?.level === "ok") setPicked(name);
            if (e.key === "Escape") { e.stopPropagation(); setOpen(false); }
          }}
          placeholder="NAME, for example STRIPE_WEBHOOK_SECRET"
          mono
          spellCheck={false}
          aria-label="Variable name"
          className="flex-1"
        />
        <Button size="sm" variant="primary" disabled={check?.level !== "ok"} onClick={() => setPicked(name)}>Next</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
      {check && check.level === "error" && <p className="text-11 text-destructive-text">{check.message}</p>}
    </div>
  );
}
