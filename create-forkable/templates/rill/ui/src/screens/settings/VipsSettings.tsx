import { useState } from "react";
import { Plus, Send, Trash2 } from "lucide-react";
import type { ApiVip, VipInput, VipSuggestion } from "@rill/core/api-types";
import type { VipMatchKind, VipRules, VipTier } from "@rill/core/types";
import { useMailboxId } from "@/lib/mailbox";
import { useVipMutations, useVips } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { cn, TIER_LABEL } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { SectionTitle } from "./SettingsLayout";

const TIERS: VipTier[] = ["inner", "key", "team"];
const KINDS: { k: VipMatchKind; label: string; placeholder: string }[] = [
  { k: "address", label: "Address", placeholder: "priya@northwind.vc" },
  { k: "domain", label: "Domain", placeholder: "acme.com" },
  { k: "description", label: "Description", placeholder: "anyone on our board" },
];

export function VipsSettings() {
  const mailboxId = useMailboxId();
  const q = useVips(mailboxId);
  const m = useVipMutations(mailboxId);
  const [adding, setAdding] = useState(false);
  const [suggestions, setSuggestions] = useState<VipSuggestion[] | null>(null);

  const suggest = () => m.suggest.mutate(undefined, {
    onSuccess: (s) => setSuggestions(s.filter((x) => !q.data?.some((v) => v.match.toLowerCase() === x.email.toLowerCase()))),
    onError: (e) => toast({ title: "No suggestions", detail: e.message, tone: "destructive" }),
  });

  return (
    <div className="flex flex-col gap-4">
      <SectionTitle title="VIPs" hint="Match by address, domain or a description. Jev resolves descriptions; code resolves exact matches.">
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" icon={<Send />} onClick={suggest} loading={m.suggest.isPending}>Suggest from my sent mail</Button>
          <Button size="sm" icon={<Plus />} onClick={() => setAdding(true)}>Add VIP</Button>
        </div>
      </SectionTitle>

      {suggestions && (
        <div className="slide-up overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex h-8 items-center justify-between border-b border-border bg-faint px-3 text-xs">
            <span className="font-medium">Suggested from sent mail</span>
            <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setSuggestions(null)}>Hide</button>
          </div>
          {suggestions.length === 0 && <p className="px-3 py-3 text-xs text-muted-foreground">Everyone suggested is already a VIP.</p>}
          {suggestions.map((s) => (
            <div key={s.email} className="flex h-11 items-center gap-3 border-b border-border px-3 last:border-b-0">
              <Avatar name={s.name} size="md" />
              <span className="min-w-0 flex-1 truncate text-13">{s.name} <span className="text-muted-foreground">{s.email} · {s.reason}</span></span>
              <Button size="sm" onClick={() => m.create.mutate({ name: s.name, matchKind: "address", match: s.email, tier: "key" }, { onSuccess: () => setSuggestions((x) => x?.filter((y) => y.email !== s.email) ?? null) })}>Add</Button>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <VipEditor
          onCancel={() => setAdding(false)}
          onSave={(input) => m.create.mutate(input, { onSuccess: () => setAdding(false) })}
          saving={m.create.isPending}
        />
      )}

      {q.isPending && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
      <div className="flex flex-col gap-2">
        {q.data?.map((v) => <VipRow key={v.id} v={v} onPatch={(patch) => m.update.mutate({ vipId: v.id, patch })} onDelete={() => m.remove.mutate(v.id)} />)}
      </div>
    </div>
  );
}

function VipEditor({ onSave, onCancel, saving }: { onSave: (v: VipInput) => void; onCancel: () => void; saving: boolean }) {
  const [v, setV] = useState<VipInput>({ name: "", matchKind: "address", match: "", tier: "key", rules: {} });
  const kind = KINDS.find((k) => k.k === v.matchKind)!;
  return (
    <form className="slide-up flex flex-col gap-3 rounded-lg border border-border bg-card p-3" onSubmit={(e) => { e.preventDefault(); if (v.name.trim() && v.match.trim()) onSave({ ...v, name: v.name.trim(), match: v.match.trim() }); }}>
      <div className="grid grid-cols-2 gap-2">
        <Input autoFocus placeholder="Name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} aria-label="VIP name" />
        <Input placeholder={kind.placeholder} value={v.match} onChange={(e) => setV({ ...v, match: e.target.value })} aria-label="Match" mono={v.matchKind !== "description"} />
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <RadioGroup label="Match" value={v.matchKind} options={KINDS.map((k) => ({ value: k.k, label: k.label }))} onChange={(matchKind) => setV({ ...v, matchKind })} />
        <RadioGroup label="Tier" value={v.tier ?? "key"} options={TIERS.map((t) => ({ value: t, label: TIER_LABEL[t] }))} onChange={(tier) => setV({ ...v, tier })} />
      </div>
      <Rules rules={v.rules ?? {}} onChange={(rules) => setV({ ...v, rules })} />
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button size="sm" variant="primary" type="submit" loading={saving} disabled={!v.name.trim() || !v.match.trim()}>Add VIP</Button>
      </div>
    </form>
  );
}

function VipRow({ v, onPatch, onDelete }: { v: ApiVip; onPatch: (p: Partial<VipInput>) => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const matchLabel = v.matchKind === "domain" ? `@${v.match}` : v.matchKind === "description" ? `“${v.match}”` : v.match;
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex h-12 w-full items-center gap-3 px-3 text-left transition-colors hover:bg-faint">
        <Avatar name={v.name} size="lg" />
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="flex items-center gap-2 text-13 font-medium">{v.name} <Badge>{TIER_LABEL[v.tier]}</Badge></span>
          <span className={cn("truncate text-11 text-muted-foreground", v.matchKind !== "description" && "font-mono")}>{matchLabel}</span>
        </span>
        <span className="text-11 text-muted-foreground">{ruleSummary(v.rules)}</span>
        <span className="tnum w-14 text-right text-11 text-muted-foreground">{v.matched7d} in 7d</span>
      </button>
      {open && (
        <div className="fade-in flex flex-col gap-3 border-t border-border bg-faint p-3">
          <div className="flex flex-wrap items-center gap-4">
            <RadioGroup label="Match" value={v.matchKind} options={KINDS.map((k) => ({ value: k.k, label: k.label }))} onChange={(matchKind) => onPatch({ matchKind })} />
            <RadioGroup label="Tier" value={v.tier} options={TIERS.map((t) => ({ value: t, label: TIER_LABEL[t] }))} onChange={(tier) => onPatch({ tier })} />
          </div>
          <Rules rules={v.rules} onChange={(rules) => onPatch({ rules })} />
          <div className="flex justify-end">
            <ConfirmButton size="sm" variant="ghost" icon={<Trash2 />} onConfirm={onDelete} confirmLabel="Remove this VIP?">Remove</ConfirmButton>
          </div>
        </div>
      )}
    </div>
  );
}

function ruleSummary(r: VipRules): string {
  const parts = [r.alwaysTop && "always top", r.notify && "notify", r.neverDraft && "no auto-draft", r.replyWithinHours ? `reply in ${r.replyWithinHours}h` : null, r.followUpDays ? `follow up ${r.followUpDays}d` : null].filter(Boolean);
  return parts.length ? parts.join(", ") : "default rules";
}

function RadioGroup<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <fieldset className="flex items-center gap-1">
      <legend className="sr-only">{label}</legend>
      <span className="mr-1 text-11 text-muted-foreground">{label}</span>
      {options.map((o) => (
        <label key={o.value} className={cn("inline-flex h-6 cursor-default items-center rounded-md border px-2 text-xs transition-colors", value === o.value ? "border-foreground bg-foreground text-background" : "border-border bg-card hover:border-border-strong")}>
          <input type="radio" className="sr-only" name={label} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
          {o.label}
        </label>
      ))}
    </fieldset>
  );
}

function Rules({ rules, onChange }: { rules: VipRules; onChange: (r: VipRules) => void }) {
  const set = (patch: Partial<VipRules>) => onChange({ ...rules, ...patch });
  const Check = ({ k, label }: { k: "alwaysTop" | "notify" | "neverDraft"; label: string }) => (
    <label className="inline-flex items-center gap-1.5 text-xs">
      <input type="checkbox" className="size-3.5 accent-[var(--foreground)]" checked={!!rules[k]} onChange={(e) => set({ [k]: e.target.checked })} />
      {label}
    </label>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <Check k="alwaysTop" label="Always top" />
      <Check k="notify" label="Notify" />
      <Check k="neverDraft" label="Never auto-draft" />
      <label className="inline-flex items-center gap-1.5 text-xs">
        <input type="checkbox" className="size-3.5 accent-[var(--foreground)]" checked={rules.replyWithinHours != null} onChange={(e) => set({ replyWithinHours: e.target.checked ? 4 : null })} />
        Reply within
        <input type="number" min={1} max={72} disabled={rules.replyWithinHours == null} value={rules.replyWithinHours ?? ""} onChange={(e) => set({ replyWithinHours: Number(e.target.value) || null })} aria-label="Hours" className="tnum h-6 w-12 rounded-md border border-border bg-background px-1.5 text-xs disabled:opacity-40" />
        hours
      </label>
      <label className="inline-flex items-center gap-1.5 text-xs">
        <input type="checkbox" className="size-3.5 accent-[var(--foreground)]" checked={rules.followUpDays != null} onChange={(e) => set({ followUpDays: e.target.checked ? 3 : null })} />
        Follow up after
        <input type="number" min={1} max={30} disabled={rules.followUpDays == null} value={rules.followUpDays ?? ""} onChange={(e) => set({ followUpDays: Number(e.target.value) || null })} aria-label="Days" className="tnum h-6 w-12 rounded-md border border-border bg-background px-1.5 text-xs disabled:opacity-40" />
        days
      </label>
    </div>
  );
}
