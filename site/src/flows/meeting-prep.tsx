import { useEffect, useState } from "react";
import { useAction, runAction, openLink, timeAgo, Page, Card, Section, Tabs, List, Row, Badge, Button, Avatar, Field, Textarea, EmptyState, ErrorState, Skeleton } from "@forkable/ui";
import { Clock, ExternalLink, Users, FileText } from "lucide-react";

const LIST_EVENTS = "conn_mod_def::GJ6RlnIYK20::YzuWSmaVQgurletRDNJavA"; // google-calendar, List a Calendar's Events (read)
const GET_THREADS = "conn_mod_def::GGSNlnppgZ0::qk3CudDWTVKPY7hpPVCqLQ"; // gmail, List and View Email Threads (read)
const CREATE_DRAFT = "conn_mod_def::GGZUe0SIuk8::nhwEKp2cQ6uARsH3513VeQ"; // gmail, Create Draft (write)

type Guest = { email: string; displayName?: string; self?: boolean; organizer?: boolean; responseStatus?: string };
type Event = { id: string; summary: string; description?: string; hangoutLink?: string; start: { dateTime: string }; attendees?: Guest[] };
type Msg = { sender: string; receiver: string; subject: string; snippet: string; labelIds: string[]; internalDate: string };
type Thread = { id: string; messages: Msg[] };

const emailOf = (s: string) => (s.match(/<(.+)>/)?.[1] ?? s).toLowerCase();
const inMinutes = (iso: string) => Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
const until = (m: number) => (m < 60 ? `in ${m} min` : `in ${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ""}`.trim());

export default function MeetingPrep() {
  const [win] = useState(() => ({ min: new Date().toISOString(), max: new Date(Date.now() + 24 * 3600_000).toISOString() }));
  const cal = useAction<{ items: Event[] }>(LIST_EVENTS, { pathParams: { calendarId: "primary" }, query: { timeMin: win.min, timeMax: win.max, singleEvents: "true", orderBy: "startTime" } });
  const next = (cal.data?.items ?? []).find((e) => (e.attendees ?? []).filter((a) => !a.self).length > 1);
  const guests = (next?.attendees ?? []).filter((a) => !a.self);
  const people = guests.map((g) => g.email.toLowerCase());
  const mail = useAction<{ threads: Thread[] }>(next ? GET_THREADS : null, {
    body: { query: `{${people.map((e) => `from:${e} to:${e}`).join(" ")}} newer_than:30d`, numberOfThreads: 30, maxBodyLength: 300 },
  });
  const [who, setWho] = useState("");
  const [agenda, setAgenda] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const threads = mail.data?.threads ?? [];
  const withGuest = (email: string) => threads.filter((t) => t.messages.some((m) => emailOf(m.sender) === email || m.receiver.toLowerCase().includes(email)));
  const owes = (t: Thread) => {
    const last = t.messages.at(-1)!;
    return last.labelIds.includes("UNREAD") && people.includes(emailOf(last.sender));
  };
  const open = threads.filter(owes);
  const current = who || people[0] || "";

  // Start the agenda from what is still open with the guests.
  useEffect(() => {
    if (!next || !mail.data || agenda) return;
    const lines = open.map((t, i) => {
      const g = guests.find((x) => x.email.toLowerCase() === emailOf(t.messages.at(-1)!.sender));
      return `${i + 1}. ${t.messages[0]!.subject.replace(/^Re:\s*/i, "")} (${g?.displayName ?? "guest"})`;
    });
    setAgenda([`Agenda for ${next.summary}`, "", ...lines, `${lines.length + 1}. Anything else`].join("\n"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next?.id, mail.data]);

  const save = async () => {
    if (!next) return;
    setSaving(true);
    try {
      await runAction(CREATE_DRAFT, { body: { to: people.join(", "), subject: `Agenda: ${next.summary}`, body: agenda } });
      setNote("Draft saved in Gmail. Send it from there when you are ready.");
    } catch (e: any) {
      setNote(e.refused === "cancelled" ? "Nothing was saved." : e.message);
    } finally {
      setSaving(false);
    }
  };

  if (cal.error) return <Page><ErrorState error={cal.error} onRetry={cal.reload} /></Page>;
  if (cal.loading) return <Page><Skeleton className="h-40 w-full" /></Page>;
  if (!next) return <Page><EmptyState icon={<Clock />} title="No meetings with guests in the next day" /></Page>;

  return (
    <Page
      title={next.summary}
      description={`${new Date(next.start.dateTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}, ${until(inMinutes(next.start.dateTime))}. ${next.description ?? ""}`}
      actions={next.hangoutLink ? <Button size="sm" variant="secondary" onClick={() => openLink(next.hangoutLink!)}><ExternalLink />Join</Button> : undefined}
    >
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-1.5 text-11 text-muted-foreground"><Users className="size-3.5" />{guests.length} guests</span>
          {guests.map((g) => (
            <span key={g.email} className="flex items-center gap-1.5 text-13">
              <Avatar name={g.displayName ?? g.email} size="sm" />
              {g.displayName ?? g.email}
              {g.organizer && <Badge>Organizer</Badge>}
            </span>
          ))}
        </div>
      </Card>

      <Section title="Last 30 days with each guest" description={mail.loading ? "Reading Gmail" : `${open.length} waiting on you`}>
        <Tabs value={current} onChange={setWho} tabs={guests.map((g) => ({ id: g.email.toLowerCase(), label: (g.displayName ?? g.email).split(" ")[0]!, count: mail.loading ? undefined : withGuest(g.email.toLowerCase()).length }))} />
        {mail.error ? (
          <ErrorState error={mail.error} onRetry={mail.reload} />
        ) : mail.loading ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <List empty={<EmptyState title="No mail with them this month" compact />}>
            {withGuest(current).map((t) => {
              const last = t.messages.at(-1)!;
              return (
                <Row
                  key={t.id}
                  strong={owes(t)}
                  title={t.messages[0]!.subject}
                  meta={last.snippet}
                  trailing={<>{owes(t) && <Badge variant="accent">You owe a reply</Badge>}{timeAgo(Number(last.internalDate))}</>}
                />
              );
            })}
          </List>
        )}
      </Section>

      <Section title="Agenda" description="Built from what is still open. Edit it, then save it as a draft to the guests.">
        <Field label="Draft to all guests">
          <Textarea rows={6} value={agenda} onChange={(e) => setAgenda(e.target.value)} />
        </Field>
        <div className="flex items-center gap-2">
          <Button variant="primary" loading={saving} onClick={save} disabled={!agenda}><FileText />Save as Gmail draft</Button>
          <span className="text-11 text-muted-foreground">You confirm before it is saved. Nothing is sent.</span>
        </div>
        {note && <p role="status" className="m-0 text-13 text-muted-foreground">{note}</p>}
      </Section>
    </Page>
  );
}
