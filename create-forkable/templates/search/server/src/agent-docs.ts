// Files for agents, served by the server itself (SPEC 16.5): /start.md (an agent
// connects itself to this Search), /skill.md and
// /.well-known/agent-skills/search/SKILL.md (when and how to use Search),
// /.well-known/agent-skills/index.json and /llms.txt. Each is built from the
// address the request came in on, so the links work on localhost or 127.0.0.1.
// They are public, so they never name a person, a folder or a program path.
// The Connect button installs the same skill into Claude Code's skills folder.

import { createHash } from "node:crypto";

export const SKILL_MARKER = "<!-- installed by Search. Remove it from Search, Agents. -->";

const DESCRIPTION = "Search the person's own mail, calendar, meetings, CRM deals, people, docs, issues and chat in one place, through the Search MCP server on their computer. Use whenever a question is about their own work: who someone is, what was said or agreed, the latest on a deal or project, what is on their calendar, or where a document is. Read only.";

export interface SkillOptions { skillName?: string; serverName?: string }

export function skillMd(base: string, o: SkillOptions = {}): string {
  const b = base.replace(/\/+$/, "");
  const skill = o.skillName ?? "search";
  const server = o.serverName ?? "search";
  return `---
name: ${skill}
description: ${DESCRIPTION}
---
${SKILL_MARKER}

# Search

Search is the person's own index over the tools they connected (Gmail,
Outlook, calendars, HubSpot, Attio, Notion, Linear, Slack, Teams, meeting
notes and more). It runs on their computer at ${b} and you reach it through
the \`${server}\` MCP server. Everything is read only: you can look things up,
never change them.

## When to reach for it

Use Search before you guess or ask, whenever the question is about the
person's own work:

- People and companies: "who is Priya?", "what do we know about Globex?"
- What was said: "what did Dana say about the renewal?", "find the final redline"
- Status: "where are we with the Globex deal?", "what is open on the pilot?"
- Time: "what is on my calendar Thursday?", "what happened last week with Initech?"
- Finding a file or page: "the onboarding doc", "the pricing sheet Sam sent"

Do not use it for general knowledge or the web.

## The tools

| Tool | Use it when |
|---|---|
| \`search\` | You need items. Pass \`query\` (words) and any filters: \`source\` (gmail, hubspot, notion, ...), \`type\` (mail, meeting, event, doc, issue, message, deal, note, person, company), \`container\` (a channel, folder or project: \`deals\` for #deals), \`from\`, \`with\`, \`after\`, \`before\` (2026-10-01, 14d, yesterday, last week). It says how many matched; pass \`offset\` for the next page. Each result lists its people with their address and role (from, to, attendee). |
| \`fetch\` | You have an id from search and need the whole item. Long items come in parts: when \`truncated\` is true, call again with the \`offset\` it gives. |
| \`get_entity\` | Someone asks who a person or company is. Pass an email, a domain or a name. |
| \`list_sources\` | You need to know what is connected and how fresh it is, or a search came back empty and you want to know why. |
| \`ask\` | You want one written answer with numbered citations, grounded only in the person's items. It costs a model call, so prefer search plus fetch when you will write the answer yourself. |

Put each filter in its own field, not in \`query\` as well: when the same
filter is in both with different values, \`search\` says so and asks you to
pick one. The \`query\` text also takes filters written inline, the same ones
the app's keyboard sheet lists: \`in:gmail from:priya after:30d\` (\`in:\` and
\`source:\` are the same), \`type:deal is:open\`, \`is:unread\`,
\`lane:needs-you\`, \`has:attachment\`, \`container:deals\` (also written \`in:#deals\`), \`"exact phrase"\` (quotes are always
words) and \`-in:slack\` (a minus leaves something out).

\`query\` is searched as you wrote it. If you pass the person's own words as
they said them ("emails from Priya last week"), add \`understand: true\`:
Search then reads phrases like "from Priya" and "last week" as filters and
tells you what it read (\`understood\`) and what it ran (\`searchedAs\`).
Check those before you rely on the results.

## How to work

1. Start with \`search\`. Keep queries short: names, a project, a few words.
2. Narrow with filters instead of longer queries.
3. \`fetch\` the two or three items that matter before you answer.
4. Cite what you used: the title, the source and the date, plus the link.
5. If nothing comes back, try fewer words, drop a filter, or check
   \`list_sources\`. Say plainly when Search has nothing on it.

## Examples

- "Where are we with Globex?" -> \`search { query: "globex renewal" }\`, then
  \`fetch\` the newest deal and the latest mail.
- "What did Priya send me this month?" -> \`search { from: "priya", type: "mail", after: "30d" }\`.
- "Who is dana@acme.com?" -> \`get_entity { query: "dana@acme.com" }\`.
- "Show me more" -> the same \`search\` with \`offset\` set to the number it gave.

## If the tools are missing

Search's tools are not connected yet. Read ${b}/start.md and follow it, or
ask the person to open ${b}/settings/agents and click Connect.
`;
}

