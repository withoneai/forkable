import { useEffect, useState } from "react";
import type { OnePlan, OnePlanStatus } from "@/contract/api-types";
import { useOnePlan, useSettings, useSettingsMutation } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { fmtNum } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { SectionTitle, SettingRow, SettingsCard } from "./SettingsLayout";

const PLANS: { value: OnePlan; label: string }[] = [
  { value: "auto", label: "Ask One" },
  { value: "free", label: "Free, 20 a minute" },
  { value: "starter", label: "Starter, 100 a minute" },
  { value: "pro", label: "Pro, 500 a minute" },
  { value: "custom", label: "Custom" },
];

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function planHint(p: OnePlanStatus): string {
  if (p.limitFrom === "one") return `One says ${fmtNum(p.limit)} calls a minute.`;
  if (p.limitFrom === "default") return "Until One answers, Search assumes the Free plan.";
  return `${fmtNum(p.limit)} calls a minute, as you picked.`;
}

function nowLine(p: OnePlanStatus): string {
  if (p.heldUntil) return `This month's One calls are used up. Updates wait and try again at ${time(p.heldUntil)}.`;
  if (p.slowedUntil) return `One asked Search to slow down. Calls go again at ${time(p.slowedUntil)}.`;
  const waiting = p.waiting.now + p.waiting.background;
  return `${fmtNum(p.lastMinute)} of ${fmtNum(p.pace)} calls in the last minute${waiting ? `, ${fmtNum(waiting)} waiting their turn` : ""}.`;
}

/** Settings, General: the One plan Search keeps to (packages/core/src/one-budget.ts). */
export function OnePlanSettings() {
  const q = useOnePlan();
  const settings = useSettings();
  const save = useSettingsMutation();
  const [rpm, setRpm] = useState("");
  const p = q.data;
  const plan = settings.data?.onePlan ?? p?.plan ?? "auto";
  useEffect(() => { if (settings.data?.oneRpm) setRpm(String(settings.data.oneRpm)); }, [settings.data?.oneRpm]);

  const put = (patch: { onePlan?: OnePlan; oneRpm?: number | null }) =>
    save.mutate(patch, {
      onSuccess: () => { toast({ title: "Saved" }); void q.refetch(); },
      onError: (e) => toast({ title: "Did not save", detail: e.message, tone: "destructive" }),
    });

  const pick = (v: string) => {
    if (v === "custom") {
      const n = Number(rpm);
      if (Number.isInteger(n) && n > 0) put({ onePlan: "custom", oneRpm: n });
      else save.mutate({ onePlan: "custom", oneRpm: 1000 }, { onSuccess: () => { setRpm("1000"); void q.refetch(); } });
      return;
    }
    put({ onePlan: v as OnePlan });
  };

  return (
    <section className="flex flex-col gap-3" data-testid="one-plan">
      <SectionTitle title="One plan" hint="Search stays under your One plan's calls a minute, so updates never get cut off. Your own searches and questions always go first." />
      {!p ? <Skeleton className="h-36 w-full rounded-lg" /> : (
        <SettingsCard>
          <SettingRow label="Plan" hint={planHint(p)}>
            <Select label="One plan" value={plan} options={PLANS} onChange={pick} className="w-52" />
          </SettingRow>
          {plan === "custom" && (
            <SettingRow label="Calls a minute" hint="The limit your One plan gives this app.">
              <div className="flex items-center gap-2">
                <Input aria-label="Calls a minute" inputMode="numeric" value={rpm} onChange={(e) => setRpm(e.target.value.replace(/\D/g, ""))} className="w-24" />
                <Button size="sm" disabled={!rpm || Number(rpm) === settings.data?.oneRpm} onClick={() => put({ onePlan: "custom", oneRpm: Number(rpm) })}>Save</Button>
              </div>
            </SettingRow>
          )}
          <SettingRow label="Right now" hint={nowLine(p)}>
            <span className="text-xs tabular-nums text-muted-foreground">{fmtNum(p.reserved)} kept for you</span>
          </SettingRow>
          <SettingRow label="This month" hint="Calls Search sent through One. Your plan in One has the monthly amount.">
            <span className="text-13 tabular-nums" data-testid="one-plan-month">{fmtNum(p.monthCalls)}<span className="text-muted-foreground"> · {fmtNum(p.todayCalls)} today</span></span>
          </SettingRow>
        </SettingsCard>
      )}
    </section>
  );
}
