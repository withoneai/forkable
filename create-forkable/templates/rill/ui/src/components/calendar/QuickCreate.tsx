import { useEffect, useMemo, useState } from "react";
import { Video } from "lucide-react";
import type { ConferencingProvider } from "@rill/core/types";
import { useConferencing, useContacts, useCreateEvent } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { fmtDay, fmtRange } from "@/lib/calendarLayout";
import { parsePlainLanguageEvent } from "@/lib/plainLanguageEvent";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Field, Input } from "../ui/Input";
import { Tabs } from "../ui/Tabs";
import { AttendeeInput, type Attendee } from "./AttendeeInput";

export interface QuickCreateRange { start: Date; end: Date }

const CONF_LABEL: Record<ConferencingProvider, string> = { "google-meet": "Google Meet", teams: "Teams", zoom: "Zoom" };

export function QuickCreate({
  mailboxId, open, onClose, tz, initialRange, fromThreadId,
}: {
  mailboxId: string; open: boolean; onClose: () => void; tz: string; initialRange?: QuickCreateRange | null; fromThreadId?: string;
}) {
  const create = useCreateEvent(mailboxId);
  const [text, setText] = useState("");
  const [range, setRange] = useState<QuickCreateRange | null>(null);
  // Only providers the grant has show up; the settings default is preselected when it is one of them.
  const confQ = useConferencing(mailboxId, open);
  const offered = confQ.data?.available ?? [];
  const [conf, setConf] = useState<ConferencingProvider | "none">("none");
  const [confTouched, setConfTouched] = useState(false);
  useEffect(() => { if (open && !confTouched && confQ.data) setConf(confQ.data.default ?? "none"); }, [open, confTouched, confQ.data]);
  const [attendees, setAttendees] = useState<Attendee[]>([]);

  useEffect(() => {
    if (!open) return;
    if (initialRange) { setRange(initialRange); setText(""); }
    else { setText(""); setRange(null); }
    setAttendees([]);
    setConfTouched(false);
  }, [open, initialRange]);

  useEffect(() => {
    if (initialRange) return; // the drag range already picked a time; typing only sets the title
    if (!text.trim()) { setRange(null); return; }
    const parsed = parsePlainLanguageEvent(text, new Date(), tz);
    setRange({ start: parsed.start, end: parsed.end });
  }, [text, initialRange, tz]);

  const parsed = useMemo(() => parsePlainLanguageEvent(text || "New event", new Date(), tz), [text, tz]);
  const title = initialRange ? text.trim() || "New event" : parsed.title;

  // "lunch w/ Priya" adds the best-matching contact as a chip. Removing that chip
  // keeps it removed; nothing is sent until Create.
  const withName = initialRange ? null : parsed.withName;
  const withQ = useContacts(mailboxId, withName ?? "", !!withName && open);
  const [auto, setAuto] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  useEffect(() => { if (open) { setAuto(null); setDismissed(new Set()); } }, [open]);
  useEffect(() => {
    const first = withName?.toLowerCase().split(/\s+/)[0] ?? "";
    const hit = withName ? withQ.data?.contacts.find((c) => (c.name ?? "").toLowerCase().split(/\s+/)[0]?.startsWith(first)) : undefined;
    const want = hit && !dismissed.has(hit.email) ? hit : null;
    if ((want?.email ?? null) === auto) return;
    setAttendees((cur) => {
      const kept = cur.filter((a) => a.email !== auto);
      return want && !kept.some((a) => a.email === want.email) ? [...kept, { email: want.email, name: want.name }] : kept;
    });
    setAuto(want?.email ?? null);
  }, [withName, withQ.data, dismissed]); // eslint-disable-line react-hooks/exhaustive-deps
  const changeAttendees = (next: Attendee[]) => {
    if (auto && !next.some((a) => a.email === auto)) { setDismissed((d) => new Set(d).add(auto)); setAuto(null); }
    setAttendees(next);
  };

  const save = () => {
    if (!range) return;
    const emails = attendees.map((a) => a.email);
    create.mutate(
      { title, start: range.start.toISOString(), end: range.end.toISOString(), timeZone: tz, attendees: emails, attendeeNames: Object.fromEntries(attendees.filter((a) => a.name).map((a) => [a.email, a.name!])), conferencing: conf === "none" ? null : conf, fromThreadId },
      {
        onSuccess: () => { toast({ title: "Event created", detail: title }); onClose(); },
        onError: (e) => toast({ title: "Not created", detail: e.message, tone: "destructive" }),
      },
    );
  };

  return (
    <Dialog open={open} onClose={onClose} title="New event" size="sm">
      <div className="flex flex-col gap-3 p-4">
        <Field label={initialRange ? "Title" : "Describe it"} hint={initialRange ? undefined : "lunch w/ Priya thu 1pm"}>
          <Input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={initialRange ? "Title" : "lunch w/ Priya thu 1pm"} onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
        </Field>
        {range && (
          <div className="rounded-md border border-border bg-faint px-3 py-2 text-13">
            <p className="font-medium">{title}</p>
            <p className="text-xs text-muted-foreground">{fmtDay(range.start.toISOString(), tz)} · {fmtRange(range.start.toISOString(), range.end.toISOString(), tz)}</p>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <span className="text-11 font-medium text-muted-foreground">People</span>
          <AttendeeInput mailboxId={mailboxId} value={attendees} onChange={changeAttendees} />
        </div>
        {offered.length > 0 && (
          <div className="flex items-center justify-between gap-3 py-1">
            <span className="flex items-center gap-1.5 text-13"><Video className="size-3.5 text-muted-foreground" /> Meeting link</span>
            <Tabs
              size="sm"
              value={conf}
              onChange={(v) => { setConf(v); setConfTouched(true); }}
              options={[...offered.map((p) => ({ key: p, label: CONF_LABEL[p] })), { key: "none" as const, label: "None" }]}
            />
          </div>
        )}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!range} loading={create.isPending} onClick={save}>Create</Button>
      </div>
    </Dialog>
  );
}
