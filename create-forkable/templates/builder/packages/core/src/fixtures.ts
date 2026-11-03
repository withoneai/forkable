// The stub One grant: the same
// client surface as @withone/connect's server client, answered from
// fixtures. The keyless demo, tests and smoke scripts run on it, and every
// answer it gives is labeled Sample in the product. Nothing here talks to
// the network.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ActionKnowledge, OneConnectClient, PlatformAction, ReachableConnection, RunActionInput, RunActionResult } from "@withone/connect/server";

/** The part of a Connect client the platform uses. A real key-mode client and the stub both fit. */
export type GrantClient = Pick<OneConnectClient, "listConnections" | "listActions" | "searchActions" | "getActionKnowledge" | "runAction" | "fetch">;

/** A KnowledgeView row as `/v1/knowledge?_id=` returns it (and fixtures/knowledge stores it). */
export interface KnowledgeRow {
  _id: string;
  connectionPlatform: string;
  title: string;
  method: string;
  path: string;
  tags: string[];
  knowledge: string;
  ioSchema?: { inputSchema?: unknown; outputSchema?: unknown; ioExample?: { input?: unknown; output?: unknown } } | null;
}

export interface StubGrantFile {
  builder: { connectUserId: string; oneUserId: string; name: string; email: string };
  platforms: { platform: string; id: string; name: string; image: string; category?: string }[];
  connections: ReachableConnection[];
  deny: { methods: string[]; actionIds?: string[] };
  responses: Record<string, unknown>;
}

export const fileForAction = (actionId: string): string => `${actionId.replace(/::/g, "__")}.json`;

export function loadKnowledgeFixtures(dir: string): Map<string, KnowledgeRow> {
  const out = new Map<string, KnowledgeRow>();
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const row = JSON.parse(readFileSync(join(dir, f), "utf8")) as KnowledgeRow;
    out.set(row._id, row);
  }
  return out;
}

export function toActionKnowledge(row: KnowledgeRow): ActionKnowledge {
  return {
    _id: row._id,
    title: row.title,
    method: row.method.toUpperCase(),
    path: row.path,
    tags: row.tags ?? [],
    knowledge: row.knowledge,
    ioSchema: row.ioSchema ?? undefined,
    platform: row.connectionPlatform,
  };
}

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !["a", "an", "the", "my", "of", "and", "for", "to", "in", "on", "me", "users", "user", "s"].includes(w));

const SYNONYM: Record<string, string> = { emails: "email", messages: "message", threads: "thread", mail: "email", latest: "list", recent: "list", show: "list", read: "list", view: "list", inbox: "thread", conversations: "thread", remove: "delete", write: "send", compose: "send" };
const norm = (w: string) => SYNONYM[w] ?? w.replace(/s$/, "");

/** Rank fixture actions for a request in words: shared words, custom one-call actions first on ties. */
export function rankActions(rows: KnowledgeRow[], query: string): KnowledgeRow[] {
  const q = new Set(words(query).map(norm));
  const scored = rows.map((r) => {
    const w = new Set([...words(r.title), ...words(r.path)].map(norm));
    let score = 0;
    for (const x of q) if (w.has(x)) score += 1;
    if (r.tags?.includes("custom")) score += 0.5;
    return { r, score };
  });
  return scored
    .filter((s) => s.score >= 1)
    .sort((a, b) => b.score - a.score || a.r.title.localeCompare(b.r.title))
    .map((s) => s.r);
}

export interface StubCall {
  kind: "runAction" | "fetch" | "search" | "knowledge" | "listConnections" | "listActions";
  detail: string;
}

export interface StubGrant extends GrantClient {
  readonly file: StubGrantFile;
  readonly knowledge: Map<string, KnowledgeRow>;
  readonly calls: StubCall[];
  /** Every runAction input, in order (smoke-publish checks ids and bodies). In memory only. */
  readonly runs: RunActionInput[];
  getConnectUserId(userId: string): Promise<string | null>;
  /** A published app's /api/one/health, answered from the variables the stub Vercel was given (names only). */
  health(url: string): Promise<unknown>;
  /** The simulated GitHub and Vercel state (repos, refs, projects). */
  readonly sim: PublishSim;
}

