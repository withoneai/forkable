import { useEffect, useMemo, useState } from "react";
import { ChevronRight, FileCode2, FileJson, FileText, Folder, FolderOpen, Lock } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { FileEntry } from "@builder/core/types";
import { api, humanError } from "@/lib/api";
import { keys, useFile, useFiles } from "@/lib/queries";
import { cn, MOD } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { EmptyState, LoadError, Skeleton, Spinner } from "@/components/ui";
import { CodeEditor } from "./CodeEditor";

interface Node { name: string; path: string; type: "file" | "dir"; generated?: boolean; children: Node[] }

function buildTree(files: FileEntry[]): Node[] {
  const root: Node = { name: "", path: "", type: "dir", children: [] };
  const dirs = new Map<string, Node>([["", root]]);
  const ensure = (dir: string): Node => {
    const hit = dirs.get(dir);
    if (hit) return hit;
    const parent = ensure(dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : "");
    const n: Node = { name: dir.split("/").pop()!, path: dir, type: "dir", children: [] };
    parent.children.push(n);
    dirs.set(dir, n);
    return n;
  };
  for (const f of files) {
    if (f.type === "dir") { ensure(f.path); continue; }
    const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
    ensure(dir).children.push({ name: f.path.split("/").pop()!, path: f.path, type: "file", generated: f.generated, children: [] });
  }
  const sort = (n: Node) => {
    n.children.sort((a, b) => (a.type !== b.type ? (a.type === "dir" ? -1 : 1) : a.name.localeCompare(b.name)));
    n.children.forEach(sort);
  };
  sort(root);
  return root.children;
}

function icon(name: string) {
  if (/\.(tsx?|jsx?|mjs)$/.test(name)) return <FileCode2 />;
  if (/\.jsonc?$/.test(name)) return <FileJson />;
  return <FileText />;
}

function Tree({ nodes, depth, open, toggle, selected, onPick, dirty }: {
  nodes: Node[]; depth: number; open: Set<string>; toggle: (p: string) => void; selected: string | null; onPick: (p: string) => void; dirty: Set<string>;
}) {
  return (
    <>
      {nodes.map((n) => {
        const isOpen = open.has(n.path);
        return (
          <div key={n.path}>
            <button
              type="button"
              onClick={() => (n.type === "dir" ? toggle(n.path) : onPick(n.path))}
              aria-expanded={n.type === "dir" ? isOpen : undefined}
              aria-current={selected === n.path || undefined}
              title={n.path}
              className={cn(
                "flex h-6 w-full items-center gap-1.5 rounded-sm pr-2 text-left text-xs transition-colors duration-75 [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:stroke-[1.75]",
                selected === n.path ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-card-hover hover:text-foreground",
              )}
              style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
            >
              {n.type === "dir" ? (
                <>
                  <ChevronRight className={cn("size-3! transition-transform duration-100", isOpen && "rotate-90")} />
                  {isOpen ? <FolderOpen /> : <Folder />}
                </>
              ) : (
                <>
                  <span className="w-3 shrink-0" />
                  {icon(n.name)}
                </>
              )}
              <span className="truncate">{n.name}</span>
              {n.generated && <Lock className="ml-auto size-3! opacity-60" />}
              {dirty.has(n.path) && <span className="ml-auto size-1.5 shrink-0 rounded-full bg-warning-text" aria-label="Unsaved" />}
            </button>
            {n.type === "dir" && isOpen && <Tree nodes={n.children} depth={depth + 1} open={open} toggle={toggle} selected={selected} onPick={onPick} dirty={dirty} />}
          </div>
        );
      })}
    </>
  );
}

export interface CodeTarget { path: string; line?: number | null; nonce?: number }

