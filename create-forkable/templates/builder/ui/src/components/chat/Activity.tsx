import { useState } from "react";
import { BookOpen, Brain, Check, ChevronRight, FilePen, Globe, ListTodo, Plug, Search, ShieldOff, Terminal, Wrench, X } from "lucide-react";
import type { FeedItem, ToolItem } from "@/lib/feed";
import { readsSummary } from "@/lib/feed";
import { cn, fmtDuration } from "@/lib/utils";
import { Spinner } from "@/components/ui";
import { Markdown } from "./Markdown";

const ICON = {
  read: <BookOpen />, write: <FilePen />, run: <Terminal />, search: <Search />, one: <Plug />, web: <Globe />, plan: <ListTodo />, other: <Wrench />,
};

function Row({ icon, children, status, onToggle, expanded, quiet }: {
  icon: React.ReactNode; children: React.ReactNode; status: "running" | "ok" | "fail" | null; onToggle?: () => void; expanded?: boolean; quiet?: boolean;
}) {
  const Comp = onToggle ? "button" : "div";
  return (
    <Comp
      {...(onToggle ? { type: "button" as const, onClick: onToggle, "aria-expanded": expanded } : {})}
      className={cn(
        "group flex min-h-7 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors duration-75",
        quiet ? "text-muted-foreground" : "text-foreground",
        onToggle && "hover:bg-card-hover",
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-3.5 [&>svg]:stroke-[1.75]">{icon}</span>
      <span className="flex min-w-0 flex-1 items-center gap-1.5">{children}</span>
      {status === "running" && <Spinner className="size-3 text-muted-foreground" />}
      {status === "fail" && <X className="size-3.5 shrink-0 text-destructive-text" aria-label="Failed" />}
      {status === "ok" && !quiet && <Check className="size-3.5 shrink-0 text-muted-foreground/60 opacity-0 transition-opacity group-hover:opacity-100" aria-label="Done" />}
      {onToggle && <ChevronRight className={cn("size-3 shrink-0 text-muted-foreground/60 transition-transform duration-100", expanded && "rotate-90")} />}
    </Comp>
  );
}

function Obj({ children }: { children: React.ReactNode }) {
  return <span className="min-w-0 truncate font-mono text-11 text-muted-foreground">{children}</span>;
}

function ToolRow({ t }: { t: ToolItem }) {
  const [open, setOpen] = useState(false);
  const running = t.ok === null;
  const label = running ? t.d.running : t.d.done;
  const hasMore = !!t.preview;
  return (
    <div>
      <Row icon={ICON[t.d.icon]} status={running ? "running" : t.ok ? "ok" : "fail"} quiet={t.d.salience === "quiet"} onToggle={hasMore ? () => setOpen((v) => !v) : undefined} expanded={open}>
        <span className={cn("shrink-0", t.d.salience === "loud" && "font-medium")}>{label}</span>
        {t.d.object && <Obj>{t.d.object}</Obj>}
      </Row>
      {open && t.preview && (
        <pre className="fade-in mx-2 mb-1 ml-8 max-h-48 overflow-auto rounded-md border border-border bg-faint px-2.5 py-1.5 font-mono text-11 leading-4 text-muted-foreground whitespace-pre-wrap">{t.preview}</pre>
      )}
    </div>
  );
}

function ReadsRow({ tools }: { tools: ToolItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Row icon={<BookOpen />} status={null} quiet onToggle={() => setOpen((v) => !v)} expanded={open}>
        <span className="shrink-0">{readsSummary(tools)}</span>
      </Row>
      {open && (
        <div className="fade-in ml-6 border-l border-border pl-1">
          {tools.map((t) => <ToolRow key={t.id} t={t} />)}
        </div>
      )}
    </div>
  );
}

function Thinking({ ms, live, text }: { ms: number; live: boolean; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Row icon={<Brain />} status={null} quiet onToggle={text ? () => setOpen((v) => !v) : undefined} expanded={open}>
        <span className={cn(live && "shimmer-text")}>{live ? "Thinking" : `Thought for ${fmtDuration(Math.max(1000, ms))}`}</span>
      </Row>
      {open && text && <p className="fade-in mx-2 mb-1 ml-8 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{text}</p>}
    </div>
  );
}

export function ActivityItem({ item, harnessLabel }: { item: FeedItem; harnessLabel: string }) {
  switch (item.type) {
    case "text":
      return <div className="px-2 py-1"><Markdown text={item.text} />{item.streaming && <span className="caret" aria-hidden />}</div>;
    case "thinking":
      return <Thinking ms={item.ms} live={item.live} text={item.text} />;
    case "tool":
      return <ToolRow t={item} />;
    case "reads":
      return <ReadsRow tools={item.tools} />;
    case "denied":
      return (
        <div className="mx-2 my-0.5 flex items-start gap-2 rounded-md border border-warning-text/25 bg-warning-text/8 px-2.5 py-1.5 text-xs">
          <ShieldOff className="mt-0.5 size-3.5 shrink-0 stroke-[1.75] text-warning-text" />
          <span>
            {harnessLabel} tried to run <span className="font-mono">{item.tool}</span>, which this project does not allow.
            {item.reason && <span className="text-muted-foreground"> {shortReason(item.reason)}</span>}
          </span>
        </div>
      );
    case "note":
      return (
        <p className={cn("px-2 py-1 text-xs", item.tone === "error" ? "text-destructive-text" : item.tone === "warn" ? "text-warning-text" : "text-muted-foreground")}>{item.text}</p>
      );
    default:
      return null;
  }
}

/** The CLIs explain a denial at length; the card needs one line. */
export function shortReason(reason: string): string {
  const needed = /What required approval:\s*(.+?)\s*$/s.exec(reason);
  if (needed) return `It needed approval for ${needed[1]!.replace(/\.$/, "").toLowerCase()}.`;
  const cmd = /Permission to use \w+ with command (.+?) has been denied/s.exec(reason);
  if (cmd) return `The command was ${cmd[1]!.length > 80 ? `${cmd[1]!.slice(0, 79)}…` : cmd[1]}.`;
  if (/directory that is denied|has been denied/i.test(reason)) return "That path is outside what this project allows.";
  const first = reason.split(/(?<=\.)\s/)[0] ?? reason;
  return first.length > 140 ? `${first.slice(0, 139)}…` : first;
}