export function startMd(base: string): string {
  const b = base.replace(/\/+$/, "");
  return `# Set up Search

You are connecting yourself to Search, the person's own search over their
mail, calendar, deals, people and docs. It runs on their computer at ${b}.
Follow these steps in order. Do not ask the person for any password, key or
token: Search signs you in through their browser.

## 1. Check that Search is running

Fetch ${b}/api/health. It answers \`{"ok":true,...}\`. If it does not answer,
tell the person to start Search (\`pnpm dev\` in its folder) and stop here.

## 2. The easiest way: let the person click Connect

Ask the person to open ${b}/settings/agents and click Connect on your card
(Claude Code, Codex, Cursor or Claude Desktop). That adds Search to your
settings, keeps a backup of the old file, and signs you in at once. Then skip
to step 4.

If you are working inside the Search folder yourself, this does the same:

\`\`\`
pnpm run search install <claude-code | codex | cursor | claude-desktop> --server ${b}
\`\`\`

From there you sign in through the browser the first time Search starts.

## 3. By hand, for any other agent

Add an MCP server named \`search\` with the address \`${b}/mcp\`. If you
already have a server called \`search\` that is something else, keep it and
use \`search-local\`. It signs in with OAuth the first time:

\`\`\`json
{ "mcpServers": { "search": { "type": "http", "url": "${b}/mcp" } } }
\`\`\`

- Claude Code: \`claude mcp add --scope user --transport http search ${b}/mcp\`,
  then the person types /mcp, picks search and chooses Authenticate.
- Codex: \`codex mcp add search --url ${b}/mcp\` (it opens the browser to sign in).
- An agent that only runs local (stdio) servers needs the bridge in the
  Search folder: \`pnpm run search install --server ${b}\` lists what it can set up.

For when and how to use the tools, save ${b}/skill.md as a skill
(\`~/.claude/skills/search/SKILL.md\` for Claude Code, unless a skill called
search is already there).

## 4. Check that it works

New MCP servers usually show up in a new session, so the person may need to
start one. Then call the \`list_sources\` tool. It lists what is connected,
with item counts. Tell the person Search is ready and give one example they
can try, like "Where are we with Globex?". Claude Code, Codex, Cursor and
Claude Desktop also show as Connected on ${b}/settings/agents.
`;
}

export function llmsTxt(base: string): string {
  const b = base.replace(/\/+$/, "");
  return `# Search

> A personal search app that runs on the person's own computer. It indexes
> the tools they connect (mail, calendar, CRM, docs, issues, chat, meeting
> notes) and answers over MCP, a REST API and a command line. Read only.

## For agents

- [Set up Search](${b}/start.md): connect yourself to this Search in four steps.
- [Search skill](${b}/skill.md): when to use Search and how to use each tool.
- MCP server: ${b}/mcp (Streamable HTTP, OAuth 2.1 with dynamic client registration and PKCE).
- [Skills index](${b}/.well-known/agent-skills/index.json)

## Tools

- search: items across every connected source, with filters and pages.
- fetch: the full text of one item, in parts when it is long.
- get_entity: who a person or company is, with their latest items.
- list_sources: what is connected and how fresh it is.
- ask: one answer with citations, grounded in the person's items.
`;
}

export function skillsIndex(base: string): string {
  const b = base.replace(/\/+$/, "");
  const skill = skillMd(b);
  return `${JSON.stringify({
    $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
    skills: [{ name: "search", type: "skill-md", description: DESCRIPTION, url: `${b}/.well-known/agent-skills/search/SKILL.md`, digest: `sha256:${createHash("sha256").update(skill).digest("hex")}` }],
  }, null, 2)}\n`;
}

export function setupSentence(base: string): string {
  return `Set up Search for me with ${base.replace(/\/+$/, "")}/start.md`;
}
