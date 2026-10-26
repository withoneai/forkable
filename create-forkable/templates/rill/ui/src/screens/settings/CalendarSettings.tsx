import { useMailboxId } from "@/lib/mailbox";
import type { ConferencingProvider } from "@rill/core/types";
import { useCalendar, useConferencing, useSettings, useSettingsMutation, useUpdateCalendar } from "@/lib/queries";
import { Tabs } from "@/components/ui/Tabs";
import { Skeleton } from "@/components/ui/Skeleton";
import { LoadError } from "@/components/ui/EmptyState";
import { Switch } from "@/components/ui/Switch";
import { Input } from "@/components/ui/Input";
import { SectionTitle, SettingRow } from "./SettingsLayout";

const CONF_LABEL: Record<ConferencingProvider, string> = { "google-meet": "Google Meet", teams: "Teams", zoom: "Zoom" };

const DAY_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function CalendarSettings() {
  const mailboxId = useMailboxId();
  const settingsQ = useSettings(mailboxId);
  const settingsMut = useSettingsMutation(mailboxId);
  const confQ = useConferencing(mailboxId);
  const now = new Date();
  const far = new Date(now.getTime() + 60 * 864e5);
  const calQ = useCalendar(mailboxId, now.toISOString(), far.toISOString());
  const updateCal = useUpdateCalendar(mailboxId);
  const s = settingsQ.data;

  if (calQ.isError) return <LoadError what="Calendars" error={calQ.error} onRetry={() => void calQ.refetch()} retrying={calQ.isFetching} className="rounded-lg border border-border bg-card" />;
  if (!calQ.data || !s) return <Skeleton className="h-64 w-full rounded-lg" />;

  const toggleDay = (d: number) => {
    const days = s.workingHours.days.includes(d) ? s.workingHours.days.filter((x) => x !== d) : [...s.workingHours.days, d].sort();
    settingsMut.mutate({ workingHours: { ...s.workingHours, days } });
  };
  const minutesFromTime = (v: string) => { const [h, m] = v.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };
  const timeFromMinutes = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

  return (
    <div className="flex flex-col gap-4">
      <SectionTitle title="Calendars" hint="Each calendar can show on the grid and count toward your free/busy. The default calendar is where new events and Book it land." />

      {calQ.data.calendars.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-strong bg-card px-4 py-6 text-center text-13 text-muted-foreground">
          No calendar connected. Connect Google Calendar or Outlook Calendar in One to see it here.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {calQ.data.calendars.map((c) => (
            <div key={c.id} className="flex h-12 items-center gap-3 border-b border-border px-4 last:border-b-0">
              <span className="min-w-0 flex-1 truncate text-13">{c.name}</span>
              {c.isDefault && <span className="text-11 text-muted-foreground">Default for new events</span>}
              {!c.isDefault && (
                <button type="button" onClick={() => updateCal.mutate({ calendarId: c.id, patch: { isDefault: true } })} className="text-11 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                  Make default
                </button>
              )}
              <label className="flex items-center gap-1.5 text-11 text-muted-foreground">
                Counts for availability
                <Switch label="Counts for availability" checked={c.countsForAvailability} onChange={(v) => updateCal.mutate({ calendarId: c.id, patch: { countsForAvailability: v } })} />
              </label>
              <label className="flex items-center gap-1.5 text-11 text-muted-foreground">
                Show
                <Switch label="Show" checked={c.shown} onChange={(v) => updateCal.mutate({ calendarId: c.id, patch: { shown: v } })} />
              </label>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-lg border border-border bg-card px-4">
        <SettingRow label="Today rail" hint="A one-day timeline beside your mail at 1280px and up.">
          <Switch label="Today rail" checked={s.todayRail} onChange={(v) => settingsMut.mutate({ todayRail: v })} />
        </SettingRow>
        {confQ.data && confQ.data.available.length > 0 && (
          <SettingRow label="Meeting link" hint="Preselected in New event. Only what your One grant has is listed.">
            <Tabs
              size="sm"
              value={s.defaultConferencing && confQ.data.available.includes(s.defaultConferencing) ? s.defaultConferencing : "none"}
              onChange={(v) => settingsMut.mutate({ defaultConferencing: v === "none" ? null : v })}
              options={[...confQ.data.available.map((p) => ({ key: p, label: CONF_LABEL[p] })), { key: "none" as const, label: "None" }]}
            />
          </SettingRow>
        )}
        <SettingRow label="Secondary time zone" hint="Shown alongside your own on events and invites, when different.">
          <Input value={s.secondaryTimezone ?? ""} onChange={(e) => settingsMut.mutate({ secondaryTimezone: e.target.value || null })} placeholder="e.g. Europe/London" className="w-[220px]" />
        </SettingRow>
        <SettingRow label="Working hours" hint="Used by conflicts and Offer times.">
          <div className="flex items-center gap-1.5">
            <Input type="time" value={timeFromMinutes(s.workingHours.startMinute)} onChange={(e) => settingsMut.mutate({ workingHours: { ...s.workingHours, startMinute: minutesFromTime(e.target.value) } })} className="tnum w-[110px]" />
            <span className="text-xs text-muted-foreground">to</span>
            <Input type="time" value={timeFromMinutes(s.workingHours.endMinute)} onChange={(e) => settingsMut.mutate({ workingHours: { ...s.workingHours, endMinute: minutesFromTime(e.target.value) } })} className="tnum w-[110px]" />
          </div>
        </SettingRow>
        <SettingRow label="Working days">
          <div className="flex gap-1">
            {DAY_LABEL.map((d, i) => (
              <button
                key={d}
                type="button"
                onClick={() => toggleDay(i)}
                aria-pressed={s.workingHours.days.includes(i)}
                className={`flex size-7 items-center justify-center rounded-md text-11 font-medium transition-colors ${s.workingHours.days.includes(i) ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-card-hover"}`}
              >
                {d[0]}
              </button>
            ))}
          </div>
        </SettingRow>
      </div>
    </div>
  );
}