export function CodePane({ projectId, target, onTarget }: { projectId: string; target: CodeTarget | null; onTarget: (t: CodeTarget) => void }) {
  const qc = useQueryClient();
  const files = useFiles(projectId);
  const [open, setOpen] = useState<Set<string>>(() => new Set(["src", "server"]));
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const path = target?.path ?? null;
  const file = useFile(projectId, path);

  const tree = useMemo(() => buildTree(files.data ?? []), [files.data]);
  // Open the folders above the target so it is visible in the tree.
  useEffect(() => {
    if (!path) return;
    setOpen((s) => {
      const next = new Set(s);
      const parts = path.split("/");
      for (let i = 1; i < parts.length; i++) next.add(parts.slice(0, i).join("/"));
      return next;
    });
  }, [path]);
  // First visit: open src/App.tsx (or the first file).
  useEffect(() => {
    if (path || !files.data?.length) return;
    const pick = files.data.find((f) => f.path === "src/App.tsx") ?? files.data.find((f) => f.type === "file");
    if (pick) onTarget({ path: pick.path });
  }, [files.data, path, onTarget]);

  const generated = file.data?.generated ?? false;
  const content = path && drafts[path] !== undefined ? drafts[path]! : file.data?.content ?? "";
  const dirty = new Set(Object.keys(drafts));

  const save = async () => {
    if (!path || generated || drafts[path] === undefined) return;
    setSaving(true);
    try {
      const r = await api.putFile(projectId, { path, content: drafts[path]! });
      qc.setQueryData(keys.file(projectId, path), r);
      setDrafts((d) => { const n = { ...d }; delete n[path]; return n; });
      toast({ title: "Saved", detail: "It goes into a version before the next turn" });
    } catch (e) {
      toast({ title: "Could not save", detail: humanError(e), tone: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1">
      <nav aria-label="Files" className="flex w-[232px] shrink-0 flex-col border-r border-border bg-faint">
        <p className="label-caps flex h-9 shrink-0 items-center px-3">Files</p>
        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
          {files.isLoading ? (
            <div className="flex flex-col gap-2 px-2 pt-1">{[70, 50, 85, 60, 40, 75].map((w, i) => <Skeleton key={i} className="h-3" style={{ width: `${w}%` }} />)}</div>
          ) : files.isError ? (
            <LoadError what="The files" error={files.error} onRetry={() => files.refetch()} className="py-6" />
          ) : (
            <Tree nodes={tree} depth={0} open={open} toggle={(p) => setOpen((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; })} selected={path} onPick={(p) => onTarget({ path: p })} dirty={dirty} />
          )}
        </div>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col bg-card">
        {path ? (
          <>
            <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3 text-xs">
              <span className="truncate font-mono text-muted-foreground">{path}</span>
              {generated && <span className="inline-flex items-center gap-1 text-11 text-muted-foreground"><Lock className="size-3" />Generated from One's catalog. Read only.</span>}
              <span className="ml-auto flex items-center gap-2 text-11 text-muted-foreground">
                {saving ? <><Spinner className="size-3" /> Saving</> : dirty.has(path) ? <>Unsaved · {MOD} S to save</> : file.isFetching ? <Spinner className="size-3" /> : null}
              </span>
            </div>
            <div className="min-h-0 flex-1">
              {file.isLoading ? (
                <div className="flex flex-col gap-2 p-4">{[60, 80, 45, 70, 30, 55, 65].map((w, i) => <Skeleton key={i} className="h-3" style={{ width: `${w}%` }} />)}</div>
              ) : file.isError ? (
                <LoadError what="This file" error={file.error} onRetry={() => file.refetch()} />
              ) : file.data?.tooLarge ? (
                <EmptyState title="This file is too large or binary to show" detail="Open it in your own editor from the project folder." />
              ) : (
                <CodeEditor
                  path={path}
                  value={content}
                  readOnly={generated}
                  line={target?.line ?? null}
                  onChange={(v) => setDrafts((d) => (v === file.data?.content ? (() => { const n = { ...d }; delete n[path]; return n; })() : { ...d, [path]: v }))}
                  onSave={save}
                />
              )}
            </div>
          </>
        ) : (
          <EmptyState title="Pick a file" detail="Edits save with the shortcut and go into a version before the next turn." />
        )}
      </div>
    </div>
  );
}
