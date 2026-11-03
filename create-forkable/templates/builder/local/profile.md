---
for: "{{FOR}}"
in: "{{IN}}"
---

# Local profile

This fork is for **{{FOR}}**, in **{{IN}}**.

`npm create forkable` wrote the two fields above from `--for` and `--in`.
Builder already works underneath (the editor, the live preview, publish,
Sign in with One in every app). What a local pass should still set:

- **Who builds, specifically.** Not "{{FOR}}" in general: the one person
  who opens this fork to make something. A clinic manager who wants a
  booking form, a broker who wants a client portal, an agency that ships
  one small app a week for shop owners.
- **What they build first.** The three apps {{FOR}} in {{IN}} would ask
  for on day one. Those become the prompts on Home and the sample
  templates in `packages/template`.
- **Which tools the apps should reach.** The accounts {{FOR}} in {{IN}}
  already use (WhatsApp Business, a booking tool, a local payment
  provider). Check each one in One's catalog before you promise it.
- **Language and locale.** What language do the generated apps speak?
  Note the date format, currency and time zone the agent should default
  to. House rules for generated apps live in `packages/template/_AGENTS.md`.

Leave the placeholders in place until a GTM skill (see `gtm/`) or a human
fills them in. Nothing in this file is sent anywhere. The coding agent
and the GTM skills read it.
