import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { EngineOption, EnginesResponse, ModelOption } from "@rill/core/api-types";
import type { WriterEngine } from "@rill/core/types";
import { cn } from "@/lib/utils";

// Two siblings in the composer toolbar, the way Clockwork does it: the agent
// picker says who answers (a CLI on this machine, or a provider through One),
// the model picker beside it follows that agent's own catalog. A choice of
// `null` means "the default writer", and an empty model means the agent's
// default model.

export interface EngineChoice { engine: WriterEngine; provider: string; model: string }

const GROUP_LABEL: Record<"local" | "one", string> = { local: "On this machine", one: "Through One" };

export function optionIdFor(engine: WriterEngine, provider: string): string {
  return engine === "local" ? provider : `one-${provider}`;
}
function choiceFor(o: EngineOption, model = ""): EngineChoice {
  return o.group === "local" ? { engine: "local", provider: o.id, model } : { engine: "one", provider: o.id.replace(/^one-/, ""), model };
}
const usable = (o: EngineOption) => o.status === "ready" || o.status === "available";

/** The engine that answers the next message: the pinned one, else the server's current default. */
export function effectiveEngine(value: EngineChoice | null, options: EngineOption[], current: EnginesResponse["current"]): EngineOption | null {
  const id = value ? optionIdFor(value.engine, value.provider) : current ? optionIdFor(current.engine, current.provider) : null;
  return id ? options.find((o) => o.id === id) ?? null : null;
}

function modelLabel(models: ModelOption[] | undefined, id: string | undefined): string {
  if (!id) return "Default";
  const hit = models?.find((m) => m.id === id) ?? models?.find((m) => m.id.includes(id));
  return hit?.label ?? id;
}

function Dropdown({ label, ariaLabel, disabled, width = 260, align = "start", children }: { label: ReactNode; ariaLabel: string; disabled?: boolean; width?: number; align?: "start" | "end"; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey, true); };
  }, [open]);
  return (
    <div ref={ref} className="relative inline-flex min-w-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-6 min-w-0 items-center gap-1 rounded-md px-1.5 text-11 font-medium text-muted-foreground transition-colors hover:bg-card-hover hover:text-foreground disabled:opacity-50"
      >
        <span className="max-w-[130px] truncate">{label}</span>
        <ChevronDown className="size-3 shrink-0" />
      </button>
      {open && (
        <div role="menu" style={{ width }} className={cn("pop-in absolute bottom-full z-40 mb-1 max-h-[300px] overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-pop", align === "end" ? "right-0" : "left-0")}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function Item({ selected, disabled, onPick, title, children, hint }: { selected?: boolean; disabled?: boolean; onPick: () => void; title?: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      title={title}
      onClick={onPick}
      className={cn(
        "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-xs",
        selected ? "bg-muted font-medium" : disabled ? "cursor-default opacity-45" : "hover:bg-card-hover",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="shrink-0 truncate text-11 text-muted-foreground">{hint}</span>}
      {selected && <Check className="size-3 shrink-0" />}
    </button>
  );
}

/** Who answers: grouped by transport, disabled rows carry their reason, the first row is the server's default. */
export function AgentPicker({ value, onChange, options, current, disabled }: {
  value: EngineChoice | null;
  onChange: (v: EngineChoice | null) => void;
  options: EngineOption[];
  current: EnginesResponse["current"];
  disabled?: boolean;
}) {
  const eff = effectiveEngine(value, options, current);
  const defaultOption = effectiveEngine(null, options, current);
  const label = value ? eff?.name ?? value.provider : defaultOption ? `Default (${defaultOption.name})` : "Default";
  return (
    <Dropdown label={label} ariaLabel={`Agent: ${eff?.name ?? "default"}`} disabled={disabled}>
      {(close) => (
        <>
          <Item selected={!value} onPick={() => { onChange(null); close(); }} hint={defaultOption?.name}>Default</Item>
          {(["local", "one"] as const).map((g) => {
            const rows = options.filter((o) => o.group === g);
            if (!rows.length) return null;
            return (
              <div key={g} className="mt-1">
                <p className="label-caps px-2 pb-1 pt-1.5">{GROUP_LABEL[g]}</p>
                {rows.map((o) => (
                  <Item
                    key={o.id}
                    selected={!!value && optionIdFor(value.engine, value.provider) === o.id}
                    disabled={!usable(o)}
                    title={!usable(o) ? o.detail : undefined}
                    hint={usable(o) ? undefined : o.detail}
                    onPick={() => { onChange(choiceFor(o)); close(); }}
                  >
                    {o.name}
                  </Item>
                ))}
              </div>
            );
          })}
        </>
      )}
    </Dropdown>
  );
}

/** Which of the chosen agent's models answers. Picking one pins the agent too, so the choice survives a default change. */
export function ModelPicker({ value, onChange, options, current, disabled }: {
  value: EngineChoice | null;
  onChange: (v: EngineChoice | null) => void;
  options: EngineOption[];
  current: EnginesResponse["current"];
  disabled?: boolean;
}) {
  const eff = effectiveEngine(value, options, current);
  if (!eff || !eff.models?.length) return null;
  const models = eff.models;
  const pinned = value?.model || "";
  const defaultLabel = `Default (${modelLabel(models, eff.model)})`;
  const label = pinned ? modelLabel(models, pinned) : defaultLabel;
  return (
    <Dropdown label={label} ariaLabel={`Model: ${label}`} disabled={disabled} width={240} align="end">
      {(close) => (
        <>
          <Item selected={!pinned} onPick={() => { onChange(value ? { ...value, model: "" } : null); close(); }}>{defaultLabel}</Item>
          {models.map((m) => (
            <Item key={m.id} selected={pinned === m.id} hint={m.hint} onPick={() => { onChange(choiceFor(eff, m.id)); close(); }}>
              {m.label}
            </Item>
          ))}
        </>
      )}
    </Dropdown>
  );
}
