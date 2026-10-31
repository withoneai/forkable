import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { api } from "@/lib/api";
import { keys, useOAuthClients } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { fmtAgo } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { Skeleton } from "@/components/ui/Skeleton";
import { LoadError } from "@/components/ui/EmptyState";
import { SectionTitle } from "./SettingsLayout";

/** The server's public URL (the OAuth issuer) from /api/health; the UI may be on Vite's port in `pnpm dev`. */
function useServerUrl(): string {
  const q = useQuery({ queryKey: ["health"], queryFn: async () => (await (await fetch("/api/health")).json()) as { publicUrl?: string }, staleTime: Infinity });
  return q.data?.publicUrl ?? "http://localhost:52289";
}

export function ApiSettings() {
  const q = useOAuthClients();
  const qc = useQueryClient();
  const MCP_URL = `${useServerUrl()}/mcp`;
  const revoke = async (id: string, name: string) => {
    try {
      await api.revokeClient(id);
      await qc.invalidateQueries({ queryKey: keys.oauthClients });
      toast({ title: `${name} is signed out`, detail: "Its tokens stopped working just now." });
    } catch (e) {
      toast({ title: "Could not revoke it", detail: (e as Error).message, tone: "destructive" });
    }
  };
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <SectionTitle title="Signed-in apps" hint="The CLI, MCP hosts and scripts that signed in to this Search with OAuth. Revoke ends their tokens here." />
        {q.isError ? <LoadError what="Apps" error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} className="rounded-lg border border-border bg-card py-8" />
          : !q.data ? <Skeleton className="h-24 w-full rounded-lg" />
          : q.data.length === 0 ? <p className="rounded-lg border border-dashed border-border-strong p-4 text-13 text-muted-foreground">Nothing has signed in yet. Run <span className="font-mono">search login</span> to start.</p>
          : (
            <div className="overflow-hidden rounded-lg border border-border bg-card text-xs" data-testid="oauth-clients">
              <div aria-hidden className="flex h-8 items-center gap-3 border-b border-border bg-faint px-3 text-11 font-medium text-muted-foreground">
                <span className="w-[160px] shrink-0">App</span><span className="min-w-0 flex-1">Scopes</span><span className="w-[96px] shrink-0">Last used</span><span className="w-[88px] shrink-0" />
              </div>
              {q.data.map((c) => (
                <div key={c.clientId} className={`flex h-12 items-center gap-3 border-b border-border px-3 last:border-b-0${c.activeTokens ? "" : " text-muted-foreground"}`} data-active={c.activeTokens > 0}>
                  <span className="flex w-[160px] shrink-0 flex-col">
                    <span className="truncate text-13 font-medium">{c.name}</span>
                    <span className="text-11 text-muted-foreground">{c.activeTokens ? `${c.activeTokens} active ${c.activeTokens === 1 ? "sign-in" : "sign-ins"}` : "Signed out"}</span>
                  </span>
                  <span className="flex min-w-0 flex-1 flex-wrap gap-1">{c.scopes.map((s) => <Badge key={s} tone="outline" mono>{s}</Badge>)}</span>
                  <span className="w-[96px] shrink-0 text-muted-foreground">{fmtAgo(c.lastUsedAt)}</span>
                  <span className="flex w-[88px] shrink-0 justify-end">{c.activeTokens > 0 && <ConfirmButton size="sm" variant="ghost" confirmLabel="Revoke it" onConfirm={() => void revoke(c.clientId, c.name)}>Revoke</ConfirmButton>}</span>
                </div>
              ))}
            </div>
          )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle title="CLI" hint="Signs in with your browser once, then searches from the terminal." />
        <Snippet code={`search login\nsearch "globex renewal"\nsearch ask "Where are we with Globex?"`} />
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle title="MCP" hint="Local agents like Claude Code and Codex connect straight to this address and sign in with OAuth. Read only." />
        <Snippet code={MCP_URL} />
        <Snippet code={`claude mcp add --transport http search ${MCP_URL}`} />
        <p className="text-11 text-muted-foreground">For Codex or Claude Desktop, <span className="font-mono">search mcp-config --client codex</span> or <span className="font-mono">--client claude-desktop</span> prints the snippet.</p>
        <p className="text-11 text-muted-foreground">Chat apps in a browser cannot reach your computer, so they need a tunnel or a hosted Search.</p>
      </section>
    </div>
  );
}

function Snippet({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-faint py-2 pl-3 pr-1.5">
      <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-xs leading-5">{code}</pre>
      <Button size="sm" variant="ghost" icon={copied ? <Check /> : <Copy />} onClick={() => void navigator.clipboard.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>{copied ? "Copied" : "Copy"}</Button>
    </div>
  );
}
