// The machine-readable side of search.forkable.dev, written into dist/
// after the build: /llms.txt, /index.md, the agent skill under
// /.well-known/agent-skills/ (same format and sha256 digest scheme as
// withone.ai and forkable.dev), /.well-known/agent.json and
// /.well-known/ai-catalog.json. Sources for the prose live in agent/.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const site = fileURLToPath(new URL("..", import.meta.url));
const SITE_URL = "https://search.forkable.dev";

function out(path, body) {
  const file = `${site}dist/${path}`;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
  console.log(`wrote dist/${path}`);
}

function source(name) {
  return readFileSync(`${site}agent/${name}`, "utf8");
}

out("llms.txt", source("llms.txt"));
out("index.md", source("index.md"));

// Agent Skills Discovery index (RFC v0.2.0), as withone.ai and forkable.dev
// serve it: the digest is the sha256 of exactly the bytes served at the
// skill's URL.
const SKILL_NAME = "search";
const SKILL_URL = `${SITE_URL}/.well-known/agent-skills/${SKILL_NAME}/SKILL.md`;
const SKILL_DESCRIPTION =
  "Fork Search, a personal search engine over anything connected through One, with hybrid keyword and semantic search and an AI panel that cites its results.";
const skill = source("SKILL.md");
const digest = `sha256:${createHash("sha256").update(skill, "utf8").digest("hex")}`;
out(`.well-known/agent-skills/${SKILL_NAME}/SKILL.md`, skill);
out(
  ".well-known/agent-skills/index.json",
  `${JSON.stringify(
    {
      $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
      skills: [{ name: SKILL_NAME, type: "skill-md", description: SKILL_DESCRIPTION, url: SKILL_URL, digest }],
    },
    null,
    2,
  )}\n`,
);

// A short agent card, the withone.ai / forkable.dev agent.json shape cut
// down to what this one product site has.
out(
  ".well-known/agent.json",
  `${JSON.stringify(
    {
      name: "Search",
      description:
        "A free, open source personal search engine. Indexes anything connected through One, hybrid keyword and semantic search, an AI panel that reasons over results and cites them. Web app, CLI, API and MCP, all behind Sign in with One.",
      url: SITE_URL,
      publisher: { name: "One", url: "https://withone.ai" },
      license: "MIT",
      source: "https://github.com/withoneai/forkable-search",
      source_in_forkable: "https://github.com/withoneai/forkable/tree/main/create-forkable/templates/search",
      command: "npm create forkable@latest my-search -- --template search",
      quickstart: `${SITE_URL}/llms.txt`,
      skills: { index: `${SITE_URL}/.well-known/agent-skills/index.json`, search: SKILL_URL },
      content: {
        llms_txt: `${SITE_URL}/llms.txt`,
        pages: [{ name: "Home", url: `${SITE_URL}/`, markdown: `${SITE_URL}/index.md` }],
      },
      rules: [
        "Success is the demo exiting 0. It needs no account and no keys.",
        "Read AGENTS.md in the fork before changing code.",
        "Stop and ask the human before any secret, git push, deploy or publish.",
        "Going live needs one Connect app: `pnpm connect` prints an approval link the human confirms in One.",
      ],
    },
    null,
    2,
  )}\n`,
);

// ARD capability manifest (ai-catalog data model), as withone.ai and
// forkable.dev serve it.
const HOST = "search.forkable.dev";
out(
  ".well-known/ai-catalog.json",
  `${JSON.stringify(
    {
      specVersion: "1.0",
      host: { displayName: "Search", identifier: `did:web:${HOST}` },
      entries: [
        {
          identifier: `urn:air:${HOST}:skill:search`,
          displayName: "Search agent skill",
          description: "Agent skill for forking and running the Search personal search engine.",
          type: "text/markdown",
          url: SKILL_URL,
          representativeQueries: [
            "build a personal search engine over my connected tools",
            "fork an open source search app with hybrid keyword and semantic search",
            "search across HubSpot, Gmail, Notion, Slack and Linear from one box",
          ],
        },
        {
          identifier: `urn:air:${HOST}:docs:llms`,
          displayName: "Search llms.txt",
          description: "Index of search.forkable.dev for AI agents, with the fork command and the markdown pages.",
          type: "text/plain",
          url: `${SITE_URL}/llms.txt`,
          representativeQueries: ["what is Search (search.forkable.dev)", "how do I fork Search"],
        },
      ],
    },
    null,
    2,
  )}\n`,
);
