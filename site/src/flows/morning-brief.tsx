import { useState } from "react";
import { useAction, openLink, timeAgo, Page, Section, StatGrid, Stat, Tabs, Toolbar, Spacer, List, Row, Badge, Button, Avatar, AppLogo, EmptyState, ErrorState, Skeleton } from "@forkable/ui";
import { Calendar, Mail, DollarSign, ExternalLink } from "lucide-react";

const GET_THREADS = "conn_mod_def::GGSNlnppgZ0::qk3CudDWTVKPY7hpPVCqLQ"; // gmail, List and View Email Threads (read)
const LIST_EVENTS = "conn_mod_def::GJ6RlnIYK20::YzuWSmaVQgurletRDNJavA"; // google-calendar, List a Calendar's Events (read)
const LIST_CHARGES = "conn_mod_def::GJ7Kr4ILxto::NkTwzYCqS7a2-axG_Yro0A"; // stripe, List Charges (read)

type Msg = { sender: string; subject: string; snippet: string; labelIds: string[]; internalDate: string };
type Thread = { id: string; messages: Msg[] };
type Event = { id: string; summary: string; start: { dateTime: string }; end: { dateTime: string }; hangoutLink?: string; location?: string; attendees?: { email: string; self?: boolean }[] };
type Charge = { id: string; amount: number; status: string; created: number; description: string; failure_message: string | null; billing_details: { name: string } };

const who = (s: string) => s.replace(/\s*<.*>$/, "").replace(/"/g, "");
const usd = (cents: number) => "$" + (cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 });
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export default function MorningBrief() {
  // Fixed once, so the inputs (and the calls) do not change on every render.
  const [win] = useState(() => {
    const now = Date.now();
    return { min: new Date(now - 3 * 3600_000).toISOString(), max: new Date(now + 18 * 3600_000).toISOString(), since: String(Math.floor(now / 1000) - 86_400) };
  });
  const events = useAction<{ items: Event[] }>(LIST_EVENTS, { pathParams: { calendarId: "primary" }, query: { timeMin: win.min, timeMax: win.max, singleEvents: "true", orderBy: "startTime" } });
  const mail = useAction<{ threads: Thread[] }>(GET_THREADS, { body: { label: "INBOX", query: "is:unread -category:promotions newer_than:3d", numberOfThreads: 20, maxBodyLength: 200 } });
  const charges = useAction<{ data: Charge[] }>(LIST_CHARGES, { query: { limit: "100", "created[gte]": win.since } });
  const [tab, setTab] = useState("people");

  const upcoming = (events.data?.items ?? []).filter((e) => new Date(e.end.dateTime).getTime() > Date.now());
  const threads = mail.data?.threads ?? [];
  const internal = threads.filter((t) => t.messages.at(-1)!.sender.includes("@acme.com"));
  const shown = tab === "team" ? internal : threads.filter((t) => !internal.includes(t));
  const paid = (charges.data?.data ?? []).filter((c) => c.status === "succeeded");
  const failed = (charges.data?.data ?? []).filter((c) => c.status === "failed");

  return (
    <Page title="This morning" description="Your next meetings, the mail that needs you, and Stripe since yesterday.">
      <StatGrid cols={3}>
        <Stat label="Meetings left" icon={<Calendar />} value={events.loading ? "-" : upcoming.length} hint="next 18 hours" />
        <Stat label="Need a reply" icon={<Mail />} value={mail.loading ? "-" : threads.length} hint="unread, last 3 days" />
        <Stat
          label="Stripe, 24 hours"
          icon={<DollarSign />}
          value={charges.loading ? "-" : usd(paid.reduce((s, c) => s + c.amount, 0))}
          delta={failed.length ? `${failed.length} failed` : undefined}
          tone={failed.length ? "negative" : "neutral"}
          hint={failed.length ? undefined : `${paid.length} payments`}
        />
      </StatGrid>

      <Section title="Next up">
        {events.error ? (
          <ErrorState error={events.error} onRetry={events.reload} />
        ) : events.loading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <List empty={<EmptyState title="Nothing else today" compact />}>
            {upcoming.slice(0, 4).map((e) => {
              const guests = (e.attendees ?? []).filter((a) => !a.self).length;
              const link = e.hangoutLink ?? (e.location?.startsWith("http") ? e.location : undefined);
              return (
                <Row
                  key={e.id}
                  leading={<span className="w-16 text-11 tabular-nums text-muted-foreground">{clock(e.start.dateTime)}</span>}
                  title={e.summary}
                  meta={guests ? `${guests} ${guests === 1 ? "guest" : "guests"}` : e.location ?? "Just you"}
                  trailing={link ? <Button size="sm" variant="secondary" onClick={() => openLink(link)}><ExternalLink />Join</Button> : undefined}
                />
              );
            })}
          </List>
        )}
      </Section>

      <Section title="Needs you">
        <Toolbar>
          <Tabs value={tab} onChange={setTab} tabs={[{ id: "people", label: "Outside", count: threads.length - internal.length }, { id: "team", label: "Team", count: internal.length }]} />
          <Spacer />
          <AppLogo platform="gmail" size="sm" />
        </Toolbar>
        {mail.error ? (
          <ErrorState error={mail.error} onRetry={mail.reload} />
        ) : mail.loading ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <List empty={<EmptyState title="Inbox zero here" compact />}>
            {shown.slice(0, 5).map((t) => {
              const last = t.messages.at(-1)!;
              return <Row key={t.id} strong leading={<Avatar name={who(last.sender)} size="sm" />} title={last.subject} meta={who(last.sender)} trailing={timeAgo(Number(last.internalDate))} />;
            })}
          </List>
        )}
      </Section>

      <Section title="Stripe since yesterday">
        {charges.error ? (
          <ErrorState error={charges.error} onRetry={charges.reload} />
        ) : charges.loading ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <List empty={<EmptyState title="No payments yet today" compact />}>
            {[...failed, ...paid].slice(0, 4).map((c) => (
              <Row
                key={c.id}
                leading={<AppLogo platform="stripe" size="sm" />}
                title={c.billing_details.name}
                meta={c.failure_message ?? c.description}
                trailing={
                  <>
                    {c.status === "failed" && <Badge variant="danger">Failed</Badge>}
                    <span className="tabular-nums text-foreground">{usd(c.amount)}</span>
                  </>
                }
              />
            ))}
          </List>
        )}
      </Section>
    </Page>
  );
}
