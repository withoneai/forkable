// Smoke check://   pnpm exec tsx server/scripts/smoke-publish.ts
// On the stub grant, offline: the scan, a GitHub export and a Vercel deploy
// through the HTTP routes. The stub records every runAction; this checks
// the exact publish action ids in order, private by default
// (public refused without the confirmation), the project's own Connect app
// (per-project Connect) going to Vercel with the client id plain and the
// secret and connect key in one sensitive call, never in GitHub's bodies or
// any other call, the database token in exactly one call and nowhere kept,
// the health answer parsed into the checklist, the badges, and a planted
// secret blocking the publish before any call. Exits 0 when all pass.

import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BRAND, createPlatform, schema, type CheckpointsResponse, type ProjectEvent, type PublishesResponse, type ScanResult, linkScratchTemplateCache } from "@builder/core";
import { createApp } from "../src/app.js";
import { createHub } from "../src/hub.js";

// The publish action ids, typed out again here so a drift in actions.ts fails the smoke.
const ID = {
  createRepo: "conn_mod_def::GJ3Z4tE4G5A::lTHBrlzlSouqu-x8AHeT3Q",
  blob: "conn_mod_def::GJ3ZJkM0oow::6pCvkMJYSue8xhH4Bvy6eQ",
  tree: "conn_mod_def::GJ3ZKCHKkUA::xHBDE-LtSkWfVdTQxLIp3g",
  commit: "conn_mod_def::GJ3ZJrwmLbo::Rp9vt2o3RBqDxBLQ1sRRng",
  getRef: "conn_mod_def::GJ3ZKe5vDKs::xb13z7ZBRnOWekJ-N_TG3w",
  createRef: "conn_mod_def::GJ3ZJzQSbw4::FMDSgh1WS5mvn2imiAkk2w",
  updateRef: "conn_mod_def::GJ3ZK-BoUAw::f8MXbEVgQJ2sEdoPzO3NPA",
  project: "conn_mod_def::GIi2endVvxY::4QRYvqrsShinBQfxYdpIMA",
  deployment: "conn_mod_def::GIi152aO03U::KTvTF_0ZTaS3tObzavwy0g",
  env: "conn_mod_def::GIi2iy8hP4o::Bn9C2U8RREySIMiqwHKn2w",
  getDeployment: "conn_mod_def::GIi15DgMrtk::4sacesKzT3abQ63_h7ZSfw",
};

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${detail ? `   (${detail})` : ""}`);
  if (!ok) failures++;
};

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error(`smoke-publish: refused a request to ${url.hostname}`);
  return realFetch(input, init);
}) as typeof fetch;

const scratch = mkdtempSync(join(tmpdir(), `${BRAND.slug}-smoke-publish-`));
linkScratchTemplateCache(scratch);
// Placeholder values standing in for the project's own Connect app (per-project Connect, write-only store).
const CONNECT = { ONE_CLIENT_ID: "smoke-client-id-0001", ONE_CLIENT_SECRET: "one_secret_smokeplaceholder0002", ONE_CONNECT_KEY: "sk_live_smokeplaceholder0003", ONE_PERMISSION_SET: "ask_smoke_0004" };
const SECRET_VALUES = [CONNECT.ONE_CLIENT_SECRET, CONNECT.ONE_CONNECT_KEY];
const DB_TOKEN = "eyJhbGciOiJFZERTQSJ9.smoke-database-token-0004";

const logs: string[] = [];
const events: ProjectEvent[] = [];
const t0 = Date.now();
const p = await createPlatform({ home: scratch, preview: false, grant: "sample", log: (l) => logs.push(l), publish: { pollMs: 0 }, env: { backend: "file" } });
try {
  p.bus.on((_id, e) => events.push(e));
  const app = createApp({ platform: p, hub: createHub(), detect: async () => [], log: (l) => logs.push(l) });
  const stub = p.one.stub!;
  const json = async <T>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> => {
    const res = await app.request(path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: (await res.json()) as T };
  };

  const { row: project } = await p.workspace.create({ name: "acme-tasks", harness: "replay", model: "demo", permission: "build", autoFix: true });
  const P = `/api/projects/${project.id}`;
  check("no builder-level .env is written", !existsSync(join(scratch, ".env")));
  // The project's own Connect app, on.
  const own = await p.connect.apply(project, { use: "new" });
  await p.env.saveSetup(own.setupId!, CONNECT);
  const on = await p.connect.apply(project, { enabled: true });
  check("the project has its own Connect app, on", on.enabled && on.via === "new");

  const pub0 = await json<PublishesResponse>("GET", `${P}/publishes`);
  check("publishes: the sample grant reaches GitHub and Vercel", pub0.body.grant === "sample" && pub0.body.targets.github.connected && pub0.body.targets.vercel.connected);
  check("publishes: the head checkpoint is what would ship", pub0.body.head?.subject === "Template" && pub0.body.publishes.length === 0);

  const scan = await json<{ scan: ScanResult }>("POST", `${P}/publish/scan`, {});
  const s = scan.body.scan;
  check("scan passes on a fresh app", scan.status === 200 && s.ok, s.blocks.map((b) => b.title).join("; ") || `${s.files} files, ${(s.ms / 1000).toFixed(1)} s`);
  check("scan ran build and typecheck on a clean tree", s.checks.build === "ok" && s.checks.typecheck === "ok" && s.checks.manifest === "matches");
  check("scan cleaned its scratch tree", !readdirSync(p.home.stateFor(project.id)).some((n) => n.startsWith("scan-")));

  // Public is never the default and never happens without the confirmation.
  const before = stub.runs.length;
  const pub = await json<{ error: { code: string } }>("POST", `${P}/publish`, { target: "github", options: { repo: "acme-tasks", visibility: "public" } });
  check("public without the confirmation is refused before any call", pub.status === 400 && pub.body.error.code === "public_unconfirmed" && stub.runs.length === before);

  // GitHub, first export, default visibility.
  const gh = await json<{ publish: { id: number; status: string } }>("POST", `${P}/publish`, { target: "github", options: { repo: "acme-tasks" } });
  check("GitHub publish starts (202)", gh.status === 202 && gh.body.publish.status === "running");
  await p.publish.idle(project.id);
  const ghRuns = stub.runs.slice(before);
  const ids = ghRuns.map((r) => r.actionId);
  const blobs = ids.filter((i) => i === ID.blob).length;
  const expected = [ID.createRepo, ...Array(blobs).fill(ID.blob), ID.tree, ID.commit, ID.createRef];
  check("GitHub: create repo, a blob per file, tree, commit, create ref, in that order", JSON.stringify(ids) === JSON.stringify(expected), `${ids.length} calls, ${blobs} blobs`);
  const repoBody = (ghRuns[0]?.body ?? {}) as { name?: string; private?: boolean; auto_init?: boolean };
  check("GitHub: private by default, no auto-init", repoBody.name === "acme-tasks" && repoBody.private === true && repoBody.auto_init === false, JSON.stringify(repoBody));
  check("GitHub: every call on the builder's GitHub connection", ghRuns.every((r) => r.connectionKey === "sample::github::acme"));
  const list1 = await json<PublishesResponse>("GET", `${P}/publishes`);
  const ghRec = list1.body.publishes[0]!;
  check("GitHub publish recorded ok with the repo and URL", ghRec.status === "ok" && ghRec.repo === "acme-inc/acme-tasks" && ghRec.url === "https://github.com/acme-inc/acme-tasks" && ghRec.result?.kind === "github" && ghRec.result.private === true, ghRec.error ?? ghRec.url ?? "");
  check("GitHub publish stored its scan and manifest hash", ghRec.scan?.ok === true && ghRec.manifestHash === s.manifestHash);

  // Later export: get ref, then update main without force.
  const mark2 = stub.runs.length;
  await json("POST", `${P}/publish`, { target: "github", options: { repo: "acme-tasks", visibility: "private" } });
  await p.publish.idle(project.id);
  const later = stub.runs.slice(mark2).map((r) => r.actionId);
  check("GitHub later export: get ref first, update ref last, no new repo", later[0] === ID.getRef && later.at(-1) === ID.updateRef && !later.includes(ID.createRepo) && (stub.runs.at(-1)!.body as { force?: boolean }).force === false);

  // Vercel with the database URL and token.
  const mark3 = stub.runs.length;
  const vc = await json<{ publish: { id: number } }>("POST", `${P}/publish`, { target: "vercel", options: { project: "acme-tasks", databaseUrl: "libsql://acme-tasks.example.io", databaseAuthToken: DB_TOKEN } });
  check("Vercel publish starts (202)", vc.status === 202);
  await p.publish.idle(project.id);
  const vRuns = stub.runs.slice(mark3);
  const vIds = vRuns.map((r) => r.actionId);
  const polls = vIds.filter((i) => i === ID.getDeployment).length;
  check("Vercel: project, env, env (token alone), env (the app's secrets), deployment, then status polls", JSON.stringify(vIds) === JSON.stringify([ID.project, ID.env, ID.env, ID.env, ID.deployment, ...Array(polls).fill(ID.getDeployment)]) && polls >= 1, `${polls} polls`);
  const created = vRuns[0]?.body as Record<string, unknown>;
  check("Vercel project: vite, pnpm build:vercel, dist/client", created?.framework === "vite" && created.buildCommand === "pnpm build:vercel" && created.outputDirectory === "dist/client");
  const env1 = (vRuns[1]?.body as { key: string; type: string; value?: string }[]) ?? [];
  check("Vercel env: ONE_MODE, ONE_CLIENT_ID, ONE_REDIRECT_URI, ONE_PERMISSION_SET, APP_VISITOR_ACTIONS, DATABASE_URL, none a secret", env1.map((e) => e.key).join(",") === "ONE_MODE,ONE_CLIENT_ID,ONE_REDIRECT_URI,ONE_PERMISSION_SET,APP_VISITOR_ACTIONS,DATABASE_URL", env1.map((e) => e.key).join(","));
  check("the client id and ask id come from the project's Connect app, ONE_MODE connect", env1.find((e) => e.key === "ONE_CLIENT_ID")?.value === CONNECT.ONE_CLIENT_ID && env1.find((e) => e.key === "ONE_PERMISSION_SET")?.value === CONNECT.ONE_PERMISSION_SET && env1.find((e) => e.key === "ONE_MODE")?.value === "connect");
  check("APP_VISITOR_ACTIONS is none for an app with no visitor actions", env1.find((e) => e.key === "APP_VISITOR_ACTIONS")?.value === "none");
  const env3 = (vRuns[3]?.body as { key: string; type: string; value?: string }[]) ?? [];
  check("the Connect app's secret and connect key go in one call, as sensitive", JSON.stringify(env3.map((e) => [e.key, e.type]).sort()) === JSON.stringify([["ONE_CLIENT_SECRET", "sensitive"], ["ONE_CONNECT_KEY", "sensitive"]]) && env3.find((e) => e.key === "ONE_CONNECT_KEY")?.value === CONNECT.ONE_CONNECT_KEY);
  const dep = vRuns[4]?.body as { files?: { file: string }[]; target?: string };
  check("Vercel deployment: files inline from git at the sha, production", dep?.target === "production" && (dep.files?.length ?? 0) === s.files && !dep.files!.some((f) => f.file === ".dev.vars"), `${dep?.files?.length} files`);
  const list2 = await json<PublishesResponse>("GET", `${P}/publishes`);
  const vRec = list2.body.publishes[0]!;
  const v = vRec.result?.kind === "vercel" ? vRec.result : null;
  const ok = Object.fromEntries((v?.health.checklist ?? []).map((c) => [c.key, c.ok]));
  check("health parsed into the checklist", !!v?.health.reached && ok.clientId === true && ok.redirectUri === true && ok.permissionSet === true && ok.db === true && ok.databaseAuthToken === true && ok.clientSecret === true && ok.connectKey === true, JSON.stringify(ok));
  check("Vercel publish recorded with the production URL and redirect URI", vRec.status === "ok" && vRec.url === "https://acme-tasks.vercel.app" && v?.redirectUri === "https://acme-tasks.vercel.app/api/one/callback");

  // Secrets.
  const bodies = stub.runs.map((r) => JSON.stringify(r));
  const withSecrets = bodies.filter((b) => SECRET_VALUES.some((x) => b.includes(x)));
  check("the Connect app's secrets are in that one Vercel call and no other body (GitHub's included)", withSecrets.length === 1 && withSecrets[0] === JSON.stringify(vRuns[3]), `${bodies.length} bodies`);
  check("the client id is in the plain env call only", bodies.filter((b) => b.includes(CONNECT.ONE_CLIENT_ID)).length === 1);
  const withToken = stub.runs.filter((r) => JSON.stringify(r).includes(DB_TOKEN));
  check("the database token is in exactly one call, as a sensitive variable", withToken.length === 1 && JSON.stringify(withToken[0]!.body) === JSON.stringify([{ key: "DATABASE_AUTH_TOKEN", value: DB_TOKEN, type: "sensitive", target: ["production", "preview"] }]));
  const rows = JSON.stringify(await p.database.db.select().from(schema.publishes)) + JSON.stringify(await p.database.db.select().from(schema.activity));
  const kept = [rows, JSON.stringify(events), logs.join("\n"), JSON.stringify(list2.body)];
  check("the token is nowhere kept: publishes, activity, events, logs, the history response", !kept.some((k) => k.includes(DB_TOKEN)));
  check("nor the Connect app's secrets", !kept.some((k) => SECRET_VALUES.some((x) => k.includes(x))));
  check("the history keeps the database host only", vRec.options?.databaseHost === "acme-tasks.example.io" && !JSON.stringify(vRec.options).includes("libsql://"));
  const acts = await p.activity.list(project.id, undefined, 500);
  check("every publish call is an Activity row with source platform", acts.rows.filter((r) => r.source === "platform" && (r.platform === "github" || r.platform === "vercel")).length === stub.runs.length);
  check("publish.progress and publish.done went out on the bus", events.some((e) => e.type === "publish.progress" && e.target === "github") && events.filter((e) => e.type === "publish.done").length === 3);

  // Badges.
  const cps = await json<CheckpointsResponse>("GET", `${P}/checkpoints`);
  const head = cps.body.checkpoints[0]!;
  check("the checkpoint is badged Published to GitHub and Vercel", head.published.includes("github") && head.published.includes("vercel"));

  // A planted secret blocks before any call.
  writeFileSync(join(project.path, "server", "billing.ts"), 'export const stripe = "sk_live' + '_51HxAcmeSmokeTest000000000";\n');
  await json("POST", `${P}/checkpoint`);
  const mark4 = stub.runs.length;
  const blocked = await json<{ error: { code: string }; scan?: ScanResult }>("POST", `${P}/publish`, { target: "github", options: { repo: "acme-tasks" } });
  check("a planted sk_live_ blocks the publish with the finding, before any call", blocked.status === 409 && blocked.body.error.code === "scan_blocked" && !!blocked.body.scan?.blocks.some((b) => b.code === "secret" && b.file === "server/billing.ts") && stub.runs.length === mark4);
  check("the finding never carries the value", !JSON.stringify(blocked.body).includes("sk_live_51Hx"));
} catch (err) {
  check("smoke ran to the end", false, (err as Error).stack ?? String(err));
} finally {
  await p.stop();
  rmSync(scratch, { recursive: true, force: true });
}
console.log(`\n${failures ? `${failures} check(s) failed` : "all checks passed"} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(failures ? 1 : 0);
