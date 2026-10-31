import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Bookmark, LogOut, Pencil, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { keys, useMe, useSaved, useSources } from "@/lib/queries";
import { useTheme, type Theme } from "@/lib/theme";
import { useSize, type UiSize } from "@/lib/scale";
import { toast } from "@/lib/toast";
import { fmtNum } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { LoadError } from "@/components/ui/EmptyState";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { SectionTitle, Segmented, SettingRow, SettingsCard } from "./SettingsLayout";

export function GeneralSettings() {
  const me = useMe();
  const sources = useSources();
  const [theme, setTheme] = useTheme();
  const [size, setSize] = useSize();
  const nav = useNavigate();
  const qc = useQueryClient();
  const user = me.data?.user ?? null;
  const items = (sources.data?.sources ?? []).reduce((n, s) => n + s.health.itemCount, 0);

  const signOut = async () => {
    try {
      await api.signout();
      await qc.resetQueries();
      nav("/start");
    } catch (e) {
      toast({ title: "Could not sign out", detail: (e as Error).message, tone: "destructive" });
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <SectionTitle title="Account" />
        {me.isPending ? <Skeleton className="h-16 w-full rounded-lg" /> : (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4" data-testid="account-card">
            <Avatar name={user?.name ?? user?.email ?? "You"} src={user?.avatarUrl} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-13 font-medium">{user?.name ?? "Signed in"}{user?.isSample && <Badge tone="outline">Sample</Badge>}</p>
              <p className="truncate text-xs text-muted-foreground">{user?.isSample ? `${user.email} · the Acme Inc sample, replayed from fixtures` : `${user?.email ?? ""} · signed in with One`}</p>
            </div>
            <Button size="sm" icon={<LogOut />} onClick={() => void signOut()}>Sign out</Button>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle title="Appearance" />
        <SettingsCard>
          <SettingRow label="Theme" hint="System follows your computer.">
            <Segmented<Theme> label="Theme" value={theme} onChange={setTheme} options={[{ key: "light", label: "Light" }, { key: "dark", label: "Dark" }, { key: "system", label: "System" }]} />
          </SettingRow>
          <SettingRow label="Size" hint="Text, spacing and rows grow together.">
            <Segmented<UiSize> label="Size" value={size} onChange={setSize} options={[{ key: "small", label: "Small" }, { key: "default", label: "Default" }, { key: "large", label: "Large" }]} />
          </SettingRow>
        </SettingsCard>
      </section>

      {user?.isSample && (
        <section className="flex flex-col gap-3">
          <SectionTitle title="Sample data" hint="Acme Inc's tools, made up and replayed from fixtures. Nothing here reaches a real account." />
          <SettingsCard>
            <SettingRow label="Acme Inc sample" hint={`${fmtNum(items)} items across ${new Set((sources.data?.sources ?? []).map((s) => s.platform)).size} sources`}>
              <Button size="sm" onClick={() => nav("/start")}>Sign in with One instead</Button>
            </SettingRow>
          </SettingsCard>
        </section>
      )}

      <SavedSearches />
    </div>
  );
}

function SavedSearches() {
  const q = useSaved();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: keys.saved });

  const rename = async (id: string) => {
    const name = draft.trim();
    setEditing(null);
    if (!name) return;
    try { await api.patchSaved(id, { name }); await refresh(); } catch (e) { toast({ title: "Could not rename it", detail: (e as Error).message, tone: "destructive" }); }
  };
  const remove = async (id: string) => {
    try { await api.deleteSaved(id); await refresh(); } catch (e) { toast({ title: "Could not delete it", detail: (e as Error).message, tone: "destructive" }); }
  };

  return (
    <section className="flex flex-col gap-3">
      <SectionTitle title="Saved searches" hint="Pinned in the sidebar. G then 1 to 9 opens them in order. Press S on a results page to save one." />
      {q.isError ? <LoadError what="Saved searches" error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} className="rounded-lg border border-border bg-card py-8" />
        : !q.data ? <Skeleton className="h-24 w-full rounded-lg" />
        : q.data.length === 0 ? <p className="rounded-lg border border-dashed border-border-strong p-4 text-13 text-muted-foreground">No saved searches yet.</p>
        : (
          <div className="overflow-hidden rounded-lg border border-border bg-card" data-testid="saved-list">
            {q.data.map((s, i) => (
              <div key={s.id} className="group flex h-11 items-center gap-3 border-b border-border px-3 last:border-b-0">
                <Bookmark className="size-3.5 shrink-0 stroke-[1.75] text-muted-foreground" />
                {editing === s.id ? (
                  <form className="flex-1" onSubmit={(e) => { e.preventDefault(); void rename(s.id); }}>
                    <Input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => void rename(s.id)} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setEditing(null); } }} className="h-7" aria-label="Name" />
                  </form>
                ) : (
                  <div className="flex min-w-0 flex-1 items-baseline gap-3">
                    <span className="truncate text-13 font-medium">{s.name}</span>
                    <span className="truncate font-mono text-11 text-muted-foreground">{s.query}</span>
                  </div>
                )}
                {i < 9 && <span className="text-11 text-muted-foreground/70">G {i + 1}</span>}
                <IconButton size="sm" label="Rename" onClick={() => { setEditing(s.id); setDraft(s.name); }}><Pencil /></IconButton>
                <ConfirmButton size="sm" variant="ghost" icon={<Trash2 />} confirmLabel="Delete it" onConfirm={() => void remove(s.id)}>Delete</ConfirmButton>
              </div>
            ))}
          </div>
        )}
    </section>
  );
}
