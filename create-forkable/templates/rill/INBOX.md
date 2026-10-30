# INBOX.md

Plain-English rules for where an email lands. Code compiles this file into
the policy that runs on every message. Edit it and restart; nothing else to
configure. Jev never reads this file: it answers questions, this file decides
what the answers mean.

## Who I am

Dana, CEO of Acme Inc. The sample inbox is hers. In a live mailbox this line
is replaced by what you type in onboarding.

## Lanes (first match wins)

- other: a receipt, a newsletter or a notification
- screener: first-time sender, not a VIP, not on my team, not screened yet
- vip: sender is a VIP, or a VIP is on the thread
- goals: goal probability at least 0.5
- reply: needs a reply from me, probability at least 0.6, and the ball is with me
- other: a calendar invitation
- other: everything else

A calendar invitation checks VIP and goals before falling to Other, so an
invite from a VIP or tied to a goal lands there with the rest of their mail,
and a first-time sender's invite goes to the screener like any other
first-time mail.

## Screening

- quarantine when any injection signal is at least 0.7
- strip when any injection signal is at least 0.35
- a screened-out sender goes to Other and is never judged again

A calendar invite that looks like spam or a scam is quarantined on the same
two numbers above, not a separate setting.

## Priority (0 to 100)

- goal weight (0 to 10) times goal probability, times 5
- VIP tier adds: inner circle 30, key account 20, team 15
- urgency adds: within the hour 20, today 12, this week 6
- needs a reply adds 10
- a meeting with them in the next 48 hours adds 15
- a cold pitch loses 30
- a newsletter, receipt or notification loses 40

## The Check badge

- show it when the judgment the lane rests on is below 0.6 confidence
- also show it when a probability sits within 0.15 of its line
- never file silently: a Check row keeps its lane but asks you to confirm

## Drafts

- write a draft when a reply is needed and the sender is not screened out
- never write a draft for a VIP whose rule says never auto-draft
- never send. Only your keypress sends

## Follow-ups

- when I wrote last and nobody answered, nudge after 3 days
- a VIP rule can shorten or lengthen this

Write "3 business days" to skip weekends. A due follow-up brings the thread
back to the inbox once, even if you marked it done or snoozed it, with a
Follow up chip. Anyone writing again resets it.
