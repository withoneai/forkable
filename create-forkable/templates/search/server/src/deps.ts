// What every route and background job can reach.

import type { HttpBindings } from "@hono/node-server";
import type { Capability, Db, EngineCtx, FixtureTransport, OneConnectKeyClient, SampleWorld, dbSchema } from "@search/core";
import type { ConnectResolution, ServerEnv } from "./config.js";
import type { ConnectCreator } from "./connect-create.js";
import type { ConnectStore } from "./connect-store.js";
import type { Hub } from "./events.js";
import type { Scheduler } from "./scheduler.js";

export type UserRow = typeof dbSchema.users.$inferSelect;

export interface DbInfo {
  kind: "embedded" | "external";
  /** Masked connection string, safe to show. */
  url: string;
  dataDir: string | null;
  port: number | null;
  version: string;
}

/** Local mode: the Connect setup store and a way to pick up what it saved. */
export interface ConnectSetup {
  store: ConnectStore;
  resolution: ConnectResolution;
  /** The .env Connect values the last reload read, to notice `pnpm connect` writing new ones. */
  envSnapshot: string;
  reload(): Promise<void>;
  creator: ConnectCreator;
}

export interface Deps {
  db: Db;
  env: ServerEnv;
  capability: Capability;
  /** Swapped by the setup screen's reload; read it per request, never cache it. */
  oneConnect: OneConnectKeyClient | null;
  hub: Hub;
  scheduler: Scheduler;
  connectSetup: ConnectSetup | null;
  dbInfo: DbInfo;
  version: string;
  /** The Acme sample world (fixtures/sample), loaded on first use. */
  sample(): { world: SampleWorld; transport: FixtureTransport };
  /** The engine context every core call takes. */
  ctx: EngineCtx;
  log(line: string): void;
}

export type AppEnv = {
  Bindings: HttpBindings;
  Variables: {
    sid: string;
    sidCookie: string | null;
    user: UserRow | null;
    deps: Deps;
    /** Set by bearer auth (Phase 3); the cookie session has every scope. */
    scopes: string[] | null;
    clientId: string | null;
  };
};
