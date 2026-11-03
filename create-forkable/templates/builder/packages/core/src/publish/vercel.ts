// Vercel deploy on the builder's own One account: create the
// project, set the variables that are not secrets, one deployment with the
// files inline (base64, so no text in them reads as a flow template), poll
// it, then read the app's own /api/one/health (booleans only) into a
// checklist.
//
// Secrets: the app's Connect app secret and connect key (per-project
// Connect) and its Environment values go as sensitive variables, in a call
// of their own; the database token too, alone. None is logged or returned,
// and error text is scrubbed of all of them before it leaves this module.

import type { HealthChecklistItem, VercelPublishResult } from "../api-types.js";
import { pathParams, VERCEL } from "./actions.js";
import { VISITOR_ENV } from "../visitors.js";
import { isBinary, type UploadFile } from "./files.js";
import { PublishError, type ActionRunner, type Progress, type RunAnswer } from "./github.js";

export const PROJECT_SETTINGS = {
  framework: "vite",
  buildCommand: "pnpm build:vercel",
  outputDirectory: "dist/client",
  installCommand: "pnpm install",
} as const;

export const redirectUriFor = (project: string): string => `https://${project}.vercel.app/api/one/callback`;

const PROJECT_NAME = /^[a-z0-9]([a-z0-9._-]{0,98}[a-z0-9])?$/;
export const validProjectName = (s: string): boolean => PROJECT_NAME.test(s) && !s.includes("---");

/** Values that look like a credential never go in the client id or ask id fields. */
export const looksSecret = (v: string): boolean => /^(sk_|rk_|one_secret_|ghp_|github_pat_|xox[bp]-|eyJ)|secret/i.test(v.trim());

export interface DatabaseUrlCheck {
  ok: boolean;
  host: string | null;
  message?: string;
}

export function checkDatabaseUrl(v: string): DatabaseUrlCheck {
  let u: URL;
  try {
    u = new URL(v.trim());
  } catch {
    return { ok: false, host: null, message: "That is not a URL. libSQL URLs look like libsql://acme-db.example.io." };
  }
  if (!["libsql:", "https:", "wss:"].includes(u.protocol)) return { ok: false, host: null, message: "Use a libsql:// or https:// URL." };
  if (u.password || u.username || [...u.searchParams.keys()].some((k) => /token|auth|key|secret/i.test(k))) {
    return { ok: false, host: u.host, message: "Take the token out of the URL. Put it in the token field, or set DATABASE_AUTH_TOKEN in Vercel." };
  }
  return { ok: true, host: u.host };
}

export interface VercelDeployInput {
  run: ActionRunner;
  progress?: Progress;
  files: UploadFile[];
  project: string;
  /** From the last Vercel publish of this project. */
  existingProjectId?: string | null;
  clientId?: string;
  permissionSet?: string;
  databaseUrl?: string;
  databaseAuthToken?: string;
  /** The project's Environment values for the published app; each goes as a sensitive variable, in its own call. */
  appEnv?: Record<string, string>;
  /** APP_VISITOR_ACTIONS from the scan: allowed owner-run action ids, or "none". */
  visitorActions?: string;
  /** "connect" when the app has One Connect on, else "off" (no One login, no One calls). */
  oneMode?: "connect" | "off";
  /** Reads <url>/api/one/health. Injected so the stub grant and tests stay offline. */
  health: (url: string) => Promise<unknown>;
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
  timeoutMs?: number;
}

