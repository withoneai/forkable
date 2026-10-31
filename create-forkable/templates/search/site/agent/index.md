# Search, one search box for everything you connect

Search indexes your CRM, mail, calendars, docs, issues, chat and meeting notes, ranks them by
keyword and meaning, and docks an AI on the right that cites what it finds. It's a Forkable business,
so you can fork it and run your own. Free and open source, MIT licensed.

```
npm create forkable@latest my-search -- --template search
```

Try it on the Acme sample first. No account needed.

Agents, start at https://search.forkable.dev/llms.txt.

## Sign-in and sources come with the fork

Copying an app that reads Gmail or HubSpot used to mean an OAuth app per tool, tokens to store and
refresh, a login and a consent screen to build. You make one Connect app, and every source Search
indexes runs on each user's own grant.

- **Eleven sources built in.** HubSpot, Attio, Gmail, Outlook Mail, Google Calendar, Outlook Calendar,
  Notion, Linear, Slack, Teams and Granola.
- **Add any other tool in One.** Settings picks a platform, proposes a mapping profile, you confirm
  it, and indexing starts.
- **Profiles are files.** Built-in ones ship in the repo; yours export, import, or go back as a PR.
- **No provider keys.** Every sync, Jev judgment and embedding call runs on the signed-in user's own grant.

## Keyword and meaning, one ranking

Postgres full-text search and pgvector embeddings blend into a single relevance score. Embeddings are
made through One, on your grant. Run it on an embedded local Postgres, or point it at any Postgres
connection string, Supabase included.

A HubSpot contact, an Attio person, a Gmail thread and a Granola note about the same person merge into
one entity, matched by email, domain and a Jev check.

## The AI on the right

It reasons only over the rows your search actually returned, and every answer cites which of those
rows it used. Each numbered claim opens the row it came from. It can also propose a tighter query;
apply it, or keep the question in the chat.

## Search it from anywhere

- **Web app.** The search box and the AI panel.
- **CLI.** `search "<query>"` from a terminal, scriptable and pipeable.
- **API.** A REST API behind OAuth, `GET /api/v1/search?q=...`.
- **MCP.** An MCP server with OAuth, Sign in with One behind it. `search mcp-config` prints the
  setup for Claude Code, Codex or Claude Desktop.

## Questions people ask

**What does Search actually index?** Whatever you connect: the eleven built-in profiles, plus any other
tool in One added from Settings.

**Does it read my data, or just index it?** It stores a hybrid-searchable copy of what each profile is
told to index, scoped to your own Connect grant. Nothing is sent anywhere outside the Postgres you
point it at.

**Can I use Supabase instead of a local database?** Yes. Same schema either way.

**What if a tool I use isn't in the list?** Add it from Settings; no code required.

**How does the AI panel avoid making things up?** It only reasons over the rows your search returned,
and cites them.

## Fork the whole thing

Search is open source, part of Forkable, One's family of businesses you fork and run.

- The app, its agents and the mapping-profile engine
- The CLI, the API and the MCP server
- This site
- MIT licensed, built on One Connect

Secured by One. Each user connects their own accounts and can revoke them any time.

Source: https://github.com/withoneai/forkable-search (standalone) and https://github.com/withoneai/forkable/tree/main/create-forkable/templates/search
(in the Forkable monorepo). Built on One Connect (https://withone.ai). Part of
[Forkable](https://forkable.dev), fork a business, not a blank page.
