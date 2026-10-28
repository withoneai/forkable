// Acme Inc sample Stripe account, made up for this page. Shapes follow One's
// Stripe actions: "List Subscriptions" and "List Charges" answer Stripe's
// own list envelope ({ object: "list", data, has_more }), "Get Invoices"
// answers { invoices, count, limit, hasMore }. The customers are fictional
// companies; amounts are in cents. Dates are relative to now.

const DAY = 86_400;
const now = () => Math.floor(Date.now() / 1000);

type Customer = { id: string; name: string; email: string };
const C = (id: string, name: string, email: string): Customer => ({ id: `cus_${id}`, name, email });

const CUSTOMERS = {
  hooli: C("Hl41", "Hooli", "billing@hooli.xyz"),
  initech: C("In22", "Initech", "ap@initech.io"),
  umbrella: C("Um90", "Umbrella Health", "finance@umbrella.health"),
  vandelay: C("Vd17", "Vandelay Industries", "leo@vandelay.com"),
  prestige: C("Pw08", "Prestige Worldwide", "ops@prestigeworldwide.com"),
  oceanic: C("Oc33", "Oceanic Supply", "wes@oceanicsupply.co"),
  sterling: C("Sc05", "Sterling Cooper", "joan@sterlingcooper.com"),
  soylent: C("Sy61", "Soylent Foods", "nadia@soylentfoods.com"),
  tyrell: C("Ty12", "Tyrell Labs", "accounts@tyrelllabs.ai"),
  wonka: C("Wk77", "Wonka Bars", "orders@wonkabars.com"),
  massive: C("Md90", "Massive Dynamic", "procurement@massivedynamic.com"),
  bluesun: C("Bs14", "Blue Sun", "hello@bluesun.co"),
  monarch: C("Mn03", "Monarch Paper", "michael@monarchpaper.com"),
};

type Plan = { nickname: string; unit_amount: number; interval: "month" | "year" };
const PLANS: Record<string, Plan> = {
  starter: { nickname: "Starter", unit_amount: 9_900, interval: "month" },
  team: { nickname: "Team", unit_amount: 49_000, interval: "month" },
  business: { nickname: "Business", unit_amount: 120_000, interval: "month" },
  scale: { nickname: "Scale", unit_amount: 240_000, interval: "month" },
  annual: { nickname: "Scale, annual", unit_amount: 2_400_000, interval: "year" },
};

type SubSeed = { customer: Customer; plan: keyof typeof PLANS; daysAgo: number; status: "active" | "past_due" | "trialing" | "canceled" };
const SUBS: SubSeed[] = [
  { customer: CUSTOMERS.hooli, plan: "business", daysAgo: 300, status: "active" },
  { customer: CUSTOMERS.initech, plan: "team", daysAgo: 210, status: "active" },
  { customer: CUSTOMERS.umbrella, plan: "business", daysAgo: 160, status: "active" },
  { customer: CUSTOMERS.vandelay, plan: "scale", daysAgo: 120, status: "active" },
  { customer: CUSTOMERS.prestige, plan: "team", daysAgo: 95, status: "active" },
  { customer: CUSTOMERS.oceanic, plan: "team", daysAgo: 70, status: "past_due" },
  { customer: CUSTOMERS.sterling, plan: "starter", daysAgo: 64, status: "active" },
  { customer: CUSTOMERS.massive, plan: "annual", daysAgo: 48, status: "active" },
  { customer: CUSTOMERS.soylent, plan: "team", daysAgo: 26, status: "active" },
  { customer: CUSTOMERS.tyrell, plan: "business", daysAgo: 17, status: "active" },
  { customer: CUSTOMERS.wonka, plan: "starter", daysAgo: 11, status: "past_due" },
  { customer: CUSTOMERS.bluesun, plan: "team", daysAgo: 4, status: "trialing" },
  { customer: CUSTOMERS.monarch, plan: "starter", daysAgo: 140, status: "canceled" },
];

export function listSubscriptions(query: Record<string, string> = {}) {
  const t = now();
  const status = query.status;
  const data = SUBS.filter((s) => (status && status !== "all" ? s.status === status : status === "all" || s.status !== "canceled")).map((s, i) => {
    const plan = PLANS[s.plan]!;
    return {
      id: `sub_${s.customer.id.slice(4)}${i}`,
      object: "subscription",
      status: s.status,
      customer: s.customer.id,
      created: t - s.daysAgo * DAY,
      start_date: t - s.daysAgo * DAY,
      cancel_at_period_end: false,
      canceled_at: s.status === "canceled" ? t - 20 * DAY : null,
      currency: "usd",
      items: {
        object: "list",
        data: [{ id: `si_${i}`, object: "subscription_item", quantity: 1, price: { id: `price_${s.plan}`, object: "price", nickname: plan.nickname, unit_amount: plan.unit_amount, currency: "usd", recurring: { interval: plan.interval, interval_count: 1 } } }],
      },
    };
  });
  const limit = Number(query.limit ?? 10);
  return { object: "list", url: "/v1/subscriptions", has_more: data.length > limit, data: data.slice(0, limit) };
}

type ChargeSeed = { customer: Customer; amount: number; daysAgo: number; status: "succeeded" | "failed"; failure?: [string, string]; description: string };

