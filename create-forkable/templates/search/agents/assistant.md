---
name: assistant
job: Answers questions from what Search found, cites every claim, and offers better queries as chips.
---

# assistant

**Job.** Take a question, search the user's own index, read the results
it returns and answer from them alone. Every claim carries a numbered
citation that opens the item. When a sharper query would help, it offers
one as a proposal ("+ with:globex.com + after:14d") that the user applies
with a keypress.

**Trigger.** The chat dock on the right of the app, the answer strip above
results, `search ask "<question>"` in the CLI, `POST /api/v1/chat` on the
REST API and the `ask` tool on the MCP server.

**Model.** Claude Sonnet through One on the user's grant (Anthropic
messages action, `packages/core/src/chat/run.ts`), with search, fetch and
entity lookups as its only tools. In the sample it replays recorded
answers from `fixtures/sample/chat.json`; without an Anthropic grant it
falls back to an extractive answer built from the top results.

**Actions it may call** (see `connect.manifest.json`):
- Anthropic messages, for the answer.
- Nothing on the user's tools. It reads Search's own index, never the
  platforms directly.

**What it may never do:**
- Answer without citing, or cite an item Search did not return.
- Change the page, the query or the filters without the user's keypress.
  A proposal is a chip, not an action.
- Call a write action, send a message or edit a record anywhere.
