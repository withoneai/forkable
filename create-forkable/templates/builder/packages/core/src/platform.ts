// Composition root: one Platform per process (server or demo).

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Harness, HarnessId } from "@builder/harness/types";
import { AccessTests } from "./access.js";
import { ActivityLedger } from "./activity.js";
import { createBus, type Bus } from "./bus.js";
import { CatalogService } from "./catalog/service.js";
import { ConnectSetups } from "./connect.js";
import { createStubGrant } from "./fixtures.js";
import { DevGate } from "./devgate.js";
import { OneCli } from "./onecli.js";
import { cliSource, sampleSource, type OneSource } from "./onesource.js";
import { PreviewSessions } from "./previewsessions.js";
import { createStubOne, type StubOne } from "./stubone.js";
import { PublishService } from "./publish/service.js";
import { findBin } from "./bins.js";
import { ScopeService } from "./scopes/service.js";
import { env } from "./brand.js";
import { Checkpoints } from "./checkpoints.js";
import { bootDatabase, type BootedDatabase } from "./db/boot.js";
import { DevServers } from "./devserver.js";
import { ErrorStore } from "./errors.js";
import { resolveHome, type Home } from "./home.js";
import { installShims, type ShimPaths } from "./shims.js";
import { TurnEngine, type EngineOptions } from "./turns.js";
import { Verifier } from "./verifier.js";
import { Workspace } from "./workspace.js";
import { EnvService, oneTokenProbe, type ConnectProbe } from "./envservice.js";
import type { SecurityRunner } from "./envstore.js";
import { VersionPreviews } from "./versions.js";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "..", "..", "..");
export const FIXTURES_DIR = join(REPO_ROOT, "fixtures");
export const REPLAY_DIR = join(FIXTURES_DIR, "replay");

export interface Platform {
  home: Home;
  database: BootedDatabase;
  bus: Bus;
  workspace: Workspace;
  checkpoints: Checkpoints;
  errors: ErrorStore;
  devservers: DevServers | null;
  /** Preview this version (null when previews are off, as in the keyless demo). */
  versions: VersionPreviews | null;
  verifier: Verifier | null;
  turns: TurnEngine;
  shims: ShimPaths;
  /** Builder's own One: the One CLI on this machine, or the keyless sample stub. */
  one: OneSource;
  /** The One CLI itself (null on the sample source). */
  cli: OneCli | null;
  /** Per-project One Connect: setups, each project's choice, the shared callback's states. */
  connect: ConnectSetups;
  /** The sample One a preview app talks to (null unless on the sample source). */
  stubOne: StubOne | null;
  /** The developer's session cookie per preview (for the verifier). */
  sessions: PreviewSessions;
  catalog: CatalogService;
  scopes: ScopeService;
  activity: ActivityLedger;
  /** The preview's local check before and after each One call. */
  gate: DevGate;
  access: AccessTests;
  publish: PublishService;
  /** Environment values: each Connect app's and each project's (write-only, CONTRACT 16). */
  env: EnvService;
  stop(): Promise<void>;
}

export interface PlatformOptions {
  home?: string;
  databaseUrl?: string;
  /** Where the embedded Postgres starts probing (tests that boot beside another platform). */
  databasePort?: number;
  /** Dev servers and the Playwright verifier (off in the keyless demo). */
  preview?: boolean;
  harness?: (id: HarnessId) => Harness;
  log?: (line: string) => void;
  engine?: Partial<EngineOptions>;
  /**
   * "sample": the stub from fixtures (keyless demo, tests, smoke scripts;
   * every answer labeled Sample, a stub One for previews). Default: the One
   * CLI on this machine, or the stub when BUILDER_STUB_GRANT=1.
   */
  grant?: "sample" | "builder";
  /** The One CLI (tests inject a fake runner and resolver). */
  cli?: { runner?: import("./onecli.js").OneRunner; resolve?: () => Promise<string | null>; cacheDir?: string };
  /** Publish: pnpm audit during the scan (needs the network), Vercel poll interval, health reader. */
  publish?: { audit?: boolean; pollMs?: number; fetchHealth?: (url: string) => Promise<unknown> };
  /**
   * Environment storage. backend "auto" (default) is the macOS Keychain, else
   * a 0600 file; probe is how Check asks One about the client id and secret
   * (null: format checks only; default: One's token endpoint, or "sample"
   * with the stub grant; BUILDER_ENV_PROBE=off turns it off for tools).
   */
  env?: { backend?: "auto" | "keychain" | "file"; security?: SecurityRunner; probe?: ConnectProbe | "sample" | null };
}

