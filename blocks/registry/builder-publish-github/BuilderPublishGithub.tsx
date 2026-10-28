import { useState } from "react";
import { Check, ExternalLink, FileText, X } from "lucide-react";
import clsx from "clsx";
import { OneClientError, oneFetch, type OneMeta } from "../lib/one-client";
import { Button, ErrorState, SourceChip } from "../lib/one-ui";
import type { PublishResponse, SourceFile } from "../builder/types";

export interface BuilderPublishGithubProps {
  files: SourceFile[];
  defaultRepo?: string;
  onPublished?: (r: PublishResponse) => void;
  className?: string;
}

/** Publish files as a new repository on the user's GitHub, after one explicit confirm. */
export function BuilderPublishGithub({ files, defaultRepo = "", onPublished, className }: BuilderPublishGithubProps) {
  const [repo, setRepo] = useState(defaultRepo);
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [sure, setSure] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ data: PublishResponse; meta: OneMeta } | null>(null);
  const [err, setErr] = useState<OneClientError | null>(null);
  const isPublic = visibility === "public" && sure;
  const bytes = files.reduce((n, f) => n + f.content.length, 0);

  const publish = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await oneFetch<PublishResponse>("/api/builder/publish/github", { method: "POST", body: { repo, visibility, confirmPublic: isPublic, files } });
      setRes(r);
      setConfirming(false);
      if (r.data.url) onPublished?.(r.data);
    } catch (e) {
      setErr(e instanceof OneClientError ? e : new OneClientError(0, "network", String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-block="builder-publish-github" className={clsx("flex min-h-0 flex-col gap-4 overflow-y-auto p-4 [&>*]:shrink-0", className)}>
      <div className="flex items-center gap-2">
        <img src="https://assets.withone.ai/connectors/github.svg" alt="" className="size-4 dark:invert" />
        <span className="text-13 font-semibold text-foreground">Publish to GitHub</span>
        <span className="ml-auto">
          <SourceChip meta={res?.meta ?? null} />
        </span>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-11 text-muted-foreground">Repository name</span>
        <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="my-app" className="h-8 rounded-md border border-border bg-raised px-2.5 font-mono text-13 text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-strong focus:border-strong" />
      </label>

      <div className="flex flex-col gap-2">
        <div className="inline-flex items-center gap-0.5 self-start rounded-md border border-border bg-foreground/4 p-0.5">
          {(["private", "public"] as const).map((v) => (
            <button key={v} onClick={() => setVisibility(v)} aria-pressed={visibility === v} className={clsx("h-6 rounded-sm px-2 text-xs font-medium capitalize transition-colors", visibility === v ? "bg-raised text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground")}>
              {v}
            </button>
          ))}
        </div>
        {visibility === "public" && (
          <label className="flex items-center gap-2 text-xs text-foreground">
            <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} className="accent-primary" />
            Anyone on the internet can see this code
          </label>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-11 text-muted-foreground">
          {files.length} file{files.length === 1 ? "" : "s"}, {(bytes / 1024).toFixed(1)} KB
        </span>
        <ul className="flex max-h-32 flex-col gap-1 overflow-y-auto rounded-md border border-border bg-raised p-2">
          {files.map((f) => (
            <li key={f.path} className="flex items-center gap-1.5 font-mono text-11 text-foreground">
              <FileText className="size-3 shrink-0 text-muted-foreground" />
              <span className="truncate">{f.path}</span>
            </li>
          ))}
        </ul>
      </div>

      {!confirming && !res?.data.url && (
        <Button variant="primary" className="self-start" disabled={!repo.trim() || !files.length || (visibility === "public" && !sure)} onClick={() => setConfirming(true)}>
          Publish
        </Button>
      )}

      {confirming && (
        <div className="flex flex-col gap-3 rounded-lg border border-strong bg-raised p-3 shadow-soft">
          <span className="text-13 font-semibold text-foreground">Publish {repo}?</span>
          <p className="text-xs leading-relaxed text-muted-foreground">
            This creates a <span className="font-medium text-foreground">{isPublic ? "public" : "private"}</span> repository named <span className="font-mono text-foreground">{repo}</span> on your GitHub account and commits {files.length} file{files.length === 1 ? "" : "s"} to main in one commit. It makes {files.length + 4} GitHub calls through your grant: the repository, {files.length} file upload{files.length === 1 ? "" : "s"}, a tree, a commit and the branch.
          </p>
          <div className="flex items-center gap-2">
            <Button variant="primary" onClick={publish} disabled={busy}>
              {busy ? "Publishing" : "Create repository and commit"}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {err && <ErrorState error={err} />}
      {res && (
        <div className="flex flex-col gap-2">
          <ol className="flex flex-col gap-1">
            {res.data.steps.map((s) => (
              <li key={s.step} className="flex items-center gap-2 text-xs">
                {s.status === "done" ? <Check className="size-3.5 text-accent" /> : <X className="size-3.5 text-danger" />}
                <span className="w-14 capitalize text-muted-foreground">{s.step}</span>
                <span className={s.status === "failed" ? "text-danger" : "text-foreground"}>{s.detail}</span>
              </li>
            ))}
          </ol>
          {res.data.url && (
            <a href={res.data.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 self-start text-13 font-medium text-foreground hover:text-accent">
              {res.data.owner}/{res.data.repo}
              <ExternalLink className="size-3.5" />
            </a>
          )}
          {res.meta.mode === "sample" && <span className="text-11 text-muted-foreground">Sample mode: nothing was created on GitHub.</span>}
        </div>
      )}
    </div>
  );
}