/** What the stub's GitHub and Vercel remember between calls. */
export interface PublishSim {
  repos: Map<string, { owner: string; name: string; private: boolean; refs: Map<string, string> }>;
  projects: Map<string, { id: string; name: string; env: Set<string> }>;
  deployments: Map<string, { id: string; project: string; polls: number }>;
}

const hex = (s: string) => createHash("sha1").update(s).digest("hex");

/** GitHub and Vercel answers in the shapes their docs give, for the publish actions only. Null for anything else. */
function simulatePublish(sim: PublishSim, owner: string, input: RunActionInput): RunActionResult | null {
  const id = input.actionId;
  const pp = (input.pathParams ?? {}) as Record<string, string>;
  const b = (input.body ?? {}) as Record<string, unknown>;
  const ok = (data: unknown, status = 200): RunActionResult => ({ status, ok: true, blockedByGrant: false, refusal: null, data });
  const no = (status: number, message: string): RunActionResult => ({ status, ok: false, blockedByGrant: false, refusal: null, data: { message } });
  const repoOf = () => sim.repos.get(`${pp.owner}/${pp.repo}`.toLowerCase());
  switch (id) {
    case "conn_mod_def::GJ3Z4tE4G5A::lTHBrlzlSouqu-x8AHeT3Q": {
      const name = String(b.name ?? "");
      const key = `${owner}/${name}`.toLowerCase();
      if (sim.repos.has(key)) return { status: 422, ok: false, blockedByGrant: false, refusal: null, data: { message: "Repository creation failed.", errors: [{ message: "name already exists on this account" }] } };
      sim.repos.set(key, { owner, name, private: b.private !== false, refs: new Map() });
      return ok({ id: sim.repos.size, name, full_name: `${owner}/${name}`, private: b.private !== false, owner: { login: owner }, html_url: `https://github.com/${owner}/${name}`, default_branch: "main" }, 201);
    }
    case "conn_mod_def::GJ3ZJkM0oow::6pCvkMJYSue8xhH4Bvy6eQ":
      if (!repoOf()) return no(404, "Not Found");
      return ok({ sha: hex(`blob ${String(b.content ?? "")}`), url: "" }, 201);
    case "conn_mod_def::GJ3ZKCHKkUA::xHBDE-LtSkWfVdTQxLIp3g":
      if (!repoOf()) return no(404, "Not Found");
      return ok({ sha: hex(`tree ${JSON.stringify(b.tree ?? [])}`), tree: b.tree, truncated: false }, 201);
    case "conn_mod_def::GJ3ZJrwmLbo::Rp9vt2o3RBqDxBLQ1sRRng":
      if (!repoOf()) return no(404, "Not Found");
      return ok({ sha: hex(`commit ${String(b.tree)} ${JSON.stringify(b.parents ?? [])} ${String(b.message)}`), message: b.message, parents: ((b.parents as string[]) ?? []).map((sha) => ({ sha })) }, 201);
    case "conn_mod_def::GJ3ZKe5vDKs::xb13z7ZBRnOWekJ-N_TG3w": {
      const r = repoOf();
      const sha = r?.refs.get(`refs/${pp.ref}`);
      if (!r || !sha) return no(404, "Not Found");
      return ok({ ref: `refs/${pp.ref}`, object: { sha, type: "commit" } });
    }
    case "conn_mod_def::GJ3ZJzQSbw4::FMDSgh1WS5mvn2imiAkk2w": {
      const r = repoOf();
      if (!r) return no(404, "Not Found");
      const ref = String(b.ref);
      if (r.refs.has(ref)) return no(422, "Reference already exists");
      r.refs.set(ref, String(b.sha));
      return ok({ ref, object: { sha: b.sha, type: "commit" } }, 201);
    }
    case "conn_mod_def::GJ3ZK-BoUAw::f8MXbEVgQJ2sEdoPzO3NPA": {
      const r = repoOf();
      const ref = `refs/${pp.ref}`;
      if (!r || !r.refs.has(ref)) return no(422, "Reference does not exist");
      r.refs.set(ref, String(b.sha));
      return ok({ ref, object: { sha: b.sha, type: "commit" } });
    }
    case "conn_mod_def::GIi2endVvxY::4QRYvqrsShinBQfxYdpIMA": {
      const name = String(b.name ?? "");
      if ([...sim.projects.values()].some((x) => x.name === name)) return { status: 409, ok: false, blockedByGrant: false, refusal: null, data: { error: { code: "conflict", message: "A project with this name already exists." } } };
      const pid = `prj_sample${hex(name).slice(0, 18)}`;
      sim.projects.set(pid, { id: pid, name, env: new Set() });
      return ok({ id: pid, name, framework: b.framework ?? null, accountId: "acct_sample_acme" });
    }
    case "conn_mod_def::GIi2iy8hP4o::Bn9C2U8RREySIMiqwHKn2w": {
      const key = Object.entries(pp).find(([k]) => k.toLowerCase() === "idorname")?.[1];
      const prj = [...sim.projects.values()].find((x) => x.id === key || x.name === key);
      if (!prj) return no(404, "Project not found");
      const list = Array.isArray(input.body) ? (input.body as { key: string }[]) : [input.body as { key: string }];
      for (const e of list) prj.env.add(e.key);
      return ok({ created: list.map((e) => ({ key: e.key, type: (e as { type?: string }).type ?? "plain" })), failed: [] }, 201);
    }
    case "conn_mod_def::GIi152aO03U::KTvTF_0ZTaS3tObzavwy0g": {
      const prj = sim.projects.get(String(b.project)) ?? [...sim.projects.values()].find((x) => x.name === b.project || x.name === b.name);
      if (!prj) return no(404, "Project not found");
      const did = `dpl_sample${hex(`${prj.id} ${sim.deployments.size}`).slice(0, 20)}`;
      sim.deployments.set(did, { id: did, project: prj.name, polls: 0 });
      return ok({ id: did, url: `${prj.name}-${did.slice(10, 19)}.vercel.app`, readyState: "QUEUED", name: prj.name, alias: [] });
    }
    case "conn_mod_def::GIi15DgMrtk::4sacesKzT3abQ63_h7ZSfw": {
      const key = Object.entries(pp).find(([k]) => k.toLowerCase() === "idorurl")?.[1];
      const dep = key ? sim.deployments.get(key) : undefined;
      if (!dep) return no(404, "Deployment not found");
      dep.polls++;
      const state = dep.polls >= 2 ? "READY" : "BUILDING";
      return ok({ id: dep.id, url: `${dep.project}-${dep.id.slice(10, 19)}.vercel.app`, readyState: state, alias: state === "READY" ? [`${dep.project}.vercel.app`] : [] });
    }
    default:
      return null;
  }
}

