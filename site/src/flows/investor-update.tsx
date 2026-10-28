import { useEffect, useState } from "react";
import { useAction, runAction, Page, Section, StatGrid, Stat, List, Row, Badge, Button, Field, Input, Textarea, ErrorState, Skeleton } from "@forkable/ui";
import { DollarSign, TrendingUp, Users, Check, Send } from "lucide-react";

const LIST_SUBSCRIPTIONS = "conn_mod_def::GJ7Ku75hXu8::mfT7dYOYQQCoxlI7D5uKIw"; // stripe, List Subscriptions (read)
const LIST_CHARGES = "conn_mod_def::GJ7Kr4ILxto::NkTwzYCqS7a2-axG_Yro0A"; // stripe, List Charges (read)
const LIST_PULLS = "conn_mod_def::GGV5vcY-XvE::aeuFAgzYQZyfi-gMZ3_uLA"; // github, List Pull Requests (read)
const CREATE_DRAFT = "conn_mod_def::GGZUe0SIuk8::nhwEKp2cQ6uARsH3513VeQ"; // gmail, Create Draft (write)

type Sub = { status: string; created: number; canceled_at: number | null; items: { data: { quantity: number; price: { unit_amount: number; recurring: { interval: "month" | "year" } } }[] } };
type Charge = { amount: number; status: string; created: number };
type Pull = { id: number; number: number; title: string; mergedAt: string | null; labels: { name: string }[]; author: { login: string } };

const usd = (cents: number) => "$" + (cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 });
const monthly = (s: Sub) => s.items.data.reduce((sum, i) => sum + (i.price.unit_amount * i.quantity) / (i.price.recurring.interval === "year" ? 12 : 1), 0);

export default function InvestorUpdate() {
  const [t] = useState(() => ({ now: Math.floor(Date.now() / 1000), month: new Date().toLocaleDateString("en-US", { month: "long" }) }));
  const ago30 = t.now - 30 * 86_400;
  const subs = useAction<{ data: Sub[] }>(LIST_SUBSCRIPTIONS, { query: { status: "all", limit: "100" } });
  const charges = useAction<{ data: Charge[] }>(LIST_CHARGES, { query: { limit: "100", "created[gte]": String(t.now - 60 * 86_400) } });
  const pulls = useAction<Pull[]>(LIST_PULLS, { body: { owner: "acme", repo: "acme-app", state: "closed", sort: "updated", direction: "desc", perPage: 50 } });
  const [skip, setSkip] = useState<Record<number, boolean>>({});
  const [to, setTo] = useState("victor@langpartners.com, maya@piedpiper.com");
  const [body, setBody] = useState("");
  const [edited, setEdited] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const all = subs.data?.data ?? [];
  const payingNow = all.filter((s) => s.status === "active" || s.status === "past_due");
  const payingThen = all.filter((s) => s.created < ago30 && (s.status !== "canceled" || (s.canceled_at ?? 0) > ago30) && s.status !== "trialing");
  const mrr = payingNow.reduce((n, s) => n + monthly(s), 0);
  const mrrThen = payingThen.reduce((n, s) => n + monthly(s), 0);
  const growth = mrrThen ? Math.round(((mrr - mrrThen) / mrrThen) * 100) : 0;
  const fresh = payingNow.filter((s) => s.created >= ago30).length;
  const paid = (charges.data?.data ?? []).filter((c) => c.status === "succeeded");
  const collected = paid.filter((c) => c.created >= ago30).reduce((n, c) => n + c.amount, 0);
  const shipped = (pulls.data ?? []).filter((p) => p.mergedAt && Date.parse(p.mergedAt) / 1000 >= ago30 && !p.labels.some((l) => l.name === "chore"));
  const picked = shipped.filter((p) => !skip[p.number]);
  const loading = subs.loading || charges.loading || pulls.loading;

  // Keep the draft in step with the numbers and picks until it is edited by hand.
  useEffect(() => {
    if (loading || edited) return;
    setBody(
      [
        "Hi all,",
        "",
        `Here is Acme Inc for ${t.month}.`,
        "",
        `MRR is ${usd(mrr)}, up ${growth}% on last month. We added ${fresh} new paying customers and collected ${usd(collected)}.`,
        "",
        "What we shipped:",
        ...picked.map((p) => `- ${p.title}`),
        "",
        "One ask: intros to finance leads at mid-size logistics companies.",
        "",
        "Dana",
      ].join("\n"),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, edited, picked.length, mrr]);

  const save = async () => {
    setSaving(true);
    try {
      await runAction(CREATE_DRAFT, { body: { to, subject: `Acme Inc, ${t.month} update`, body } });
      setNote("Saved in Gmail Drafts. Read it once more, then send it from Gmail.");
    } catch (e: any) {
      setNote(e.refused === "cancelled" ? "Nothing was saved." : e.message);
    } finally {
      setSaving(false);
    }
  };

  const err = subs.error ?? charges.error ?? pulls.error;
  if (err) return <Page><ErrorState error={err} onRetry={() => (subs.reload(), charges.reload(), pulls.reload())} /></Page>;

  return (
    <Page title={`Investor update, ${t.month}`} description="Numbers from Stripe, shipped work from GitHub, saved as a Gmail draft.">
      <StatGrid cols={3}>
        <Stat label="MRR" icon={<DollarSign />} value={loading ? "-" : usd(mrr)} delta={loading ? undefined : `${growth >= 0 ? "+" : ""}${growth}%`} tone={growth >= 0 ? "positive" : "negative"} hint="on last month" />
        <Stat label="New customers" icon={<Users />} value={loading ? "-" : fresh} hint="last 30 days" />
        <Stat label="Collected" icon={<TrendingUp />} value={loading ? "-" : usd(collected)} hint="last 30 days" />
      </StatGrid>

      <Section title="Shipped" description={`acme/acme-app, merged in the last 30 days. ${picked.length} of ${shipped.length} in the update.`}>
        {pulls.loading ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <List>
            {shipped.map((p) => (
              <Row
                key={p.id}
                selected={!skip[p.number]}
                onClick={() => setSkip((s) => ({ ...s, [p.number]: !s[p.number] }))}
                leading={!skip[p.number] ? <Check /> : <span className="size-4" />}
                title={p.title}
                meta={`#${p.number} by ${p.author.login}`}
                trailing={p.labels[0] ? <Badge>{p.labels[0].name}</Badge> : undefined}
              />
            ))}
          </List>
        )}
      </Section>

      <Section title="Draft">
        <Field label="To">
          <Input value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label="Message" hint={edited ? "Edited by you. Picks above no longer change it." : "Updates as you pick what shipped."}>
          <Textarea rows={10} value={body} onChange={(e) => (setBody(e.target.value), setEdited(true))} />
        </Field>
        <div className="flex items-center gap-2">
          <Button variant="primary" loading={saving} disabled={loading || !body} onClick={save}><Send />Save draft in Gmail</Button>
          <span className="text-11 text-muted-foreground">You confirm before it is saved. Nothing is sent.</span>
        </div>
        {note && <p role="status" className="m-0 text-13 text-muted-foreground">{note}</p>}
      </Section>
    </Page>
  );
}
