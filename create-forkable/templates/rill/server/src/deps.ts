import type { HttpBindings } from "@hono/node-server";
import type { OneConnectClient } from "@withone/connect/server";
import type { Db, UserRow } from "@rill/core";
import type { ServerEnv } from "./config.js";
import type { ConnectStore } from "./connect-store.js";
import type { Hub } from "./events.js";
import type { Scheduler } from "./scheduler.js";

/** What every background job and every route can reach. */
export interface CoreDeps {
  db: Db;
  env: ServerEnv;
  oneConnect: OneConnectClient | null;
  hub: Hub;
}

export interface DbInfo {
  kind: "embedded" | "external";
  /** Masked connection string, safe to show. */
  url: string;
  dataDir: string | null;
}

/** Local mode only: the Connect setup screen's store and a way to pick up what it saved. */
export interface ConnectSetup {
  store: ConnectStore;
  /** Where the running Connect app came from. */
  source: "store" | "env" | null;
  /** Re-read the store, rebuild the Connect client, swap it in for every route and job. */
  reload(): Promise<void>;
}

export interface Deps extends CoreDeps {
  scheduler: Scheduler;
  connectSetup: ConnectSetup | null;
  dbInfo: DbInfo;
  version: string;
}

/** Hono generics: Node bindings from @hono/node-server, per-request variables. */
export type AppEnv = {
  Bindings: HttpBindings;
  Variables: {
    sid: string;
    /** Set when the middleware minted the cookie on this request. */
    sidCookie: string | null;
    user: UserRow | null;
    deps: Deps;
  };
};
