// Where Builder's own One answers come from: the One CLI on this machine
// (kind "one"), or the keyless stub over fixtures (kind "sample": the demo,
// tests and smokes; every answer labeled Sample). Catalog reads and
// publish calls go through here. Preview calls never do: they run in the
// app, on the developer's own sign-in to that app's Connect app.

import type { RunActionResult } from "@withone/connect/server";
import { rankActions, type KnowledgeRow, type StubGrant } from "./fixtures.js";
import { OneCli, OneCliError, ONE_INSTALL_HINT, type CliRunInput, type CliRunResult, type OneCliStatus } from "./onecli.js";
import type { CatalogPlatform, GrantKind } from "./types.js";

export interface SourcePick {
  actionId: string;
  title: string;
  method: string;
  path: string;
  tags?: string[];
  /** The digest `actions find` returned with the pick, when it did. */
  knowledge?: string;
}

export interface SourceConnection {
  platform: string;
  title: string | null;
  access: "full" | "methods" | "actions";
  methods?: string[];
  image?: string | null;
}

export interface OneSource {
  kind: GrantKind;
  /** The stub behind a sample source (fixtures, the publish simulation). */
  stub: StubGrant | null;
  status(force?: boolean): Promise<OneCliStatus>;
  find(platform: string, intent: string, limit?: number): Promise<SourcePick[]>;
  knowledge(actionId: string, platformHint?: string): Promise<KnowledgeRow>;
  platforms(): Promise<CatalogPlatform[]>;
  /** The builder's own One connections (publish targets). No keys. */
  connections(): Promise<SourceConnection[]>;
  /** One call on the builder's own One account (publish only). */
  run(i: CliRunInput & { method: string; path: string }): Promise<CliRunResult>;
  /** Start `one login` (no-op on the sample source). */
  login(): Promise<OneCliStatus>;
}

export function cliSource(cli: OneCli): OneSource {
  return {
    kind: "one",
    stub: null,
    status: (force) => cli.status(force),
    async find(platform, intent, limit = 6) {
      const { picks } = await cli.find(platform, intent);
      return picks.slice(0, limit).map((p) => ({ ...p, tags: cli.cacheRow(p.actionId)?.tags ?? [] }));
    },
    knowledge: (id, hint) => cli.knowledge(id, hint),
    platforms: () => cli.platforms(),
    async connections() {
      const list = await cli.connections();
      return list.map((c) => ({ platform: c.platform, title: null, access: c.access === "methods" ? "methods" : c.access === "actions" ? "actions" : "full" }));
    },
    run: (i) => cli.execute(i),
    login: () => cli.startLogin(),
  };
}

const access = (p: string | undefined): SourceConnection["access"] => (p === "methods" ? "methods" : p === "actions" ? "actions" : "full");

export function sampleSource(stub: StubGrant): OneSource {
  const b = stub.file.builder;
  const status = (): OneCliStatus => ({
    installed: true,
    path: null,
    version: null,
    node: null,
    signedIn: true,
    account: { name: b.name, email: b.email },
    mode: "sample",
    error: null,
    checkedAt: new Date().toISOString(),
    loginRunning: false,
    installHint: ONE_INSTALL_HINT,
  });
  return {
    kind: "sample",
    stub,
    status: async () => status(),
    async find(platform, intent, limit = 6) {
      stub.calls.push({ kind: "search", detail: `${platform} ${intent}` });
      const rows = [...stub.knowledge.values()].filter((r) => r.connectionPlatform === platform);
      return rankActions(rows, intent)
        .slice(0, limit)
        .map((r) => ({ actionId: r._id, title: r.title, method: r.method.toUpperCase(), path: r.path, tags: r.tags }));
    },
    async knowledge(id) {
      stub.calls.push({ kind: "knowledge", detail: id });
      const row = stub.knowledge.get(id);
      if (!row) throw new OneCliError(`One's catalog has no action with the id ${id}. Use an id from one_find_actions.`, "not_found");
      return row;
    },
    async platforms() {
      return stub.file.platforms.map((p) => ({ platform: p.platform, name: p.name, connDefId: p.id, image: p.image, category: p.category ?? null }));
    },
    async connections() {
      return stub.file.connections.map((c) => ({ platform: c.platform, title: c.title ?? c.name ?? null, access: access(c.access?.policy), ...(c.access?.policy === "methods" ? { methods: c.access.methods } : {}), image: c.image ?? null }));
    },
    async run(i) {
      const conn = stub.file.connections.find((c) => c.platform === i.platform);
      if (!conn) return { status: 409, ok: false, blockedByGrant: false, data: { message: `${i.platform} is not connected on the sample account.` } };
      const r: RunActionResult = await stub.runAction("sample-builder", {
        connectionKey: conn.key,
        actionId: i.actionId,
        method: i.method,
        path: i.path,
        pathParams: i.pathParams,
        body: i.body,
        query: i.query as Record<string, string> | undefined,
        headers: i.headers,
      });
      return { status: r.status, ok: r.ok, blockedByGrant: r.blockedByGrant, data: r.data };
    },
    login: async () => status(),
  };
}
