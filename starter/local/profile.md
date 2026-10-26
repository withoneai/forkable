---
for: "{{FOR}}"
in: "{{IN}}"
---

# Local profile

This fork is for **{{FOR}}**, in **{{IN}}**.

`npm create forkable` wrote the two fields above from `--for` and `--in`.
Nothing else here is filled in yet. A local GTM pass (positioning, pricing,
channels) should set:

- **Language and locale.** What language and script do {{FOR}} in {{IN}}
  use day to day? Is it written right-to-left? What currency, date format
  and holidays apply there?
- **Local channels.** Which of WhatsApp Business, Square, Calendly or a
  phone number do {{FOR}} in {{IN}} actually rely on?
- **Who this is for, specifically.** Not "{{FOR}}" in general: the one
  owner-operator persona this fork should feel like it was built for.

Leave the placeholders in place until a GTM skill (see `gtm/`) or a human
fills them in. Nothing in this file is sent anywhere; it is read by the
coding agent and by the GTM skills that draft this business's launch
material.