const obj = (d: unknown): Record<string, unknown> => (d && typeof d === "object" ? (d as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/**
 * The deployment body: every file inline as base64. Text too: the call goes
 * through a One flow file, whose runner reads "{{" in a string as a
 * template, and JSX is full of `{{`.
 */
export function deploymentBody(project: string, projectId: string, files: UploadFile[]) {
  void isBinary;
  return {
    name: project,
    project: projectId,
    target: "production",
    files: files.filter((f) => f.mode !== "120000").map((f) => ({ file: f.path, data: f.content.toString("base64"), encoding: "base64" as const })),
    projectSettings: { ...PROJECT_SETTINGS },
  };
}

/** The variables the platform sets: none of them is a secret. */
export function plainEnv(i: Pick<VercelDeployInput, "project" | "clientId" | "permissionSet" | "databaseUrl" | "visitorActions" | "oneMode">): { key: string; value: string; type: "plain" | "encrypted"; target: string[] }[] {
  const target = ["production", "preview"];
  const out: { key: string; value: string; type: "plain" | "encrypted"; target: string[] }[] = [
    { key: "ONE_MODE", value: i.oneMode ?? "connect", type: "plain", target },
    { key: "ONE_REDIRECT_URI", value: redirectUriFor(i.project), type: "plain", target },
  ];
  if (i.clientId?.trim()) out.splice(1, 0, { key: "ONE_CLIENT_ID", value: i.clientId.trim(), type: "plain", target });
  if (i.permissionSet?.trim()) out.push({ key: "ONE_PERMISSION_SET", value: i.permissionSet.trim(), type: "plain", target });
  // Always set, so turning visitors off and deploying again takes it away.
  out.push({ key: VISITOR_ENV, value: i.visitorActions?.trim() || "none", type: "plain", target });
  if (i.databaseUrl?.trim()) out.push({ key: "DATABASE_URL", value: i.databaseUrl.trim(), type: "encrypted", target });
  return out;
}

const HEALTH_ITEMS: { key: string; label: string; how: string; db?: boolean }[] = [
  { key: "clientId", label: "ONE_CLIENT_ID", how: "Turn on One Connect in this project's Settings and deploy again." },
  { key: "clientSecret", label: "ONE_CLIENT_SECRET", how: "Add the client secret to this app's Connect app in Settings, One Connect, and deploy again. It goes to Vercel as a sensitive variable." },
  { key: "connectKey", label: "ONE_CONNECT_KEY", how: "Add the connect key to this app's Connect app in Settings, One Connect, and deploy again. It goes to Vercel as a sensitive variable." },
  { key: "redirectUri", label: "ONE_REDIRECT_URI", how: "Deploy again; the platform sets it. Register the same address in the Connect app's redirect URIs." },
  { key: "permissionSet", label: "ONE_PERMISSION_SET", how: "Create the ask from the Access tab's JSON in the One dashboard, add its id to the Connect app and deploy again." },
  { key: "db", label: "Database (DATABASE_URL)", how: "Add your libSQL database URL here and deploy again. Sign-in stores its users there.", db: true },
  { key: "databaseAuthToken", label: "DATABASE_AUTH_TOKEN", how: "Set it in Vercel, or give it once in this dialog.", db: true },
];

/** /api/one/health into a checklist. Unknown or missing fields read as not set. */
export function healthChecklist(h: unknown): { mode: string | null; checklist: HealthChecklistItem[] } {
  const o = obj(h);
  const c = obj(o.configured);
  return {
    mode: str(o.mode),
    checklist: HEALTH_ITEMS.map((it) => ({ key: it.key, label: it.label, how: it.how, ok: it.key === "db" ? o.db === true : c[it.key] === true })),
  };
}

export async function deployToVercel(i: VercelDeployInput): Promise<VercelPublishResult> {
  const p = i.progress ?? (() => {});
  const secret = i.databaseAuthToken?.trim() || null;
  const hidden = [secret, ...Object.values(i.appEnv ?? {})].filter((v): v is string => Boolean(v && v.length >= 4)).sort((a, b) => b.length - a.length);
  const scrub = (s: string) => hidden.reduce((out, v) => out.split(v).join("***"), s);
  const sleep = i.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const counts = { project: 0, env: 0, deployment: 0, polls: 0 };
  const fail = (step: string, r: RunAnswer, what: string) => {
    if (r.blockedByGrant) return new PublishError(`One refused ${what}: your grant does not include it. Widen Vercel's access in your One account, then try again.`, step, r.status, true);
    const m = str(obj(obj(r.data).error).message) ?? str(obj(r.data).message);
    return new PublishError(scrub(`Vercel answered ${r.status} to ${what}${m ? `: ${m}` : ""}.`), step, r.status);
  };
  if (!validProjectName(i.project)) throw new PublishError("Vercel project names use lowercase letters, numbers, dots, dashes and underscores (up to 100).", "project");
  if (i.clientId && looksSecret(i.clientId)) throw new PublishError("That client id looks like a secret. Paste the client id, and set secrets in Vercel yourself.", "env");
  if (i.permissionSet && looksSecret(i.permissionSet)) throw new PublishError("That ask id looks like a secret. Paste the ask's id from the One dashboard.", "env");
  if (i.databaseUrl) {
    const d = checkDatabaseUrl(i.databaseUrl);
    if (!d.ok) throw new PublishError(d.message!, "database");
  }

  try {
    // 1. The project.
    let projectId = i.existingProjectId ?? null;
    if (!projectId) {
      p("project", "running", i.project);
      const r = await i.run(VERCEL.createProject, { body: { name: i.project, ...PROJECT_SETTINGS } });
      if (!r.ok) {
        if (r.status === 409) throw new PublishError(`A Vercel project named ${i.project} already exists on your account. Pick another name.`, "project", 409);
        throw fail("project", r, "creating the project");
      }
      projectId = str(obj(r.data).id);
      if (!projectId) throw new PublishError("Vercel made the project but returned no id.", "project");
      counts.project = 1;
      p("project", "done", i.project);
    } else {
      p("project", "skipped", `Using ${i.project}`);
    }

    // 2. Variables that are not secrets, in one call; the database token alone in a second.
    const env = plainEnv(i);
    p("env", "running", env.map((e) => e.key).join(", "));
    const where = pathParams(VERCEL.createEnv, { idOrName: projectId });
    const e1 = await i.run(VERCEL.createEnv, { pathParams: where, query: { upsert: "true" }, body: env });
    if (!e1.ok) throw fail("env", e1, "setting the project's variables");
    counts.env = env.length;
    const envSet = env.map((e) => e.key);
    if (secret) {
      const e2 = await i.run(VERCEL.createEnv, { pathParams: where, query: { upsert: "true" }, body: [{ key: "DATABASE_AUTH_TOKEN", value: secret, type: "sensitive", target: ["production", "preview"] }] });
      if (!e2.ok) throw fail("env", e2, "setting DATABASE_AUTH_TOKEN");
      envSet.push("DATABASE_AUTH_TOKEN");
    }
    // The app's own values from its Environment: sensitive (Vercel never shows them again), one call.
    const plainKeys = new Set([...envSet]);
    const app = Object.entries(i.appEnv ?? {}).filter(([k, v]) => v && !plainKeys.has(k));
    if (app.length) {
      const e3 = await i.run(VERCEL.createEnv, { pathParams: where, query: { upsert: "true" }, body: app.map(([key, value]) => ({ key, value, type: "sensitive", target: ["production", "preview"] })) });
      if (!e3.ok) throw fail("env", e3, "setting the app's own variables");
      envSet.push(...app.map(([k]) => k));
    }
    p("env", "done", `${envSet.length} variable${envSet.length === 1 ? "" : "s"}`);

    // 3. The deployment, every file inline.
    p("deployment", "running", `${i.files.length} files`);
    const d = await i.run(VERCEL.createDeployment, { body: deploymentBody(i.project, projectId, i.files) });
    if (!d.ok) throw fail("deployment", d, "creating the deployment");
    counts.deployment = 1;
    const dep = obj(d.data);
    const deploymentId = str(dep.id);
    if (!deploymentId) throw new PublishError("Vercel took the deployment but returned no id.", "deployment");
    let url = str(dep.url) ?? "";
    let state = str(dep.readyState) ?? "QUEUED";
    let aliases: string[] = Array.isArray(dep.alias) ? (dep.alias as unknown[]).filter((x): x is string => typeof x === "string") : [];

    // 4. Poll until it is ready.
    const deadline = Date.now() + (i.timeoutMs ?? 6 * 60_000);
    while (!["READY", "ERROR", "CANCELED"].includes(state)) {
      if (Date.now() > deadline) throw new PublishError(`The deployment is still ${state.toLowerCase()} after the wait. It may finish on its own; check it in Vercel.`, "deployment");
      await sleep(i.pollMs ?? 3000);
      const g = await i.run(VERCEL.getDeployment, { pathParams: pathParams(VERCEL.getDeployment, { idOrUrl: deploymentId }) });
      counts.polls++;
      if (!g.ok) throw fail("deployment", g, "reading the deployment");
      const o = obj(g.data);
      state = str(o.readyState) ?? state;
      url = str(o.url) ?? url;
      if (Array.isArray(o.alias)) aliases = (o.alias as unknown[]).filter((x): x is string => typeof x === "string");
      p("deployment", "running", state.toLowerCase());
    }
    if (state !== "READY") throw new PublishError(`The deployment ended ${state.toLowerCase()}. Open it in Vercel to see the build log.`, "deployment");
    p("deployment", "done", url);

    // 5. Health: booleans only.
    const productionHost = aliases.find((a) => a === `${i.project}.vercel.app`) ?? aliases[0] ?? `${i.project}.vercel.app`;
    const productionUrl = `https://${productionHost}`;
    p("health", "running");
    let health: VercelPublishResult["health"];
    try {
      const h = await i.health(productionUrl);
      health = { reached: true, ...healthChecklist(h) };
      p("health", "done", `${health.checklist.filter((c) => c.ok).length} of ${health.checklist.length} set`);
    } catch {
      health = { reached: false, mode: null, checklist: healthChecklist({}).checklist };
      p("health", "failed", "The app did not answer /api/one/health yet");
    }
    return {
      kind: "vercel",
      projectId,
      projectName: i.project,
      deploymentId,
      url: url.startsWith("http") ? url : `https://${url}`,
      productionUrl,
      redirectUri: redirectUriFor(i.project),
      readyState: state,
      envSet,
      health,
      counts,
    };
  } catch (err) {
    if (err instanceof PublishError) {
      if (hidden.some((v) => err.message.includes(v))) throw new PublishError(scrub(err.message), err.step, err.status, err.blockedByGrant);
      throw err;
    }
    throw new PublishError(scrub((err as Error).message ?? "The deploy stopped."), "deployment");
  }
}
