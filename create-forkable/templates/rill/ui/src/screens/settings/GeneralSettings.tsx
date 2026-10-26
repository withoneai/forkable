import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { api } from "@/lib/api";
import { useMailbox, useMailboxId } from "@/lib/mailbox";
import { useSettings, useSettingsMutation } from "@/lib/queries";
import { useTheme, type Theme } from "@/lib/theme";
import { useSize, type UiSize } from "@/lib/scale";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import { Skeleton } from "@/components/ui/Skeleton";
import { LoadError } from "@/components/ui/EmptyState";
import { SectionTitle, SettingRow } from "./SettingsLayout";
import { Avatar } from "@/components/ui/Avatar";

export function GeneralSettings() {
  const mailboxId = useMailboxId();
  const { mailbox, me } = useMailbox();
  const q = useSettings(mailboxId);
  const save = useSettingsMutation(mailboxId);
  const [theme, setTheme] = useTheme();
  const [size, setSize] = useSize();
  const nav = useNavigate();
  const qc = useQueryClient();
  const s = q.data;

  const signOut = async () => {
    try {
      await api.signout();
      localStorage.removeItem("rill.mailbox");
      await qc.resetQueries();
      nav("/start");
    } catch (e) {
      toast({ title: "Could not sign out", detail: (e as Error).message, tone: "destructive" });
    }
  };

  if (!s && q.isError) return <LoadError what="Settings" error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} className="rounded-lg border border-border bg-card" />;
  if (!s) return <Skeleton className="h-64 w-full rounded-lg" />;
  return (
    <div className="flex flex-col gap-4">
      <SectionTitle title="General" />
      <div className="rounded-lg border border-border bg-card px-4">
        <SettingRow label="Who you are" hint="Jev reads this line before every email. The sample inbox is Dana's.">
          <CommitInput value={s.me ?? ""} onCommit={(v) => save.mutate({ me: v })} aria-label="Who you are" className="w-[320px]" placeholder="Dana Reyes, CEO of Acme Inc" />
        </SettingRow>
        <SettingRow label="Signed in as">
          <span className="flex items-center gap-2 text-13">
            <Avatar name={me?.user?.name ?? me?.user?.email ?? "Guest"} src={me?.user?.avatarUrl} size="md" />
            {me?.user?.name ?? "Guest"} <span className="text-muted-foreground">{me?.user?.email ?? mailbox?.address ?? ""}</span>
          </span>
        </SettingRow>
        {me?.local && (
          <SettingRow label="Sign in with One" hint="The Connect app this computer signs people in with. Its secrets stay in your Keychain.">
            <Button size="sm" onClick={() => nav("/setup/connect")}>{me.connect.configured ? "Connect app" : "Set it up"}</Button>
          </SettingRow>
        )}
        <SettingRow label="Brief time" hint="When the morning brief is written.">
          <Input type="time" value={s.briefTime} onChange={(e) => save.mutate({ briefTime: e.target.value })} aria-label="Brief time" className="tnum w-[120px]" />
        </SettingRow>
        <SettingRow label="Timezone">
          <CommitInput value={s.timezone ?? ""} onCommit={(v) => save.mutate({ timezone: v || null })} aria-label="Timezone" className="w-[220px]" placeholder={Intl.DateTimeFormat().resolvedOptions().timeZone} list="rill-timezones" />
          <datalist id="rill-timezones">{TIMEZONES.map((z) => <option key={z} value={z} />)}</datalist>
        </SettingRow>
        <SettingRow label="Theme">
          <Segmented value={theme} options={["light", "dark", "system"] as Theme[]} onChange={setTheme} label="Theme" />
        </SettingRow>
        <SettingRow label="Size" hint="Scales text, spacing and controls together.">
          <Segmented value={size} options={["small", "default", "large"] as UiSize[]} onChange={setSize} label="Size" />
        </SettingRow>
      </div>

      <div className="rounded-lg border border-border bg-card px-4">
        <SettingRow label="Apply labels" hint="Mirror lanes as Rill labels in Gmail, or categories in Outlook.">
          <Switch label="Apply labels" checked={s.applyLabels} onChange={(v) => save.mutate({ applyLabels: v })} />
        </SettingRow>
        <SettingRow label="Show images" hint="Load remote images in emails. Off blocks them, with a Show images button per email, so tracking pixels never fire on their own.">
          <Switch label="Show images" checked={s.showImages} onChange={(v) => save.mutate({ showImages: v })} />
        </SettingRow>
        <SettingRow label="Auto draft" hint="Write a draft when a reply is needed. Never for a VIP whose rule says no.">
          <Switch label="Auto draft" checked={s.autoDraft} onChange={(v) => save.mutate({ autoDraft: v })} />
        </SettingRow>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Signing out clears this browser's session. Your data stays.</span>
        <Button size="sm" variant="ghost" icon={<LogOut />} onClick={() => void signOut()}>Sign out</Button>
      </div>
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: T[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="inline-flex rounded-md border border-border bg-card p-0.5" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o} type="button" role="radio" aria-checked={value === o} onClick={() => onChange(o)} className={cn("h-6 rounded-sm px-2.5 text-xs font-medium capitalize transition-colors", value === o ? "bg-muted text-foreground shadow-[0_1px_1px_rgb(0_0_0/0.04)]" : "text-muted-foreground hover:text-foreground")}>{o}</button>
      ))}
    </div>
  );
}

const TIMEZONES: string[] = (() => {
  try { return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone"); } catch { return []; }
})();

/** Text setting that saves on blur or Enter, not on every keystroke. */
function CommitInput({ value, onCommit, ...rest }: Omit<React.ComponentProps<typeof Input>, "value" | "onChange"> & { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  const commit = () => { if (draft !== value) onCommit(draft.trim()); };
  return (
    <Input
      {...rest}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "Escape") setDraft(value); }}
    />
  );
}