function chargeSeeds(): ChargeSeed[] {
  const out: ChargeSeed[] = [];
  // Monthly renewals for 60 days back, on each subscription's own day.
  for (const s of SUBS) {
    const plan = PLANS[s.plan]!;
    if (s.status === "trialing") continue;
    if (plan.interval === "year") {
      out.push({ customer: s.customer, amount: plan.unit_amount, daysAgo: s.daysAgo, status: "succeeded", description: `Acme ${plan.nickname}` });
      continue;
    }
    for (let d = s.daysAgo; d >= 0; d -= 30) {
      if (d > 60) continue;
      if (s.status === "canceled" && d < 25) continue;
      const failing = s.status === "past_due" && d < 30;
      out.push({
        customer: s.customer,
        amount: plan.unit_amount,
        daysAgo: d,
        status: failing ? "failed" : "succeeded",
        failure: failing ? (s.customer === CUSTOMERS.wonka ? ["insufficient_funds", "Your card has insufficient funds."] : ["card_declined", "Your card was declined."]) : undefined,
        description: `Acme ${plan.nickname}`,
      });
    }
  }
  // Metered usage on the Scale and Business plans, most days, so the money
  // comes in daily and not only on renewal days.
  const metered = [CUSTOMERS.vandelay, CUSTOMERS.hooli, CUSTOMERS.umbrella, CUSTOMERS.tyrell, CUSTOMERS.massive];
  for (let d = 0; d < 60; d++) {
    if (d % 7 === 5) continue;
    const c = metered[d % metered.length]!;
    const amount = 6_000 + ((d * 7919) % 31) * 1_100 + (60 - d) * 120;
    out.push({ customer: c, amount, daysAgo: d, status: "succeeded", description: "Usage, API calls over plan" });
  }
  // Retries on the two past-due accounts, and a few one-off onboarding fees.
  out.push({ customer: CUSTOMERS.oceanic, amount: 49_000, daysAgo: 2, status: "failed", failure: ["card_declined", "Your card was declined."], description: "Acme Team, retry" });
  out.push({ customer: CUSTOMERS.wonka, amount: 9_900, daysAgo: 0, status: "failed", failure: ["insufficient_funds", "Your card has insufficient funds."], description: "Acme Starter, retry" });
  out.push({ customer: CUSTOMERS.tyrell, amount: 250_000, daysAgo: 16, status: "succeeded", description: "Onboarding package" });
  out.push({ customer: CUSTOMERS.soylent, amount: 150_000, daysAgo: 25, status: "succeeded", description: "Onboarding package" });
  out.push({ customer: CUSTOMERS.umbrella, amount: 300_000, daysAgo: 44, status: "succeeded", description: "Security review add-on" });
  return out;
}

export function listCharges(query: Record<string, string> = {}) {
  const t = now();
  const gte = query["created[gte]"] ? Number(query["created[gte]"]) : 0;
  const data = chargeSeeds()
    .map((c, i) => {
      // Spread renewals through the day so the list reads naturally.
      const created = t - c.daysAgo * DAY - ((i * 7919) % 36_000);
      return {
        id: `ch_3Q${(100000 + i * 7331).toString(36)}`,
        object: "charge",
        amount: c.amount,
        amount_captured: c.status === "succeeded" ? c.amount : 0,
        amount_refunded: 0,
        currency: "usd",
        created,
        customer: c.customer.id,
        description: c.description,
        paid: c.status === "succeeded",
        status: c.status,
        failure_code: c.failure?.[0] ?? null,
        failure_message: c.failure?.[1] ?? null,
        receipt_email: c.customer.email,
        billing_details: { name: c.customer.name, email: c.customer.email, address: null, phone: null },
      };
    })
    .filter((c) => c.created >= gte)
    .sort((a, b) => b.created - a.created);
  const limit = Math.min(100, Number(query.limit ?? 10));
  return { object: "list", url: "/v1/charges", has_more: data.length > limit, data: data.slice(0, limit) };
}

export function getInvoices(body: { status?: string; limit?: number } = {}) {
  const t = now();
  const all = [
    { c: CUSTOMERS.oceanic, n: "ACME-0139", amount: 49_000, created: t - 9 * DAY, due: t - 2 * DAY, status: "open" },
    { c: CUSTOMERS.wonka, n: "ACME-0141", amount: 9_900, created: t - 1 * DAY, due: t - 1 * DAY, status: "open" },
    { c: CUSTOMERS.umbrella, n: "ACME-0142", amount: 300_000, created: t - 3 * DAY, due: t + 11 * DAY, status: "open" },
    { c: CUSTOMERS.tyrell, n: "ACME-0138", amount: 120_000, created: t - 17 * DAY, due: t - 17 * DAY, status: "paid" },
  ];
  const invoices = all
    .filter((i) => !body.status || i.status === body.status)
    .map((i, k) => ({
      id: `in_1R${(5000 + k * 977).toString(36)}`,
      number: i.n,
      status: i.status,
      amount_due: i.amount,
      amount_paid: i.status === "paid" ? i.amount : 0,
      amount_remaining: i.status === "paid" ? 0 : i.amount,
      currency: "usd",
      customer: i.c.id,
      customer_email: i.c.email,
      customer_name: i.c.name,
      collection_method: "charge_automatically",
      created: i.created,
      due_date: i.due,
      hosted_invoice_url: `https://invoice.stripe.com/i/acme_sample_${i.n}`,
    }));
  const limit = Math.min(100, Math.max(1, body.limit ?? 50));
  return { invoices: invoices.slice(0, limit), count: Math.min(limit, invoices.length), limit, hasMore: false, message: `Successfully retrieved ${invoices.length} invoices` };
}
