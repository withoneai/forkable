import { useState } from "react";
import { useAction, runAction, timeAgo, Page, Section, StatGrid, Stat, Toolbar, Spacer, Tabs, List, Row, Badge, Button, Avatar, EmptyState, ErrorState, Skeleton } from "@forkable/ui";
import { Archive, Inbox, Users, Mail, Check } from "lucide-react";

const GET_THREADS = "conn_mod_def::GGSNlnppgZ0::qk3CudDWTVKPY7hpPVCqLQ"; // gmail, List and View Email Threads (read)
const BATCH_MODIFY = "conn_mod_def::GJ3ocX2edTU::mhLdczGoT2O9KVIUEjp8xw"; // gmail, Batch Modify a User's Gmail Messages (Labels) (write)

type Msg = { sender: string; messageId: string; labelIds: string[]; internalDate: string };
type Thread = { id: string; messages: Msg[] };
type Sender = { email: string; name: string; threads: Thread[]; unread: number; last: number; bulk: boolean };

const BULK = /^(hello|digest|newsletter|notes|news|updates|no-?reply)@/;

function bySender(threads: Thread[]): Sender[] {
  const map = new Map<string, Sender>();
  for (const t of threads) {
    const m = t.messages.at(-1)!;
    const email = (m.sender.match(/<(.+)>/)?.[1] ?? m.sender).toLowerCase();
    const s = map.get(email) ?? { email, name: m.sender.replace(/\s*<.*>$/, ""), threads: [], unread: 0, last: 0, bulk: false };
    s.threads.push(t);
    if (m.labelIds.includes("UNREAD")) s.unread++;
    s.last = Math.max(s.last, Number(m.internalDate));
    s.bulk ||= BULK.test(email) || m.labelIds.includes("CATEGORY_PROMOTIONS");
    map.set(email, s);
  }
  return [...map.values()].sort((a, b) => b.threads.length - a.threads.length || b.last - a.last);
}

export default function InboxCleanup() {
  const { data, loading, error, reload } = useAction<{ threads: Thread[] }>(GET_THREADS, { body: { label: "INBOX", numberOfThreads: 100, format: "metadata" } });
  const [tab, setTab] = useState("bulk");
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const senders = bySender(data?.threads ?? []);
  const bulk = senders.filter((s) => s.bulk);
  const people = senders.filter((s) => !s.bulk);
  const shown = tab === "bulk" ? bulk : tab === "people" ? people : senders;
  const chosen = senders.filter((s) => picked[s.email]);
  const count = chosen.reduce((n, s) => n + s.threads.length, 0);

  const archive = async () => {
    const ids = chosen.flatMap((s) => s.threads.flatMap((t) => t.messages.map((m) => m.messageId)));
    setBusy(true);
    try {
      await runAction(BATCH_MODIFY, { pathParams: { userId: "me" }, body: { ids, removeLabelIds: ["INBOX"] } });
      setNote(`Archived ${count} threads from ${chosen.length} ${chosen.length === 1 ? "sender" : "senders"}. They are still in All Mail.`);
      setPicked({});
      reload();
    } catch (e: any) {
      setNote(e.refused === "cancelled" ? "Nothing was archived." : e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title="Inbox by sender" description="Who fills your inbox. Pick senders and archive everything from them in one go.">
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : (
        <>
          <StatGrid cols={3}>
            <Stat label="In your inbox" icon={<Inbox />} value={loading ? "-" : data?.threads.length ?? 0} hint="threads" />
            <Stat label="Senders" icon={<Users />} value={loading ? "-" : senders.length} />
            <Stat label="From newsletters" icon={<Mail />} value={loading ? "-" : bulk.reduce((n, s) => n + s.threads.length, 0)} hint={`${bulk.length} senders`} />
          </StatGrid>
          <Section title="Senders">
            <Toolbar>
              <Tabs value={tab} onChange={setTab} tabs={[{ id: "bulk", label: "Newsletters", count: bulk.length }, { id: "people", label: "People", count: people.length }, { id: "all", label: "All", count: senders.length }]} />
              <Spacer />
              <Button size="sm" variant="ghost" onClick={() => setPicked(Object.fromEntries(shown.map((s) => [s.email, true])))}>Pick all</Button>
              <Button size="sm" variant="primary" disabled={!count} loading={busy} onClick={archive}><Archive />{count ? `Archive ${count}` : "Archive"}</Button>
            </Toolbar>
            {loading ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <List empty={<EmptyState title="Nobody here" compact />}>
                {shown.map((s) => (
                  <Row
                    key={s.email}
                    selected={!!picked[s.email]}
                    onClick={() => setPicked((p) => ({ ...p, [s.email]: !p[s.email] }))}
                    leading={picked[s.email] ? <Check /> : <Avatar name={s.name} size="sm" />}
                    title={s.name}
                    meta={`${s.email}, last ${timeAgo(s.last)}`}
                    trailing={
                      <>
                        {s.unread > 0 && <Badge>{s.unread} unread</Badge>}
                        <span className="tabular-nums text-foreground">{s.threads.length}</span>
                      </>
                    }
                  />
                ))}
              </List>
            )}
            <p className="m-0 text-11 text-muted-foreground">Archiving only removes the Inbox label. You confirm first.</p>
            {note && <p role="status" className="m-0 text-13 text-muted-foreground">{note}</p>}
          </Section>
        </>
      )}
    </Page>
  );
}
