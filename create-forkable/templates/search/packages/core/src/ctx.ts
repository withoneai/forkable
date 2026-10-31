// Server-side context types (CONTRACT 3). Not browser-safe: they name Db and the Connect client.

import type { OneConnectKeyClient as KeyClient } from "@withone/connect/server";
import type { Capability, FixtureTransport, LedgerActor, ServerEvent, SettingsData } from "./contract.js";
import type { Db } from "./db/client.js";
import type { LedgerRollup } from "./ledger.js";
import type { SampleWorld } from "./sample/world.js";

export type OneConnectKeyClient = KeyClient;

export interface EngineCtx {
  db: Db;
  oneConnect: OneConnectKeyClient | null;
  capability: Capability;
  settingsFor(userId: string): Promise<SettingsData>;
  transport: FixtureTransport | null;
  emit(userId: string, ev: ServerEvent): void;
  log(line: string): void;
  now(): Date;
  /** Sleep used by retry backoff; tests replace it. */
  sleep?(ms: number): Promise<void>;
  /** The Acme sample world (catalog fixtures for the New profile flow); null in processes without it. */
  world?: SampleWorld | null;
}

export interface CallCtx {
  db: Db;
  userId: string;
  sourceId?: string;
  actor: LedgerActor;
  clientId?: string;
  mode: "fixture" | "connect";
  oneConnect: OneConnectKeyClient | null;
  transport: FixtureTransport | null;
  connectionKey?: string;
  rollup?: LedgerRollup;
  emit?: (ev: ServerEvent) => void;
}
