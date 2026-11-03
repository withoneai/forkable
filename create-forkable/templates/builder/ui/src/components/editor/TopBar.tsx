import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, PanelLeft, Rocket } from "lucide-react";
import type { Project } from "@builder/core/types";
import type { HarnessInfo } from "@builder/harness/types";
import { humanError } from "@/lib/api";
import { usePatchProject } from "@/lib/queries";
import { hint } from "@/lib/keymap";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/Logo";
import { AgentChips, PermissionChip } from "@/components/AgentChips";
import { IconButton, Tooltip } from "@/components/ui";

function NameField({ project }: { project: Project }) {
  const patch = usePatchProject(project.id);
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(project.name);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!editing) setV(project.name); }, [project.name, editing]);
  useEffect(() => { if (editing) ref.current?.select(); }, [editing]);
  const commit = () => {
    setEditing(false);
    const name = v.trim();
    if (!name || name === project.name) return;
    patch.mutate({ name }, { onError: (e) => toast({ title: "Could not rename", detail: humanError(e), tone: "destructive" }) });
  };
  if (editing) {
    return (
      <input
        ref={ref}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") { e.stopPropagation(); setV(project.name); setEditing(false); }
        }}
        aria-label="Project name"
        className="h-7 w-[200px] rounded-md border border-ring bg-card px-2 text-13 font-medium outline-none shadow-[0_0_0_3px_color-mix(in_oklch,var(--ring)_18%,transparent)]"
      />
    );
  }
  return (
    <button type="button" onClick={() => setEditing(true)} title="Rename" className="h-7 max-w-[240px] truncate rounded-md px-2 text-13 font-semibold tracking-tight transition-colors hover:bg-card-hover">
      {project.name}
    </button>
  );
}

export function TopBar({ project, harnesses, chatOpen, onToggleChat, connected, onPublish }: {
  project: Project;
  harnesses: HarnessInfo[];
  chatOpen: boolean;
  onToggleChat: () => void;
  connected: boolean;
  onPublish: () => void;
}) {
  const patch = usePatchProject(project.id);
  const onErr = (e: unknown) => toast({ title: "Could not change that", detail: humanError(e), tone: "destructive" });
  return (
    <header className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border bg-background px-2">
      <Link to="/" aria-label="All projects" className="flex h-8 items-center gap-1 rounded-md pl-1 pr-1.5 text-muted-foreground transition-colors hover:bg-card-hover hover:text-foreground">
        <ChevronLeft className="size-3.5 stroke-[1.75]" />
        <Logo size={18} />
      </Link>
      <NameField project={project} />
      <span className={cn("size-1.5 shrink-0 rounded-full", connected ? "bg-success-text" : "bg-muted-foreground/40")} title={connected ? "Live" : "Reconnecting"} />
      <IconButton label={chatOpen ? "Hide chat" : "Show chat"} hint={hint("toggleChat")} active={!chatOpen} onClick={onToggleChat} className="ml-1">
        <PanelLeft />
      </IconButton>
      <div className="ml-auto flex items-center gap-1.5">
        <AgentChips
          harnesses={harnesses}
          harness={project.harness}
          model={project.model}
          compact
          onChange={(v) => patch.mutate({ harness: v.harness, model: v.model }, { onError: onErr })}
        />
        <PermissionChip value={project.permission} onChange={(p) => patch.mutate({ permission: p }, { onError: onErr })} />
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <Tooltip label={<>{project.published ? "Published. Publish this version" : "Check and publish to GitHub or Vercel"}<span className="ml-0.5 rounded-sm bg-background/20 px-1 font-normal opacity-90">{hint("publish")}</span></>}>
          <button
            type="button"
            onClick={onPublish}
            className="inline-flex h-7 items-center gap-1.5 rounded-md bg-foreground px-3 text-xs font-medium text-background transition-opacity hover:opacity-90"
          >
            <Rocket className="size-3.5 stroke-[1.75]" />Publish
            {project.published && <span className="size-1.5 rounded-full bg-success-text" aria-label="Published before" />}
          </button>
        </Tooltip>
      </div>
    </header>
  );
}
