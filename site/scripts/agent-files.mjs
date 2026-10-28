// The machine-readable side of forkable.dev, written into dist/ after the
// build: /templates.json (from create-forkable/catalog.json, the one catalog
// the CLI and the site share), /llms.txt, /start.md, /index.md,
// /contribute.md, the agent skill under /.well-known/agent-skills/ (same
// format and sha256 digest scheme as withone.ai), /.well-known/agent.json
// and /.well-known/ai-catalog.json. Sources for the prose live in agent/.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const site = fileURLToPath(new URL("..", import.meta.url));
const SITE_URL = "https://forkable.dev";
const catalog = JSON.parse(readFileSync(`${site}../create-forkable/catalog.json`, "utf8"));
const available = catalog.templates.filter((t) => t.status === "available");

const SKILL_NAME = "forkable";
const SKILL_URL = `${SITE_URL}/.well-known/agent-skills/${SKILL_NAME}/SKILL.md`;
const SKILL_DESCRIPTION =
  "Start a business from a Forkable template: fork it with npm create forkable, run its keyless demo, read AGENTS.md and keep building, stopping before any secret, push, deploy or publish.";

function out(path, body) {
  const file = `${site}dist/${path}`;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
  console.log(`wrote dist/${path}`);
}

function source(name) {
  return readFileSync(`${site}agent/${name}`, "utf8");
}

function fill(text, values) {
  let s = text;
  for (const [k, v] of Object.entries(values)) s = s.replaceAll(`{{${k}}}`, v);
  const left = s.match(/\{\{[A-Z_]+\}\}/g)?.filter((m) => m !== "{{FOR}}" && m !== "{{IN}}");
  if (left?.length) throw new Error(`unfilled placeholders: ${left.join(", ")}`);
  return s;
}

const templateLine = (t) =>
  t.status === "available"
    ? `- \`${t.id}\`: ${t.name} (${t.kind}). ${t.description} Package manager ${t.packageManager}. Fork with \`${t.create}\`, demo \`${t.demo}\`. Site ${t.site}. Code ${t.code}`
    : `- \`${t.id}\`: ${t.name} (${t.kind}), coming soon, not forkable yet. ${t.description} Site ${t.site}`;

const templateSection = (t) =>
  [
    `### ${t.name}`,
    "",
    `${t.kind}. ${t.description}`,
    "",
    t.status === "available"
      ? [
          `- Fork: \`${t.create}\``,
          `- Demo: \`${t.demo}\` (${t.packageManager})`,
          t.platforms.length ? `- Platforms: ${t.platforms.join(", ")}` : null,
          `- Site: ${t.site}`,
          `- Code: ${t.code}`,
        ]
          .filter(Boolean)
          .join("\n")
      : `Coming soon. Not forkable yet.`,
  ].join("\n");

const values = {
  TEMPLATE_LINES: catalog.templates.map(templateLine).join("\n"),
  AVAILABLE_LINES: available.map(templateLine).join("\n"),
  TEMPLATE_SECTIONS: catalog.templates.map(templateSection).join("\n\n"),
};

// The catalog, byte for byte as the CLI reads it.
out("templates.json", `${JSON.stringify(catalog, null, 2)}\n`);

out("llms.txt", fill(source("llms.txt"), values));
out("start.md", fill(source("start.md"), { ...values, TEMPLATE_LINES: values.AVAILABLE_LINES }));
out("index.md", fill(source("index.md"), values));
out("contribute.md", fill(source("contribute.md"), values));

// /mcp.md, the markdown twin of /mcp, with the flows from the same
// flows.json the page reads.
const flows = JSON.parse(readFileSync(`${site}src/flows/flows.json`, "utf8")).flows;
const actionTitles = {
  gmailThreads: "Gmail, List and View Email Threads",
  gmailSend: "Gmail, Send Email",
  gmailDraft: "Gmail, Create Draft",
  gmailBatchModify: "Gmail, Batch Modify a User’s Gmail Messages (Labels)",
  calendarEvents: "Google Calendar, List a Calendar's Events",
  stripeCharges: "Stripe, List Charges",
  stripeSubscriptions: "Stripe, List Subscriptions",
  stripeInvoices: "Stripe, Get Invoices",
  githubPulls: "GitHub, List Pull Requests",
};
const MCP_TOOLS = ["list_connections", "find_actions", "action_docs", "ui_guide", "render_ui", "update_ui", "list_my_uis", "show_ui", "rename_ui", "delete_ui", "run_action"];
const platformCount = JSON.parse(readFileSync(`${site}src/generated/platform-count.json`, "utf8")).platforms;
out(
  "mcp.md",
  fill(source("mcp.md"), {
    FLOW_SECTIONS: flows
      .map((f) =>
        [
          `### ${f.name}`,
          "",
          f.description,
          "",
          "```",
          f.prompt,
          "```",
          "",
          `- Actions: ${f.actions.map((a) => actionTitles[a] ?? a).join("; ")}`,
          `- UI source: https://github.com/withoneai/forkable/blob/main/site/src/flows/${f.id}.tsx`,
        ].join("\n"),
      )
      .join("\n\n"),
    TOOL_COUNT: String(MCP_TOOLS.length),
    TOOL_LIST: MCP_TOOLS.map((t) => `\`${t}\``).join(", "),
    PLATFORM_COUNT: platformCount,
  }),
);

