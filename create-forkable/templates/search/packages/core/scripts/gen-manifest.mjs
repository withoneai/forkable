// Writes <repo>/connect.manifest.json from the built-in packs plus the actions core itself calls.
// Every action one.call can make is listed; test/profiles.test.ts fails when one is missing.
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const actions = [];
const seen = new Set();
const add = (a) => { const k = `${a.platform}|${a.actionId}`; if (seen.has(k)) return; seen.add(k); actions.push(a); };
const walkReq = (r, out) => { if (r && typeof r === "object" && typeof r.actionId === "string") out.push(r.actionId); };
export function profileActionIds(p) {
  const ids = [];
  walkReq(p.account?.request, ids); walkReq(p.list, ids); walkReq(p.hydrate?.request, ids);
  for (const c of p.hydrate?.children ?? []) walkReq(c.request, ids);
  for (let ps = p.partitions; ps; ps = ps.next) walkReq(ps, ids);
  if (p.incremental?.bootstrap) walkReq(p.incremental.bootstrap, ids);
  return ids.filter((id) => !id.startsWith("sample::") && !id.startsWith("TBD:"));
}
for (const dir of readdirSync(join(root, "profiles")).sort()) {
  const f = join(root, "profiles", dir, "pack.json");
  if (!existsSync(f)) continue;
  const pack = JSON.parse(readFileSync(f, "utf8"));
  for (const p of pack.profiles) for (const id of profileActionIds(p)) add({ platform: p.platform, actionId: id, access: "read", usedBy: `profiles/${dir}/pack.json`, reason: `Index ${p.title} for search` });
}
const core = [
  ["openai", "conn_mod_def::GJ564JtA2kg::RZSxROt_TaGPn5dj1cERcg", "packages/core/src/embed/providers.ts", "Embed your text for semantic search"],
  ["gemini", "conn_mod_def::GKYsLheH12Q::Tpg2bcnfSjenI3U6jlwKzQ", "packages/core/src/embed/providers.ts", "Embed your text for semantic search"],
  ["cohere", "conn_mod_def::GOBI50QrjAs::W77uZN_sRAq12F_k0a3kEg", "packages/core/src/embed/providers.ts", "Embed your text for semantic search"],
  ["mistral-ai", "conn_mod_def::GMZh4j5K2IA::ZZRIBQWMS0-Kn1uey0EP4A", "packages/core/src/embed/providers.ts", "Embed your text for semantic search"],
  ["anthropic", "conn_mod_def::GJfJ6hmtpYo::zy68VQHpRFmqayjAzxkjDA", "packages/core/src/chat/run.ts", "Answer questions from your search results, with citations"],
  ["typesafe", "conn_mod_def::GNh4bXcHPaU::V2ndvy5CQJmYHvkElwVM_w", "packages/core/src/classify/jev.ts", "Sort results into lanes and match people across tools"],
];
for (const [platform, actionId, usedBy, reason] of core) add({ platform, actionId, access: "read", usedBy, reason });
add({ platform: "one", actionId: "user:profile:read", access: "read", usedBy: "server", reason: "Know who signed in" });
add({ platform: "gmail", actionId: "conn_mod_def::GJ3ocgKltKQ::s8UCfiDLSaO9w9oPU32TYA", access: "write", usedBy: "packages/core/src/one.ts", reason: "Never granted: the Access screen shows One declining it", grant: false });
// Each entry carries the action's HTTP method and path (the Access and source screens
// say "read only" from them, and a Read only grant covers GET only). They are kept from
// the previous manifest; `--fill` asks the One CLI (`one --agent actions load --toc`)
// for the ones still missing.
function fillMethods(list) {
  const missing = list.filter((a) => a.platform !== "one" && !a.method).map((a) => a.actionId);
  for (let i = 0; i < missing.length; i += 10) {
    const out = execFileSync("one", ["--agent", "actions", "load", ...missing.slice(i, i + 10), "--toc"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
    for (const l of JSON.parse(out).loaded ?? []) for (const a of list) if (a.actionId === l.actionId) { a.method = String(l.method).toUpperCase(); a.path = l.path; }
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = join(root, "connect.manifest.json");
  const prev = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const known = new Map((prev.actions ?? []).filter((a) => a.method).map((a) => [a.actionId, a]));
  for (const a of actions) { const k = known.get(a.actionId); if (k && a.platform !== "one") { a.method = k.method; a.path = k.path; } }
  if (process.argv.includes("--fill")) fillMethods(actions);
  const left = actions.filter((a) => a.platform !== "one" && !a.method).length;
  writeFileSync(file, JSON.stringify({ $schema: "https://forkable.dev/schema/connect.manifest.v1.json", app: prev.app ?? "search", actions }, null, 2) + "\n");
  console.log(`connect.manifest.json: ${actions.length} actions${left ? `, ${left} without a method (run with --fill)` : ""}`);
}
