// Single source for the FAQ section's copy. Mirrored by hand into the
// FAQPage JSON-LD in index.html. Keep the two in sync.
export const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: "What do I need to run it?",
    a: "macOS or Linux, Node 22, and Claude Code or Codex installed and signed in. Fork it, run it, and type what you want on Home. The first project is ready in about a minute; after that, a few seconds.",
  },
  {
    q: "Who pays for the AI?",
    a: "You do, directly, through the coding agent you already use. There are no credits and no markup. Builder drives your Claude Code or Codex, and its plan covers the turns.",
  },
  {
    q: "How does an app connect to Gmail, Slack or Stripe?",
    a: "Through One. The agent finds the action in One's catalog and writes a typed call to it. The people who use your app sign in with One and connect their own accounts, so the app never holds a provider key.",
  },
  {
    q: "What does one-click publish actually do?",
    a: "It checks the version you are on (typecheck, build, secrets, access list, audit), then deploys it to Vercel or exports it to a GitHub repo, on your own One account.",
  },
  {
    q: "Is the code mine?",
    a: "Yes. Every project is a plain git repo on your machine: React, Hono and Drizzle. Builder itself is open source.",
  },
];
