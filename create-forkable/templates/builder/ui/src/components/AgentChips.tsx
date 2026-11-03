import { useState } from "react";
import { Bot, ChevronDown, Hammer, ShieldAlert, Sparkles } from "lucide-react";
import type { HarnessId, HarnessInfo, Permission } from "@builder/harness/types";
import { cn } from "@/lib/utils";
import { Menu } from "./ui/Menu";
import { Badge } from "./ui/Badge";
import { Dialog } from "./ui/Dialog";
import { Button } from "./ui/Button";

export const FULL_ACCESS_COPY = "Full access: the agent can run anything on this computer";

function Chip({ children, onClick, open, tone, label, className }: {
  children: React.ReactNode; onClick: () => void; open: boolean; tone?: "danger"; label: string; className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={label}
      className={cn(
        "inline-flex h-7 max-w-[220px] items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors duration-100 [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:stroke-[1.75]",
        tone === "danger"
          ? "border-destructive-text/30 bg-destructive-text/10 text-destructive-text hover:bg-destructive-text/15"
          : "border-border bg-card text-foreground hover:border-border-strong hover:bg-card-hover",
        open && tone !== "danger" && "border-border-strong bg-card-hover",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function harnessLabel(h: HarnessInfo | undefined, id: HarnessId | null): string {
  if (h) return h.label;
  return id === "claude-code" ? "Claude Code" : id === "codex" ? "Codex" : id === "openclaw" ? "OpenClaw" : id === "replay" ? "Replay" : "Choose an agent";
}

/** Harness picker plus a model picker for the chosen harness. */
export function AgentChips({ harnesses, harness, model, onChange, compact }: {
  harnesses: HarnessInfo[];
  harness: HarnessId | null;
  model: string | null;
  onChange: (v: { harness: HarnessId; model: string | null }) => void;
  compact?: boolean;
}) {
  const [hOpen, setHOpen] = useState(false);
  const [mOpen, setMOpen] = useState(false);
  const cur = harnesses.find((h) => h.id === harness);
  const models = cur?.models ?? [];
  const modelLabel = model ? models.find((m) => m.id === model)?.label ?? model : "Default model";

  return (
    <div className="flex items-center gap-1">
      <Menu
        open={hOpen}
        onClose={() => setHOpen(false)}
        className="w-[260px]"
        items={harnesses.map((h) => ({
          key: h.id,
          disabled: !h.bin,
          label: (
            <span className="flex items-center gap-1.5">
              {h.label}
              {h.status === "preview" && <Badge tone="warning">Preview</Badge>}
            </span>
          ),
          hint: !h.bin ? "Not installed" : h.signedIn === false ? "Signed out" : h.version ?? "",
          onSelect: () => onChange({ harness: h.id, model: null }),
        }))}
        anchor={
          <Chip label="Coding agent" open={hOpen} onClick={() => setHOpen((v) => !v)}>
            <Bot />
            <span className="truncate">{harnessLabel(cur, harness)}</span>
            {cur?.status === "preview" && !compact && <Badge tone="warning">Preview</Badge>}
            <ChevronDown className="size-3 opacity-60" />
          </Chip>
        }
      />
      {models.length > 0 && (
        <Menu
          open={mOpen}
          onClose={() => setMOpen(false)}
          className="max-h-[320px] w-[240px] overflow-y-auto"
          items={[
            { key: "_default", label: "Default model", hint: "the CLI picks", onSelect: () => onChange({ harness: harness!, model: null }) },
            ...models.map((m) => ({ key: m.id, label: m.label, hint: m.hint, onSelect: () => onChange({ harness: harness!, model: m.id }) })),
          ]}
          anchor={
            <Chip label="Model" open={mOpen} onClick={() => setMOpen((v) => !v)} className="text-muted-foreground">
              <Sparkles />
              <span className="truncate">{modelLabel}</span>
              <ChevronDown className="size-3 opacity-60" />
            </Chip>
          }
        />
      )}
    </div>
  );
}

/** Build (default) or Full access, confirmed once. Plan mode lives in the composer. */
export function PermissionChip({ value, onChange }: { value: Permission; onChange: (p: Permission) => void }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const full = value === "full";
  return (
    <>
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        className="w-[300px]"
        items={[
          { key: "build", label: <span className="flex flex-col py-0.5"><span>Build</span><span className="text-11 text-muted-foreground">Edits files and runs checks. No installs, no dev servers.</span></span>, onSelect: () => onChange("build") },
          { key: "full", label: <span className="flex flex-col py-0.5"><span>Full access</span><span className="text-11 text-muted-foreground">The agent can run anything on this computer.</span></span>, tone: "destructive", onSelect: () => { if (!full) setConfirm(true); } },
        ]}
        anchor={
          <Chip label="Permission" open={open} onClick={() => setOpen((v) => !v)} tone={full ? "danger" : undefined}>
            {full ? <ShieldAlert /> : <Hammer />}
            <span className="truncate">{full ? FULL_ACCESS_COPY : "Build"}</span>
            <ChevronDown className="size-3 opacity-60" />
          </Chip>
        }
      />
      <Dialog open={confirm} onClose={() => setConfirm(false)} title="Give the agent full access" size="sm">
        <div className="flex flex-col gap-3 p-4 text-13">
          <p>With full access the agent can run any command on this computer, read files outside this project and reach the network.</p>
          <p className="text-muted-foreground">Pushes, remotes, One credentials and your keys stay blocked at every level. You can switch back to Build at any time.</p>
          <div className="flex justify-end gap-2 pt-1">
            <Button onClick={() => setConfirm(false)}>Keep Build</Button>
            <Button variant="destructive" onClick={() => { setConfirm(false); onChange("full"); }}>Allow full access</Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
