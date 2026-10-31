import { existsSync, readFileSync } from "node:fs";
import { defineConnectApp } from "@withone/connect/config";

// Search's Connect app as code. `pnpm connect` runs `one connect create` on it:
// you approve the app in the browser, and the CLI writes its ids to .env.
//
// The ask comes from connect.manifest.json, so the app asks for exactly what
// the code calls. Entries with "grant": false (the declined, 403 receipt) and
// One's own scopes (platform "one") are left out; @withone/connect 0.19 asks
// for user:profile:read by default. Anthropic joins the ask only for a hosted
// build (SEARCH_HOSTED=1): on your own computer the assistant runs on the
// Claude Code or Codex you already have (packages/core/src/local-agent.ts). What the
// New profile flow added (connect.extra.json, SPEC D26) joins too: the exact actions
// its profiles call, merged into the platform's custom ask, or a whole platform as
// read-only (older drafts) when nothing else asks for it.
type Entry = { platform: string; actionId: string; grant?: boolean };
type Ask = { access: "custom"; actions: [string, ...string[]] } | { access: "read-only" };
const manifest = JSON.parse(readFileSync(new URL("./connect.manifest.json", import.meta.url), "utf8")) as { actions: Entry[] };
const ask: Record<string, Ask> = {};
for (const a of manifest.actions) {
  if (a.platform === "one" || a.grant === false) continue;
  if (a.platform === "anthropic" && process.env.SEARCH_HOSTED !== "1") continue;
  const cur = (ask[a.platform] ??= { access: "custom", actions: [] as unknown as [string] });
  if (cur.access === "custom") cur.actions.push(a.actionId);
}
const extraFile = new URL("./connect.extra.json", import.meta.url);
const extra = existsSync(extraFile) ? (JSON.parse(readFileSync(extraFile, "utf8")) as { platforms?: Record<string, { access?: string; actions?: string[] }> }) : {};
for (const [p, e] of Object.entries(extra.platforms ?? {})) {
  const cur = ask[p];
  if (e.access === "read-only" && !cur) ask[p] = { access: "read-only" }; // already every read
  else if (e.actions?.length && cur?.access !== "read-only") {
    const actions = (cur?.actions ?? []) as string[];
    for (const id of e.actions) if (!actions.includes(id)) actions.push(id);
    ask[p] = { access: "custom", actions: actions as [string, ...string[]] };
  }
}

export default defineConnectApp({
  name: "Search",
  reason: "Search indexes the tools you connect so you can find anything and ask about it. It only reads.",
  homepageUrl: "https://search.forkable.dev",
  // The Search icon from the Forkable brand kit, uploaded to the public-assets
  // R2 bucket (Buildable account). Re-upload there if the kit changes.
  logoUrl: "https://pub-6fe8ebddc11f4e8cb27fee4200b5bec8.r2.dev/forkable/search/icon-512.png",
  // The server pins this port (server/src/config.ts), so the redirect never floats.
  redirectUris: ["http://localhost:52289/api/one/callback"],
  branding: { panelColor: "#0A0A0A", buttonColor: "#0A0A0A" },
  ask,
});
