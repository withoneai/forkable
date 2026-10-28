# The Acme Inc sample world

One made-up company behind every sample on forkable.dev/mcp: the hero chat,
the six flows, the Saved section's Confirm, and the home page In chat
section. Nobody here is a real person or customer. Keep new samples inside
this story, and change it here first.

## The day

The mail reads as **Wednesday, October 21**. Times in the flows are
relative to now (meetings land on the quarter hour, mail is "2h ago"), so
the page always reads as today. Day names in mail bodies assume Wednesday:
Thursday is tomorrow, Friday is in two days.

## Acme Inc

Twelve people. Selling operations software to mid-size teams. Raising a
seed led by Northwind VC; Northwind's IC meets Thursday at 5pm. Three
design partners in pilot: Globex, Vandelay Industries, Umbrella Health.

- **Dana Reyes**, CEO, dana@acme.com. The signed-in user in every flow.
- **Marcus Lee**, VP Engineering. Wants to send two offers today (Omar
  Farouk, Jess Tanaka).
- **Jordan Park**, Head of Marketing. Launch post, 1:1 today.
- **Riley Chen**, operations. The offsite (venue holds until 5pm today),
  payroll, approves vendor invoices.
- **Noor Haddad** (noor-acme) and **Theo Brandt** (theo-acme), engineers.
  They and Marcus author the pull requests in acme/acme-app.

## Around Acme

- **Priya Nair**, Partner, Northwind VC. Term sheet: board seat timing and
  pro rata, needs Dana's answer today.
- **Rosa Delgado**, Delgado Pearson, Acme's counsel. Needs the option pool
  pick (10% or 8%) by noon Thursday.
- **Victor Lang**, Lang Partners, Acme's board member. Board sync is next
  Thursday; deck due next Tuesday evening.
- **Grace Lindqvist**, angel, $150k into the seed alongside Northwind,
  wants the data room. Lunch with Dana today.
- **Maya Chen**, a friend and pre-seed angel (Pied Piper), offering an
  intro to Stark Logistics' venture arm. Gets the investor update with
  Victor.
- **Elena Ruiz** (Director of Operations) and **Patricia Gomez**
  (Procurement) at Globex. Pilot done, want pricing for 40 seats and a
  security questionnaire by November 3. Not a paying customer yet.
- **Leo Martins**, Vandelay Industries. Wants a SAML SSO date before rolling
  out to about 60 people in Q1.
- **Wes Carter**, Oceanic Supply. Exports failing since Monday, payroll
  export on Friday; his card is also being declined.
- **Omar Farouk**, candidate. Onsite tomorrow at 10am, competing offer
  expires Friday.
- Others in the inbox: Sam Okafor (Initech, intro to Lena Fischer at
  Initech Ventures), Hannah Brooks (recruiter), Ben Adler (CPA), Chloe
  Dubois (Dev Horizons, Nov 7 talk), Frank Molinari (Suite 410 lease),
  Tariq Rahman (old friend, now at Stark Logistics), Dmitri Volkov
  (Cyberdyne Office, a furniture vendor, not a customer), Ingrid Solberg
  (withdrew), three newsletters.

## Today's calendar (calendar.ts)

| When | Event | Who |
| --- | --- | --- |
| 2.5h ago | Daily standup | Marcus, Jordan, Riley |
| in 70 min | **Northwind terms** (the next meeting) | Priya (organizer), Rosa, Victor |
| in ~3h | Lunch with Grace | Grace, Tartine |
| in 5h | Globex pricing call | Elena, Patricia |
| in 6.5h | 1:1 with Jordan | Jordan |
| tomorrow 10am | Onsite interview: Omar Farouk | Marcus, Omar |

Meeting prep always opens on Northwind terms: one thread each with Priya
(term sheet), Rosa (option pool) and Victor (board deck), all waiting on
Dana.

## Stripe (stripe.ts)

Thirteen subscriptions, eleven paying (active or past due), one trialing
(Blue Sun), one canceled (Monarch Paper). Customers: Hooli, Initech,
Umbrella Health, Vandelay Industries, Prestige Worldwide, Oceanic Supply,
Sterling Cooper, Massive Dynamic (annual), Soylent Foods, Tyrell Labs, Wonka
Bars, Blue Sun, Monarch Paper. Globex, Stark Logistics and Cyberdyne Office
are deliberately not customers.

- **MRR $10,158**, up 20% on 30 days ago, 3 new paying customers in the
  last 30 days (Soylent, Tyrell, Wonka). Revenue pulse and Investor update
  compute it the same way from the same data.
- **Failed payments**: only Oceanic Supply ($490, Team, card declined) and
  Wonka Bars ($99, Starter, insufficient funds), each a renewal plus a retry.
- **Overdue invoices**: ACME-0139 Oceanic $490, ACME-0141 Wonka $99.
  ACME-0142 Umbrella $3,000 is open, not yet due.

## GitHub (github.ts)

acme/acme-app, merged in the last 30 days: SAML SSO part one (the date Leo
is waiting on is getting closer), background exports, scheduled report
time zones, admin audit log, usage billing behind a flag, faster dashboard,
Slack alerts. Nothing claims to have fixed Wes's export timeouts.

## Sent and unanswered (gmail.ts EXTRA)

Follow-up radar's six: Soylent second team quote (12d, Nadia), Umbrella
next steps (9d, Kim), a Globex reference ask (6d, Kenji at Tyrell Labs),
Vandelay rollout pricing for 60 seats (4d, Leo), W-9 to Ben (22 hours ago),
and the design partner note to Lena (today, after Sam's intro).

## Home page In chat section

"Needs a reply this week" shows three threads from this inbox that want a
plain yes: Marcus (approve both offers, today), Grace (data room, Friday),
Maya (the Stark intro, this week).