/**
 * Fixture strings that name a time relative to now, so "today's threads" stay
 * today: "$ms-90m" (epoch ms as a string), "$rfc-90m" (RFC 2822), "$iso-90m",
 * "$unix-3d" (epoch seconds as a number). Units m, h, d.
 */
export function relativeTimes<T>(v: T, now = Date.now()): T {
  const unit = { m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
  const walk = (x: unknown): unknown => {
    if (typeof x === "string") {
      const m = /^\$(ms|rfc|iso|unix)-(\d+)([mhd])$/.exec(x);
      if (!m) return x;
      const t = now - Number(m[2]) * unit[m[3] as keyof typeof unit];
      if (m[1] === "ms") return String(t);
      if (m[1] === "unix") return Math.floor(t / 1000);
      if (m[1] === "iso") return new Date(t).toISOString();
      return new Date(t).toUTCString().replace("GMT", "+0000");
    }
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, walk(y)]));
    return x;
  };
  return walk(v) as T;
}

/**
 * Filters a list answer by its query, for fields its items carry: equality
 * (`status: "open"`) and ranges, nested (`due_date: { lt }`) or bracketed
 * (`"due_date[lt]"`). Query keys no item has (limit, starting_after) are left alone.
 */
export function filterList(items: Record<string, unknown>[], query: Record<string, unknown>): Record<string, unknown>[] {
  const conds: [string, string, unknown][] = [];
  const RANGE = ["lt", "lte", "gt", "gte"];
  for (const [k, v] of Object.entries(query)) {
    const m = /^(\w+)\[(lt|lte|gt|gte)\]$/.exec(k);
    if (m) conds.push([m[1]!, m[2]!, v]);
    else if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const [op, x] of Object.entries(v)) if (RANGE.includes(op)) conds.push([k, op, x]);
    } else if (["string", "number", "boolean"].includes(typeof v)) conds.push([k, "eq", v]);
  }
  const has = (f: string) => items.some((it) => f in it);
  const live = conds.filter(([f]) => has(f));
  if (!live.length) return items;
  return items.filter((it) =>
    live.every(([f, op, x]) => {
      const a = it[f];
      // Only scalar fields: a GitHub `labels=bug` against an array of label objects is not equality.
      if (a === undefined || (a !== null && typeof a === "object")) return true;
      if (op === "eq") return x === "all" || String(a) === String(x);
      const n = Number(a);
      const y = Number(x);
      if (!Number.isFinite(n) || !Number.isFinite(y)) return false;
      return op === "lt" ? n < y : op === "lte" ? n <= y : op === "gt" ? n > y : n >= y;
    }),
  );
}

