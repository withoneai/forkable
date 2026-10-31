---
for: "{{FOR}}"
in: "{{IN}}"
---

# Local profile

This fork is for **{{FOR}}**, in **{{IN}}**.

`npm create forkable` wrote the two fields above from `--for` and `--in`.
Search already works underneath (eleven built-in sources, hybrid search,
an AI that cites, the CLI and MCP). What a local pass should still set:

- **Who searches, specifically.** Not "{{FOR}}" in general: the one
  person whose day this fork should feel built for. A broker looking for
  the last thing a client said, a clinic manager looking for a supplier's
  quote, a founder looking for a promise made in a call.
- **Which tools matter locally.** Which of the built-ins do {{FOR}} in
  {{IN}} actually use, and which do they live in that Search does not
  index yet (WhatsApp Business, a local CRM, a booking tool)? Each missing
  one is a new profile pack, not new code: see
  `.claude/skills/add-search-profile/SKILL.md`.
- **Language and locale.** What language do the documents and messages
  use? Search's keyword index stems English today; a fork for another
  language should say so here, and note the date format and time zone the
  sample should show.

Leave the placeholders in place until a GTM skill (see `gtm/`) or a human
fills them in. Nothing in this file is sent anywhere. The coding agent
and the GTM skills read it.
