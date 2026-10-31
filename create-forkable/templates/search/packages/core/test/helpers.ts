// Test helpers: a scratch schema on a test-only embedded Postgres (tmp home, port 55497),
// never ~/.search or another app's database.

import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import type { FixtureAnswer, FixtureRequest, FixtureTransport, SearchProfile, SettingsData } from "../src/contract.js";
import type { EngineCtx } from "../src/ctx.js";
import { bootDatabase, type BootedDatabase } from "../src/db/boot.js";
import { dropSchema } from "../src/db/client.js";
import { users } from "../src/db/schema.js";
import { upsertProfileVersion, createSource } from "../src/profile/builtins.js";
import { SAMPLE_SETTINGS } from "../src/settings.js";

export const TEST_HOME = process.env.SEARCH_TEST_HOME ?? join(tmpdir(), "search-core-test");
export const TEST_PG_PORT = Number(process.env.SEARCH_TEST_PG_PORT ?? 55497);

export async function testDb(name: string, opts: { keyword?: boolean } = {}): Promise<BootedDatabase & { schema: string; done(): Promise<void> }> {
  const schema = `t_${name}_${process.pid}`;
  const b = await bootDatabase({ home: TEST_HOME, pgPort: TEST_PG_PORT, schema, forceKeyword: opts.keyword, dbName: "search_test" });
  return {
    ...b, schema,
    async done() {
      await dropSchema(b.db, schema).catch(() => {});
      await b.stop();
    },
  };
}

export type Handler = (req: FixtureRequest, n: number) => FixtureAnswer | Promise<FixtureAnswer>;

export class StubTransport implements FixtureTransport {
  calls: FixtureRequest[] = [];
  constructor(public handlers: Record<string, Handler>) {}
  async answer(req: FixtureRequest): Promise<FixtureAnswer> {
    this.calls.push(req);
    const h = this.handlers[req.actionId];
    if (!h) return { status: 404, data: { error: "no handler", actionId: req.actionId } };
    return h(req, this.calls.filter((c) => c.actionId === req.actionId).length);
  }
  count(actionId: string): number { return this.calls.filter((c) => c.actionId === actionId).length; }
}

export function makeCtx(b: { db: BootedDatabase["db"]; capability: BootedDatabase["capability"] }, transport: FixtureTransport | null, o: { now?: () => Date; settings?: SettingsData; sleeps?: number[] } = {}): EngineCtx {
  return {
    db: b.db, oneConnect: null, capability: b.capability, transport,
    settingsFor: async () => o.settings ?? SAMPLE_SETTINGS,
    emit: () => {}, log: () => {}, now: o.now ?? (() => new Date()),
    sleep: async (ms) => { o.sleeps?.push(ms); },
  };
}

export async function seedUser(db: BootedDatabase["db"], id = "usr_test"): Promise<string> {
  await db.insert(users).values({ id, name: "Dana Oyelaran", email: "dana@acme.com", isSample: true }).onConflictDoNothing();
  return id;
}

export async function seedSource(db: BootedDatabase["db"], userId: string, p: SearchProfile, connectionKey = `sample:${p.platform}`): Promise<string> {
  const v = await upsertProfileVersion(db, null, p, "builtin", "builtin");
  return createSource(db, { userId, platform: p.platform, connectionKey, connectionLabel: "test", profileId: v.profileId, versionId: v.versionId, profile: p, mode: "fixture" });
}

export async function count(db: BootedDatabase["db"], q: ReturnType<typeof sql>): Promise<number> {
  const r = await db.execute(q);
  return Number((r.rows[0] as { n: number | string }).n);
}

/** A minimal profile for engine tests (platform "testco", ids "sample::"). */
export function ticketProfile(over: Partial<SearchProfile> = {}): SearchProfile {
  return {
    $schema: "https://search.forkable.dev/schema/profile-1.json",
    id: "testco.tickets", platform: "testco", model: "tickets", kind: "record", title: "Tickets", author: "test", sampleOnly: true,
    list: {
      actionId: "sample::list", query: { updated_since: "{{ run.since | iso }}" }, resultsPath: "tickets", idPath: "id",
      pagination: { type: "cursor", next: "next_cursor", passAs: "query:cursor" }, pageSize: { param: "per_page", value: 2 },
    },
    incremental: { strategy: "watermark", field: "item.updated_at", overlap: "1m", initial: "30d" },
    deletes: { when: "item.status == 'deleted'", reconcile: "onFullPass" },
    fields: {
      title: "item.subject", body: { path: "item.description", decode: "html" },
      occurredAt: { path: "item.created_at", decode: "datetime" }, updatedAt: { path: "item.updated_at", decode: "datetime" },
      url: "https://desk.example.com/t/{{ item.id }}", status: "item.status",
    },
    entities: { refs: [{ role: "author", type: "person", address: "item.requester" }] },
    chunk: { strategy: "paragraph", maxTokens: 100 },
    ...over,
  };
}
