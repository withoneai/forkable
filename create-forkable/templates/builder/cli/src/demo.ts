// `pnpm start`: the keyless demo. Offline, no keys, the replay agent. Runs
// the real engine (scaffold, turn, typecheck, auto-fix, checkpoints,
// restore) on a scratch BUILDER_HOME and prints what happened. One Connect
// runs on the sample template (fake values, the stub One answers sign-in
// and calls), so the app's own call is refused by One's stand-in exactly as
// One refuses it, and the preview's local check refuses its own.

import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { BRAND, createPlatform, GEN_FILE, PREVIEW_CALLBACK, scanLine, VERSION, type Checkpoint, type Platform, type Receipt, linkScratchTemplateCache } from "@builder/core";

const GET_THREADS = "conn_mod_def::GGSNlnppgZ0::qk3CudDWTVKPY7hpPVCqLQ";
const SEND_EMAIL = "conn_mod_def::GGXAjWkZO8U::uMc1LQIHTTKzeMm3rLL5gQ";

/** Any request off this machine throws: the demo must never touch the network. */
export function installOfflineGuard(): void {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname) && !url.hostname.endsWith(".localhost")) {
      throw new Error(`Offline demo: refused a request to ${url.hostname}`);
    }
    return real(input, init);
  }) as typeof fetch;
}

const label = (cp: Checkpoint, turnNo: Map<string, string>): string => {
  if (cp.kind === "template") return "Template";
  if (cp.kind === "restore") return "restore";
  if (cp.kind === "manual") return "manual edits";
  return (cp.turnId && turnNo.get(cp.turnId)) || cp.kind;
};