// Agent Skills Discovery index (RFC v0.2.0), as withone.ai serves it: the
// digest is the sha256 of exactly the bytes served at the skill's URL.
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

// A short agent card, the withone.ai agent.json shape cut down to what a
// static site has: what this is, the command, the templates and where the
// markdown lives.
out(
  ".well-known/agent.json",
  `${JSON.stringify(
    {
      name: "Forkable",
      description:
        "Fork a whole working business, not a blank page: the app, its agents, integrations and a go-to-market kit, MIT licensed. Sign in with One and the integrations come wired through One Connect, and every template starts on a keyless Acme Inc sample.",
      url: SITE_URL,
      publisher: { name: "One", url: "https://withone.ai" },
      license: "MIT",
      source: "https://github.com/withoneai/forkable",
      command: catalog.command,
      agentCommand: catalog.agentCommand,
      quickstart: `${SITE_URL}/start.md`,
      templates: {
        catalog: `${SITE_URL}/templates.json`,
        items: catalog.templates.map((t) => ({
          id: t.id,
          name: t.name,
          status: t.status,
          kind: t.kind,
          description: t.description,
          create: t.create,
          demo: t.demo,
          packageManager: t.packageManager,
        })),
      },
      skills: { index: `${SITE_URL}/.well-known/agent-skills/index.json`, forkable: SKILL_URL },
      content: {
        llms_txt: `${SITE_URL}/llms.txt`,
        pages: [
          { name: "Home", url: `${SITE_URL}/`, markdown: `${SITE_URL}/index.md` },
          { name: "Agent quickstart", url: `${SITE_URL}/start.md`, markdown: `${SITE_URL}/start.md` },
          { name: "Contribute", url: `${SITE_URL}/contribute`, markdown: `${SITE_URL}/contribute.md` },
          { name: "Apps inside your chat (the blocks MCP)", url: `${SITE_URL}/mcp`, markdown: `${SITE_URL}/mcp.md` },
        ],
      },
      rules: [
        "Put -- before create-forkable flags, or npm keeps them and the command fails.",
        "Success is the demo exiting 0. It needs no account and no keys.",
        "Read AGENTS.md in the fork before changing code.",
        "Stop and ask the human before any secret, git push, deploy or publish.",
        "Going live needs one Connect app, made by the human in the One dashboard.",
      ],
    },
    null,
    2,
  )}\n`,
);

// ARD capability manifest (ai-catalog data model), as withone.ai serves it.
const HOST = "forkable.dev";
out(
  ".well-known/ai-catalog.json",
  `${JSON.stringify(
    {
      specVersion: "1.0",
      host: { displayName: "Forkable", identifier: `did:web:${HOST}` },
      entries: [
        {
          identifier: `urn:air:${HOST}:skill:forkable`,
          displayName: "Forkable agent skill",
          description: "Agent skill for starting a business from a Forkable template and running its demo.",
          type: "text/markdown",
          url: SKILL_URL,
          representativeQueries: [
            "start a business from a template with my coding agent",
            "fork an open-source app with sign-in and integrations already wired",
            "scaffold an AI email client on Gmail",
          ],
        },
        {
          identifier: `urn:air:${HOST}:data:templates`,
          displayName: "Forkable templates",
          description: "Every Forkable template with its id, platforms, package manager and create command.",
          type: "application/json",
          url: `${SITE_URL}/templates.json`,
          representativeQueries: ["list Forkable templates", "which business templates can I fork"],
        },
        {
          identifier: `urn:air:${HOST}:docs:llms`,
          displayName: "Forkable llms.txt",
          description: "Index of forkable.dev for AI agents, with the command, the templates and the markdown pages.",
          type: "text/plain",
          url: `${SITE_URL}/llms.txt`,
          representativeQueries: ["what is Forkable (forkable.dev)", "how do I fork a business with Forkable"],
        },
      ],
    },
    null,
    2,
  )}\n`,
);
