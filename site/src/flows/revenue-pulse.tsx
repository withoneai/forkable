import { useState } from "react";
import { useAction, runAction, timeAgo, Page, Section, StatGrid, Stat, Toolbar, Spacer, Tabs, List, Row, Badge, Button, AppLogo, EmptyState, ErrorState, Skeleton } from "@forkable/ui";
import { DollarSign, CreditCard, AlertCircle, Users, FileText } from "lucide-react";

const LIST_SUBSCRIPTIONS = "conn_mod_def::GJ7Ku75hXu8::mfT7dYOYQQCoxlI7D5uKIw"; // stripe, List Subscriptions (read)
const LIST_CHARGES = "conn_mod_def::GJ7Kr4ILxto::NkTwzYCqS7a2-axG_Yro0A"; // stripe, List Charges (read)
const GET_INVOICES = "conn_mod_def::GHKYu29sSoM::c1XPIp6wQHmmkmMSvSfvXQ"; // stripe, Get Invoices (read)
const CREATE_DRAFT = "conn_mod_def::GGZUe0SIuk8::nhwEKp2cQ6uARsH3513VeQ"; // gmail, Create Draft (write)

type Sub = { id: string; status: string; created: number; items: { data: { quantity: number; price: { unit_amount: number; recurring: { interval: "month" | "year" } } }[] } };
type Charge = { id: string; amount: number; status: string; created: number; description: string; failure_message: string | null; billing_details: { name: string; email: string } };
type Invoice = { id: string; number: string; amount_remaining: number; customer_name: string; customer_email: string; due_date: number; hosted_invoice_url: string };

const usd = (cents: number) => "$" + (cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 });
const monthly = (s: Sub) => s.items.data.reduce((sum, i) => sum + (i.price.unit_amount * i.quantity) / (i.price.recurring.interval === "year" ? 12 : 1), 0);

export default function RevenuePulse() {
  const [since] = useState(() => Math.floor(Date.now() / 1000) - 30 * 86_400);
  const subs = useAction<{ data: Sub[] }>(LIST_SUBSCRIPTIONS, { query: { status: "all", limit: "100" } });
  const charges = useAction<{ data: Charge[] }>(LIST_CHARGES, { query: { limit: "100", "created[gte]": String(since) } });
  const invoices = useAction<{ invoices: Invoice[] }>(GET_INVOICES, { body: { status: "open", limit: 50 } });
  const [tab, setTab] = useState("chase");
  const [drafted, setDrafted] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState("");

  const live = (subs.data?.data ?? []).filter((s) => s.status === "active" || s.status === "past_due");
  const mrr = live.reduce((sum, s) => sum + monthly(s), 0);
  const fresh = live.filter((s) => s.created >= since).length;
  const all = charges.data?.data ?? [];
  const paid = all.filter((c) => c.status === "succeeded");
  const failed = all.filter((c) => c.status === "failed");
  const overdue = (invoices.data?.invoices ?? []).filter((i) => i.due_date * 1000 < Date.now());

  // Collected per day for the last 14 days, oldest first.
  const day = 86_400_000;
  const start = new Date().setHours(0, 0, 0, 0) - 13 * day;
  const bars = Array.from({ length: 14 }, (_, i) => paid.filter((c) => c.created * 1000 >= start + i * day && c.created * 1000 < start + (i + 1) * day).reduce((s, c) => s + c.amount, 0));
  const top = Math.max(1, ...bars);

  const remind = async (inv: Invoice) => {
    try {
      await runAction(CREATE_DRAFT, {
        body: {
          to: inv.customer_email,
          subject: `Invoice ${inv.number} from Acme Inc`,
          body: `Hi ${inv.customer_name} team,\n\nYour payment of ${usd(inv.amount_remaining)} for invoice ${inv.number} did not go through. You can pay it here:\n${inv.hosted_invoice_url}\n\nThanks,\nDana`,
        },
      });
      setDrafted((d) => ({ ...d, [inv.id]: true }));
      setNote(`Reminder for ${inv.customer_name} saved in Gmail Drafts.`);
    } catch (e: any) {
      setNote(e.refused === "cancelled" ? "Nothing was saved." : e.message);
    }
  };

  const err = subs.error ?? charges.error ?? invoices.error;
  if (err) return <Page><ErrorState error={err} onRetry={() => (subs.reload(), charges.reload(), invoices.reload())} /></Page>;
  const loading = subs.loading || charges.loading || invoices.loading;

  return (
    <Page title="Revenue pulse" description="Stripe, last 30 days. Reminders are saved as Gmail drafts, never sent from here." icon={<AppLogo platform="stripe" />}>
      <StatGrid cols={4}>
        <Stat label="MRR" icon={<DollarSign />} value={loading ? "-" : usd(mrr)} hint={`${live.length} paying`} />
        <Stat label="Collected" icon={<CreditCard />} value={loading ? "-" : usd(paid.reduce((s, c) => s + c.amount, 0))} hint={`${paid.length} payments`} />
        <Stat label="Failed" icon={<AlertCircle />} value={loading ? "-" : failed.length} tone="negative" delta={failed.length ? usd(failed.reduce((s, c) => s + c.amount, 0)) : undefined} />
        <Stat label="New subscriptions" icon={<Users />} value={loading ? "-" : fresh} tone="positive" delta={fresh ? `+${usd(live.filter((s) => s.created >= since).reduce((s, x) => s + monthly(x), 0))} MRR` : undefined} />
      </StatGrid>

      <Section title="Collected per day" description="Last 14 days">
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="flex h-24 items-end gap-1 rounded-lg border border-border bg-card p-2" role="img" aria-label="Collected per day, last 14 days">
            {bars.map((v, i) => (
              <div key={i} title={usd(v)} className={i === 13 ? "flex-1 rounded-sm bg-primary" : "flex-1 rounded-sm bg-strong"} style={{ height: `${Math.max(4, (v / top) * 100)}%` }} />
            ))}
          </div>
        )}
      </Section>

      <Section title="Who to chase">
        <Toolbar>
          <Tabs value={tab} onChange={setTab} tabs={[{ id: "chase", label: "Overdue", count: overdue.length }, { id: "failed", label: "Failed charges", count: failed.length }]} />
          <Spacer />
        </Toolbar>
        {loading ? (
          <Skeleton className="h-28 w-full" />
        ) : tab === "chase" ? (
          <List empty={<EmptyState title="Nothing overdue" compact />}>
            {overdue.map((inv) => (
              <Row
                key={inv.id}
                leading={<AppLogo platform="stripe" size="sm" />}
                title={inv.customer_name}
                meta={`${inv.number}, due ${timeAgo(inv.due_date)} ago, ${inv.customer_email}`}
                trailing={
                  <>
                    <span className="tabular-nums text-foreground">{usd(inv.amount_remaining)}</span>
                    {drafted[inv.id] ? <Badge variant="accent">Drafted</Badge> : <Button size="sm" variant="secondary" onClick={() => remind(inv)}><FileText />Draft reminder</Button>}
                  </>
                }
              />
            ))}
          </List>
        ) : (
          <List empty={<EmptyState title="No failed charges" compact />}>
            {failed.map((c) => (
              <Row key={c.id} title={c.billing_details.name} meta={`${c.failure_message ?? "Failed"}, ${timeAgo(c.created)} ago`} trailing={<><Badge variant="danger">Failed</Badge><span className="tabular-nums text-foreground">{usd(c.amount)}</span></>} />
            ))}
          </List>
        )}
        {note && <p role="status" className="m-0 text-13 text-muted-foreground">{note}</p>}
      </Section>
    </Page>
  );
}
