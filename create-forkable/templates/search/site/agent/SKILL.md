---
name: search
description: |
  Fork Search (search.forkable.dev), a personal search engine over anything connected through One, with hybrid keyword and semantic search and an AI panel that reasons over results. Runs its keyless Acme Inc demo, then keeps building on it.

  TRIGGER when the human asks to start, fork or scaffold a personal search app, a search engine over their tools, or names "Search" from forkable.dev.
---

# Fork Search

Search is an open source personal search engine with Sign in with One and its source integrations
already wired through One Connect. It starts on a keyless Acme Inc sample, so you can run it before
anyone makes an account.

## Steps

1. **Fork it.**
   ```
   npm create forkable@latest my-search -- --template search
   ```
   Add `--for "<who>" --in "<where>"` after the template flag if the human said who it is for and where.
2. **Check the demo.** The fork succeeded when `pnpm start` exits 0 on the sample index.
3. **Read the rules.** `cd my-search`, then read `AGENTS.md` (it wins over this skill), `local/profile.md`,
   `connect.manifest.json` and `README.md`.
4. **Add a source.** Built-in profiles cover HubSpot, Attio, Gmail, Outlook Mail, Google Calendar,
   Outlook Calendar, Notion, Linear, Slack, Teams and Granola. For anything else, the add-search-profile
   skill in the fork wires a new mapping profile end to end.
5. **Keep building.** Run the demo after every change.

## Stop and ask the human first

- Any secret. Never write one into `.env`, a file, a commit or a log. The human enters it through the
  app's write-only setup screen.
- Making the Connect app. Going live needs one Connect app: `pnpm connect` prints an approval link the
  human confirms in One, and the human pastes the two secrets on `/setup/connect`.
- `git push`, a new repo or a pull request.
- Any deploy or publish.
- Any write to a real account.

Source: https://github.com/withoneai/forkable-search

Full detail: https://search.forkable.dev/index.md
