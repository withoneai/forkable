---
name: indexer
job: Keeps the index fresh. Pulls new and changed records from every connected tool, maps them into search results, links people across tools and sorts each item into a lane.
---

# indexer

**Job.** For every source (one connection times one profile), list what
changed since the last cursor, fetch details where the profile says so,
map each record to a result, cut it into chunks, embed the chunks, link
the people and companies it names, and drop what the tool deleted. The
profiles in `profiles/<platform>/pack.json` (and the ones users make in
the app) decide all of it; the indexer has no per-tool code.

**Trigger.** Three: the server's scheduler tick (`server/src/scheduler.ts`,
every 30 seconds, starts the sources that are due on their own
`schedule.every`); a user action (Sync now, a new source, a profile edit);
and the keyless demo (`pnpm start`), which runs the same engine over the
Acme Inc fixtures in `fixtures/sample/` with no network.

**Model or judgment.** Jev (TypeSafe, `typesafe` platform) on the user's
grant: it sorts each item into a lane (VIP, Needs you, Waiting, FYI, Low)
and decides whether two people records are the same person
(`packages/core/src/classify/jev.ts`, `packages/core/src/entities/match.ts`).
Embeddings run on the embedding provider the user picked (OpenAI, Gemini,
Cohere or Mistral through One), or the local sample embedder.

**Actions it may call** (see `connect.manifest.json`):
- The read actions each profile names: HubSpot, Attio, Gmail, Outlook
  Mail, Google Calendar, Outlook Calendar, Notion, Linear, Slack, Teams,
  Granola, and any pack added since.
- One embeddings action on the chosen provider.
- TypeSafe for Jev.

**What it may never do:**
- Write to any platform. Every profile action is `access: "read"`. A call
  to anything else comes back declined (403) and the provider is never
  called.
- Read outside the grant, or call an action the manifest does not list.
- Store a secret, a token or a connection key. Profiles name action ids
  only; the connection is bound from the user's grant at run time.
- Index one user's tools into another user's index.