export async function createPlatform(o: PlatformOptions = {}): Promise<Platform> {
  const log = o.log ?? (() => {});
  const home = resolveHome(o.home);
  const database = await bootDatabase({ dataDir: home.db, url: o.databaseUrl, port: o.databasePort, log });
  const bus = createBus();
  const workspace = new Workspace(database.db, home);
  const checkpoints = new Checkpoints(database.db, bus);
  const errors = new ErrorStore(database.db, bus);
  const shims = installShims(home.shims);
  const useStub = o.grant ? o.grant === "sample" : process.env[env("STUB_GRANT")] === "1";
  const probe = useStub ? "sample" : process.env[env("ENV_PROBE")] === "off" ? null : o.env?.probe !== undefined ? o.env.probe : oneTokenProbe;
  // The sample's Connect values are fake and its homes are scratch: a 0600 file there, never the login Keychain.
  const envs = new EnvService({ home, backend: o.env?.backend ?? (useStub ? "file" : undefined), security: o.env?.security, probe, log });
  const stub = useStub ? createStubGrant(FIXTURES_DIR) : null;
  const cli = stub ? null : new OneCli({ tmpRoot: join(home.state, "one-calls"), runner: o.cli?.runner, resolve: o.cli?.resolve, cacheDir: o.cli?.cacheDir, log });
  const one: OneSource = stub ? sampleSource(stub) : cliSource(cli!);
  const connect = new ConnectSetups({ db: database.db, env: envs, sample: Boolean(stub), log });
  await connect.ensureSample();
  await connect.migrate((await workspace.list()).map((r) => ({ id: r.id, name: r.name }))).catch((err) => log(`connect: migration skipped: ${(err as Error).message}`));
  const stubOne = stub ? createStubOne({ stub, setups: connect }) : null;
  // Older projects: the platform's One files move from the retired relay to the app's own Connect app, as a version.
  for (const row of await workspace.list()) {
    await workspace
      .upgradeOneConnect(row, async (files) => {
        await checkpoints.commit(row.id, row.path, { subject: "One Connect: the app signs in on its own Connect app", kind: "manual", turnId: null, harness: null, sessionId: null, body: `Platform files updated: ${files.join(", ")}` });
        log(`upgraded ${row.slug}'s One files (${files.length})`);
      })
      .catch((err) => log(`upgrade ${row.slug}: ${(err as Error).message}`));
  }
  const sessions = new PreviewSessions();
  errors.redact = (id, t) => envs.redact(id, t);
  const catalog = new CatalogService({ home, source: one, log });
  const scopes = new ScopeService({ catalog, errors, bus, log });
  scopes.visitorsOf = (p) => workspace.visitors(p.id);
  const activity = new ActivityLedger(database.db, bus);
  const preview = o.preview ?? true;
  const devservers = preview ? new DevServers(database.db, bus, errors, log, home.root) : null;
  if (devservers) {
    // A version preview (<projectId>@<sha>) gets its project's One Connect too; app values stay the live project's.
    devservers.envFor = async (id) => {
      const pid = id.split("@")[0]!;
      const values = id.includes("@") ? {} : await envs.projectValues(pid, "preview");
      return { ...values, ...(await connect.previewEnv(pid)) };
    };
    devservers.redact = (id, t) => envs.redact(id.split("@")[0]!, t);
  }
  const verifier = preview ? new Verifier() : null;
  const versions = devservers ? new VersionPreviews({ home, devservers, checkpoints, bus, log }) : null;
  // Version trees from an earlier process (its dev servers went with the boot sweep).
  versions?.sweep();
  // Old template versions, in the background (deleting a version takes seconds).
  void workspace.pruneTemplates(log);
  const harness = o.harness ?? (await import("@builder/harness")).getHarness;
  const turns = new TurnEngine({
    db: database.db,
    bus,
    home,
    workspace,
    checkpoints,
    errors,
    shims,
    harness,
    replayDir: REPLAY_DIR,
    devservers,
    verifier,
    scopes,
    catalog,
    env: envs,
    connect,
    // The verifier signs in like the developer: their session in this preview, or the sample One's own sign-in.
    previewSession: async (project) => {
      if (!(await connect.projectConnect(project.id)).enabled) return null;
      const cookie = sessions.get(project.id);
      if (cookie) return { cookies: [cookie] };
      return stub ? { signIn: true } : null;
    },
    log,
    ...o.engine,
  });
  await turns.recover();
  const gate = new DevGate({ catalog, scopes, activity, activeTurn: (id) => turns.active(id), visitors: (id) => workspace.visitors(id), kind: () => (stub ? "sample" : "one") });
  const access = new AccessTests({ catalog, scopes, gate, activity, connect, source: one });
  const publish = new PublishService({
    db: database.db,
    bus,
    home,
    source: one,
    connect,
    catalog,
    scopes,
    activity,
    checkpoints,
    activeTurn: (id) => turns.active(id),
    visitors: (id) => workspace.visitors(id),
    audit: o.publish?.audit ?? false,
    pollMs: o.publish?.pollMs,
    fetchHealth: o.publish?.fetchHealth,
    pnpm: () => findBin("pnpm"),
    env: envs,
    log,
  });
  return {
    home,
    database,
    bus,
    workspace,
    checkpoints,
    errors,
    devservers,
    versions,
    verifier,
    turns,
    shims,
    one,
    cli,
    connect,
    stubOne,
    sessions,
    catalog,
    scopes,
    activity,
    gate,
    access,
    publish,
    env: envs,
    async stop() {
      await versions?.stopAll();
      await devservers?.stopAll();
      await verifier?.close();
      await database.stop();
    },
  };
}