export async function demo(args: string[]): Promise<number> {
  const t0 = Date.now();
  installOfflineGuard();
  const keep = args.includes("--keep");
  const scratch = mkdtempSync(join(tmpdir(), `${BRAND.slug}-demo-`));
  // A warm template cache under tmp, shared across runs; never the real home's.
  linkScratchTemplateCache(scratch);

  const out = (s: string) => console.log(s);
  out(`${BRAND.name} ${VERSION} · keyless demo, replay agent, no keys`);
  let platform: Platform | null = null;
  try {
    platform = await createPlatform({
      home: scratch,
      preview: false,
      // The stub grant: catalog answers from public catalog fixtures, every One answer labeled Sample.
      grant: "sample",
      engine: { quietMs: 150, replaySpeed: 0 },
      publish: { pollMs: 0 },
    });
    const p = platform;
    const created = await p.workspace.create({ name: "acme-tasks", harness: "replay", model: "demo", permission: "build", autoFix: true });
    const project = created.row;
    out(`  ${"project".padEnd(9)} ${project.slug}`);

    const prompt = "A task list for Acme Inc";
    const turn = await p.turns.submit(project, { prompt });
    await p.turns.idle(project.id, 120_000);

    const all = (await p.turns.list(project.id)).turns.reverse();
    const user = all.find((t) => t.id === turn.id)!;
    const fixes = all.filter((t) => t.parentTurnId === turn.id);
    const cps = await p.checkpoints.list(project.id);
    const cp1 = cps.find((c) => c.turnId === user.id);
    if (!cp1) throw new Error("Turn 1 made no checkpoint");
    out(`  ${"turn 1".padEnd(9)} "${prompt}"   ${cp1.files.length} files, +${cp1.additions} -${cp1.deletions}   checkpoint ${cp1.shortSha}`);

    // The type errors turn 1 left behind (they are resolved now; read them from the fix turn's target list).
    const errs = (await p.errors.list(project.id, false)).filter((e) => e.turnId === user.id && e.source === "types");
    if (errs.length) {
      const e = errs[0]!;
      out(`  ${"errors".padEnd(9)} ${errs.length} type error${errs.length === 1 ? "" : "s"} after turn 1 (${e.file}:${e.line})`);
    } else {
      out(`  ${"errors".padEnd(9)} none after turn 1`);
    }
    const turnNo = new Map<string, string>([[user.id, "turn 1"]]);
    for (const f of fixes) {
      const cp = cps.find((c) => c.turnId === f.id);
      turnNo.set(f.id, `fix ${f.fixAttempt}`);
      const stillOpen = (await p.errors.open(project.id)).filter((e) => e.severity === "error").length;
      out(`  ${`fix ${f.fixAttempt}`.padEnd(9)} ${f.status === "done" && stillOpen === 0 ? "fixed" : f.status}   checkpoint ${cp?.shortSha ?? "none"}`);
    }
    const parent = await p.turns.get(user.id);
    if (parent?.status !== "done") throw new Error(`Turn 1 ended ${parent?.status}: ${parent?.error ?? ""}`);

    const restored = await p.checkpoints.restore(project.id, project.path, cp1.sha);
    out(`  ${"restore".padEnd(9)} to ${cp1.shortSha} as new commit ${restored.shortSha}`);
    const history = (await p.checkpoints.list(project.id)).reverse().map((c) => label(c, turnNo));
    out(`  ${"history".padEnd(9)} ${history.join(", ")}`);

    // ---- One built in, on the stub grant ----------------------
    const found = await p.catalog.find("gmail", "send an email");
    const top = found.picks[0];
    if (!top) throw new Error("The catalog found no Gmail action for sending");
    out(`  ${"catalog".padEnd(9)} gmail "send an email" -> ${top.title} (sample knowledge)`);
    // What the agent's one_add_action calls do, then a turn that writes the routes.
    await p.scopes.add(project, GET_THREADS);
    await p.scopes.add(project, SEND_EMAIL);
    const turn2 = await p.turns.submit(project, { prompt: "An inbox page for Acme Inc: latest Gmail threads and a reply" });
    await p.turns.idle(project.id, 120_000);
    const t2 = await p.turns.get(turn2.id);
    if (t2?.status !== "done") throw new Error(`Turn 2 ended ${t2?.status}: ${t2?.error ?? ""}`);
    const gen = readFileSync(`${project.path}/${GEN_FILE}`, "utf8");
    const typed = (gen.match(/: action<\w+Input, \w+Output>\(/g) ?? []).length;
    const typeErrors = (await p.errors.open(project.id)).filter((e) => e.source === "types");
    if (typeErrors.length) throw new Error(`Generated wrappers do not typecheck: ${typeErrors[0]!.message}`);
    out(`  ${"codegen".padEnd(9)} ${GEN_FILE}, ${typed} action${typed === 1 ? "" : "s"} typed`);
    const { manifest } = await p.scopes.derive(project);
    const describe = await p.scopes.describe(manifest.actions);
    out(`  ${"manifest".padEnd(9)} ${manifest.actions.map((a) => describe(a)).join(", ") || "empty"}`);
    // One Connect, on the sample template: the app signs in on its own (sample) Connect app.
    const template = (await p.connect.list("template")).find((t) => t.sample);
    if (!template) throw new Error("The sample Connect template is missing");
    const on = await p.connect.apply(project, { use: "template", setupId: template.id });
    if (!on.enabled) throw new Error("One Connect did not turn on");
    const signedIn = await sampleSignIn(p, project.id);
    out(`  ${"connect".padEnd(9)} on, ${template.name}, signed in as ${signedIn}   [Sample]`);
    // The preview's local check refuses an action the code does not ask for (One is never called).
    const local = await p.access.local(project, "gmail");
    // Access, Ask One: the app runs a delete on the developer's sign-in, the stub One refuses it as One does, the app reports it.
    const ask = await p.access.pick(project, "gmail");
    if (!ask) throw new Error("No Gmail delete action to ask One about");
    const refused = await askOne(p, project, ask);
    const lines = [local.receipt, refused].filter((r): r is Receipt => Boolean(r));
    if (lines.length !== 2) throw new Error(`Expected two receipts, got ${lines.length}: ${local.note ?? ""}`);
    const width = Math.max(...lines.map((r) => r.line.length));
    lines.forEach((r, i) => out(`  ${(i === 0 ? "receipts" : "").padEnd(9)} ${r.line.padEnd(width)}   [${r.badge}]`));
    if (lines[0]!.source !== "local" || lines[0]!.line.includes("declined, 403")) throw new Error("A Local receipt must never read declined, 403");
    if (lines[1]!.source !== "sample" || !lines[1]!.line.endsWith("declined, 403")) throw new Error("The sample One's refusal must read declined, 403, labeled Sample");

    // ---- Publish, on the stub grant ---------------------------
    const scan = await p.publish.scan(project);
    out(`  ${"scan".padEnd(9)} ${scanLine(scan)}`);
    if (!scan.ok) throw new Error(`The scan blocked the demo app: ${scan.blocks.map((b) => b.title).join("; ")}`);
    const gh = await p.publish.publish(project, { target: "github", options: { repo: project.slug, visibility: "private" } });
    const ghDone = await gh.done;
    if (ghDone.status !== "ok" || ghDone.result?.kind !== "github") throw new Error(`GitHub export failed: ${ghDone.error}`);
    const c = ghDone.result.counts;
    const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
    out(`  ${"publish".padEnd(9)} GitHub (stub grant) ${plural(c.repo, "repo")}, ${plural(c.blobs, "blob")}, ${plural(c.trees, "tree")}, ${plural(c.commits, "commit")}, ${plural(c.refs, "ref")}  ${ghDone.result.private ? "private" : "PUBLIC"}`);
    if (!ghDone.result.private) throw new Error("The demo export must be private");
    // The client id and secrets come from the project's Connect app (the sample template), never the dialog.
    const vc = await p.publish.publish(project, { target: "vercel", options: { project: project.slug } });
    const vcDone = await vc.done;
    if (vcDone.status !== "ok" || vcDone.result?.kind !== "vercel") throw new Error(`Vercel deploy failed: ${vcDone.error}`);
    const v = vcDone.result;
    const connected = v.health.checklist.filter((x) => ["clientId", "clientSecret", "connectKey", "redirectUri"].includes(x.key)).every((x) => x.ok);
    out(`  ${"".padEnd(9)} Vercel (stub grant) ${v.counts.project ? "project" : "same project"}, env x${v.counts.env}, ${v.counts.deployment ? "deployment" : "no deployment"}, health ${v.health.reached ? "ok" : "not reached"}${connected ? ", Connect app set" : ""}`);
    if (!v.health.reached) throw new Error("The sample deployment's health did not answer");
    if (!connected) throw new Error("The sample deployment is missing its Connect app values");
    out(`  ${"done".padEnd(9)} in ${((Date.now() - t0) / 1000).toFixed(1)} s${keep ? `, files kept in ${project.path}` : ""}`);
    return 0;
  } catch (err) {
    console.error(`  demo failed: ${(err as Error).message}`);
    return 1;
  } finally {
    await platform?.stop().catch(() => {});
    if (!keep) rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * What the app's /api/one/authorize and /api/one/callback do in preview, on
 * the stub One: bind the state through the dev check, authorize with PKCE
 * S256 on the shared callback, take the state back once, exchange the code.
 * Returns who signed in. Values stay in this process.
 */
async function sampleSignIn(p: Platform, projectId: string): Promise<string> {
  const stub = p.stubOne;
  if (!stub) throw new Error("No sample One");
  const env = await p.connect.previewEnv(projectId);
  const row = (await p.workspace.get(projectId))!;
  const state = randomBytes(18).toString("base64url");
  if (!p.connect.bindState(row.id, row.slug, state)) throw new Error("Could not bind the sign-in state");
  const verifier = randomBytes(32).toString("base64url");
  const q = new URLSearchParams({ client_id: env.ONE_CLIENT_ID!, redirect_uri: env.ONE_REDIRECT_URI!, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", state });
  const auth = await stub.handle(new Request(`http://127.0.0.1/api/stub-one/oauth/authorize?${q}`), "oauth/authorize");
  const back = new URL(auth.headers.get("location") ?? "http://x/");
  if (`${back.origin}${back.pathname}` !== PREVIEW_CALLBACK) throw new Error("The sample One did not answer on the shared callback");
  const pending = p.connect.takeState(back.searchParams.get("state"));
  if (pending?.projectId !== row.id) throw new Error("The shared callback lost the sign-in");
  const tok = await stub.handle(
    new Request("http://127.0.0.1/api/stub-one/oauth/token", {
      method: "POST",
      headers: { authorization: `Basic ${Buffer.from(`${env.ONE_CLIENT_ID}:${env.ONE_CLIENT_SECRET}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: back.searchParams.get("code") ?? "", redirect_uri: PREVIEW_CALLBACK, code_verifier: verifier }),
    }),
    "oauth/token",
  );
  const { connect_user_id: cu } = (await tok.json()) as { connect_user_id?: string };
  if (!cu) throw new Error("The sample sign-in gave no connect user");
  const who = (await (await stub.handle(new Request("http://127.0.0.1/api/stub-one/v1/users/whoami", { headers: { "x-one-secret": env.ONE_CONNECT_KEY!, "x-one-connect-user-id": cu } }), "v1/users/whoami")).json()) as { user?: { name?: string } };
  sessions.set(projectId, cu);
  return who.user?.name ?? "the sample developer";
}

const sessions = new Map<string, string>();

/**
 * Access's Ask One, the way the app's /api/one/dev/receipt-test runs it: the
 * call on the signed-in developer's grant to the app (the stub One here),
 * then the report to the local check, which records One's answer.
 */
async function askOne(p: Platform, project: { id: string; name: string; path: string }, a: { actionId: string; title: string; method: string; path: string }): Promise<Receipt | null> {
  const env = await p.connect.previewEnv(project.id);
  const path = a.path.replace(/\{\{?\s*user_?id\s*\}?\}/gi, "me").replace(/\{\{?\s*\w+\s*\}?\}/g, "demo-thread");
  const t0 = Date.now();
  const res = await p.stubOne!.handle(
    new Request(`http://127.0.0.1/api/stub-one/v1/passthrough${path}`, { method: a.method, headers: { "x-one-secret": env.ONE_CONNECT_KEY!, "x-one-connect-user-id": sessions.get(project.id) ?? "", "x-one-action-id": a.actionId, "x-one-connection-key": "sample::gmail::acme" } }),
    `v1/passthrough${path}`,
  );
  const { receipt } = await p.gate.report(project, { platform: "gmail", actionId: a.actionId, title: a.title, method: a.method, path: a.path, status: res.status, ok: res.ok, blockedByGrant: res.status === 403, ms: Date.now() - t0 });
  return receipt;
}