/** The stub grant over fixtures/grant/stub-grant.json and fixtures/knowledge. */
export function createStubGrant(fixturesDir: string): StubGrant {
  const grantFile = join(fixturesDir, "grant", "stub-grant.json");
  const file = JSON.parse(readFileSync(grantFile, "utf8")) as StubGrantFile;
  const knowledge = loadKnowledgeFixtures(join(fixturesDir, "knowledge"));
  const calls: StubCall[] = [];
  const runs: RunActionInput[] = [];
  const sim: PublishSim = { repos: new Map(), projects: new Map(), deployments: new Map() };
  const slim = (r: KnowledgeRow): PlatformAction => ({ _id: r._id, title: r.title, method: r.method.toUpperCase(), path: r.path, tags: r.tags });
  const notFound = (what: string) => Object.assign(new Error(what), { code: "request_failed", status: 404 });

  return {
    file,
    knowledge,
    calls,
    runs,
    sim,
    async health(url: string) {
      const host = new URL(url).hostname;
      const prj = [...sim.projects.values()].find((x) => host === `${x.name}.vercel.app` || host.startsWith(`${x.name}-`));
      if (!prj) throw new Error("The sample deployment does not exist.");
      const has = (k: string) => prj.env.has(k);
      return {
        mode: has("ONE_MODE") ? "connect" : "preview",
        configured: { clientId: has("ONE_CLIENT_ID"), clientSecret: has("ONE_CLIENT_SECRET"), connectKey: has("ONE_CONNECT_KEY"), redirectUri: has("ONE_REDIRECT_URI"), permissionSet: has("ONE_PERMISSION_SET"), databaseAuthToken: has("DATABASE_AUTH_TOKEN") },
        db: has("DATABASE_URL"),
      };
    },
    async getConnectUserId() {
      return file.builder.connectUserId;
    },
    async listConnections() {
      calls.push({ kind: "listConnections", detail: "" });
      return file.connections.map((c) => ({ ...c }));
    },
    async listActions(_userId, platform) {
      calls.push({ kind: "listActions", detail: platform });
      return [...knowledge.values()].filter((r) => r.connectionPlatform === platform).map(slim);
    },
    async searchActions(_userId, platform, query, options) {
      calls.push({ kind: "search", detail: `${platform} ${query}` });
      const rows = [...knowledge.values()].filter((r) => r.connectionPlatform === platform);
      return rankActions(rows, query).slice(0, options?.limit ?? 5).map(slim);
    },
    async getActionKnowledge(_userId, actionId) {
      calls.push({ kind: "knowledge", detail: actionId });
      const row = knowledge.get(actionId);
      if (!row) throw notFound(`One has no action with the id ${actionId}.`);
      return toActionKnowledge(row);
    },
    async runAction(_userId, input: RunActionInput): Promise<RunActionResult> {
      calls.push({ kind: "runAction", detail: `${input.method ?? ""} ${input.actionId}` });
      runs.push(structuredClone(input));
      const row = knowledge.get(input.actionId);
      const method = (input.method ?? row?.method ?? "GET").toUpperCase();
      const conn = file.connections.find((c) => c.key === input.connectionKey);
      if (!conn) return { status: 403, ok: false, blockedByGrant: true, refusal: "grant", data: { message: "This connection is not in the grant." } };
      if (conn.access?.policy === "methods" && conn.access.methods && !conn.access.methods.includes(method)) {
        return { status: 403, ok: false, blockedByGrant: true, refusal: "grant", data: { message: "This method is outside what the user granted." } };
      }
      if (file.deny.methods.includes(method) || file.deny.actionIds?.includes(input.actionId)) {
        return { status: 403, ok: false, blockedByGrant: true, refusal: "grant", data: { message: "This action is outside what the user granted." } };
      }
      const simulated = simulatePublish(sim, conn.title ?? "acme-inc", input);
      if (simulated) return simulated;
      const params = Object.values(input.pathParams ?? {}).map(String);
      if (params.some((p) => p.includes("does-not-exist")) || (input.path ?? "").includes("does-not-exist")) return { status: 404, ok: false, blockedByGrant: false, refusal: null, data: { error: { code: 404, message: "Requested entity was not found." } } };
      let data = relativeTimes(structuredClone(input.actionId in file.responses ? file.responses[input.actionId] : (row?.ioSchema?.ioExample?.output ?? {}))) as Record<string, unknown>;
      // A "retrieve one" answer picked from a list by a path parameter (the eval's Stripe customer).
      if (typeof data.$byPathParam === "string") {
        const want = Object.entries(input.pathParams ?? {}).find(([k]) => k.toLowerCase() === String(data.$byPathParam).toLowerCase())?.[1];
        const hit = ((data.$items as Record<string, unknown>[]) ?? []).find((x) => x[String(data.$key ?? "id")] === want);
        if (!hit) return { status: 404, ok: false, blockedByGrant: false, refusal: null, data: { error: { code: "resource_missing", message: `No such item: '${String(want)}'` } } };
        data = hit;
      }
      // Honor the page size a list asks for, the way the provider would.
      const b = (input.body ?? {}) as Record<string, unknown>;
      const n = Number(b.numberOfThreads ?? b.numberOfEmails ?? b.maxResults ?? input.query?.maxResults ?? 0);
      if (n > 0 && Array.isArray(data.threads)) {
        data.threads = data.threads.slice(0, n);
        data.totalFound = (data.threads as unknown[]).length;
      }
      // A list call's query filters, the way Stripe applies them (status=open, due_date[lt]=now).
      if (Array.isArray(data.data) && input.query) data.data = filterList(data.data as Record<string, unknown>[], input.query as Record<string, unknown>);
      return { status: 200, ok: true, blockedByGrant: false, refusal: null, data };
    },
    async fetch(_userId, path) {
      calls.push({ kind: "fetch", detail: path });
      const b = file.builder;
      if (path.startsWith("/users/whoami")) return Response.json({ user: { id: b.oneUserId, name: b.name, email: b.email }, organization: null, project: null });
      if (path.startsWith("/users/me")) {
        const [firstName, ...rest] = b.name.split(" ");
        return Response.json({ id: b.oneUserId, email: b.email, firstName, lastName: rest.join(" "), avatar: null });
      }
      if (path.startsWith("/available-connectors")) {
        return Response.json({ rows: file.platforms.map((p) => ({ id: p.id, platform: p.platform, name: p.name, image: p.image, category: p.category ?? null })), total: file.platforms.length, pages: 1, page: 1 });
      }
      return new Response(JSON.stringify({ error: "not in the stub grant" }), { status: 404, headers: { "content-type": "application/json" } });
    },
  };
}
