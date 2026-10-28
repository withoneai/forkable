import { useState } from "react";
import { useAction, runAction, Page, Section, StatGrid, Stat, Toolbar, Spacer, Tabs, List, Row, Badge, Button, Avatar, Field, Textarea, EmptyState, ErrorState, Skeleton } from "@forkable/ui";
import { Send, Clock, Mail, RefreshCw } from "lucide-react";

const GET_THREADS = "conn_mod_def::GGSNlnppgZ0::qk3CudDWTVKPY7hpPVCqLQ"; // gmail, List and View Email Threads (read)
const SEND_EMAIL = "conn_mod_def::GGXAjWkZO8U::uMc1LQIHTTKzeMm3rLL5gQ"; // gmail, Send Email (write)

type Msg = { receiver: string; subject: string; body: string; labelIds: string[]; internalDate: string };
type Thread = { id: string; messages: Msg[] };

const days = (ms: string) => Math.floor((Date.now() - Number(ms)) / 86_400_000);
const nameFrom = (email: string) => email.split("@")[0]!.split(/[._-]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

export default function FollowUpRadar() {
  const { data, loading, error, reload } = useAction<{ threads: Thread[] }>(GET_THREADS, { body: { query: "in:sent newer_than:30d", numberOfThreads: 50, maxBodyLength: 400 } });
  const [tab, setTab] = useState("stale");
  const [picked, setPicked] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [nudged, setNudged] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  // Waiting means you wrote last and nobody answered.
  const waiting = (data?.threads ?? [])
    .filter((t) => t.messages.at(-1)!.labelIds.includes("SENT"))
    .map((t) => ({ t, last: t.messages.at(-1)!, age: days(t.messages.at(-1)!.internalDate) }))
    .sort((a, b) => b.age - a.age);
  const stale = waiting.filter((w) => w.age >= 3);
  const shown = tab === "stale" ? stale : waiting;
  const current = waiting.find((w) => w.t.id === picked);

  const pick = (id: string) => {
    const w = waiting.find((x) => x.t.id === id)!;
    setPicked(id);
    setNote("");
    setText(`Hi ${nameFrom(w.last.receiver).split(" ")[0]},\n\nJust bringing this back to the top of your inbox. Any thoughts on "${w.last.subject}"?\n\nThanks,\nDana`);
  };

  const send = async () => {
    if (!current) return;
    setBusy(true);
    try {
      await runAction(SEND_EMAIL, { body: { to: current.last.receiver, subject: current.last.subject, body: text, threadId: current.t.id } });
      setNudged((n) => ({ ...n, [current.t.id]: true }));
      setNote(`Nudge sent to ${current.last.receiver}.`);
      setPicked(null);
    } catch (e: any) {
      setNote(e.refused === "cancelled" ? "Nothing was sent." : e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title="Follow-up radar" description="Mail you sent in the last 30 days that never got a reply." actions={<Button size="sm" variant="secondary" onClick={reload}><RefreshCw />Refresh</Button>}>
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : (
        <>
          <StatGrid cols={3}>
            <Stat label="Waiting on a reply" icon={<Mail />} value={loading ? "-" : waiting.length} />
            <Stat label="Oldest" icon={<Clock />} value={loading ? "-" : `${waiting[0]?.age ?? 0}d`} tone="negative" delta={stale.length ? `${stale.length} over 3 days` : undefined} />
            <Stat label="Nudged today" icon={<Send />} value={Object.keys(nudged).length} />
          </StatGrid>
          <Section title="Waiting">
            <Toolbar>
              <Tabs value={tab} onChange={setTab} tabs={[{ id: "stale", label: "3 days or more", count: stale.length }, { id: "all", label: "All", count: waiting.length }]} />
              <Spacer />
            </Toolbar>
            {loading ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <List empty={<EmptyState title="Everyone wrote back" compact />}>
                {shown.map(({ t, last, age }) => (
                  <Row
                    key={t.id}
                    selected={picked === t.id}
                    onClick={nudged[t.id] ? undefined : () => pick(t.id)}
                    leading={<Avatar name={nameFrom(last.receiver)} size="sm" />}
                    title={last.subject}
                    meta={`To ${last.receiver}`}
                    trailing={nudged[t.id] ? <Badge variant="accent">Nudged</Badge> : <Badge variant={age >= 7 ? "danger" : "neutral"}>{age === 0 ? "today" : `${age}d`}</Badge>}
                  />
                ))}
              </List>
            )}
          </Section>
          {current && (
            <Section title={`Nudge ${current.last.receiver}`} description="Goes out as a reply in the same Gmail thread.">
              <Field label="Message">
                <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} />
              </Field>
              <div className="flex items-center gap-2">
                <Button variant="primary" loading={busy} onClick={send}><Send />Send nudge</Button>
                <Button onClick={() => setPicked(null)}>Cancel</Button>
                <span className="text-11 text-muted-foreground">You confirm before it sends.</span>
              </div>
            </Section>
          )}
          {note && <p role="status" className="m-0 text-13 text-muted-foreground">{note}</p>}
        </>
      )}
    </Page>
  );
}
