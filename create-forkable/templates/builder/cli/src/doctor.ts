// `builder doctor`: what is installed and set, by name only. Never prints a value.
// Builder knows One through the One CLI on this machine (found, version,
// signed in); each project has its own optional One Connect.
import { existsSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import { BRAND, CONNECT_VAR_SPECS, EnvStore, OneCli, PORTS, resolveHome, schema, SERVER_ORIGIN, VERSION, type Home } from "@builder/core";
import { bootDatabase } from "@builder/core/db/boot";
import { isWarm, TEMPLATE_VERSION, templateCacheSize } from "@builder/template/render";

function portFree(port: number): Promise<boolean> {
  return new Promise((done) => {
    const srv = net.createServer();
    srv.once("error", () => done(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => done(true)));
  });
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 ** 3) return `${Math.round(n / 1024 ** 2)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

export async function doctor(_args: string[]): Promise<number> {
  const { detectAll } = await import("@builder/harness");
  const home = resolveHome();
  const pad = (s: string) => s.padEnd(16);
  console.log(`${BRAND.name} ${VERSION} · doctor`);
  const major = Number(process.versions.node.split(".")[0]);
  console.log(`  ${pad("node")}${process.versions.node}${major >= 22 ? "" : "   Node 22 is needed so your app's preview can run"}`);
  console.log(`  ${pad("home")}${home.root}`);
  const warm = isWarm(join(home.cacheTemplate, TEMPLATE_VERSION));
  console.log(`  ${pad("template")}v${TEMPLATE_VERSION}${warm ? ", warm" : ", not warmed yet (the first project takes about a minute)"}`);
  const size = await templateCacheSize(home.cacheTemplate);
  console.log(`  ${pad("template cache")}${formatBytes(size.bytes)} in ${size.versions} version${size.versions === 1 ? "" : "s"}${size.versions > 2 ? " (the server keeps the current and one older, and removes the rest on its next start)" : ""}  ${home.cacheTemplate}`);
  for (const h of await detectAll({ force: true })) {
    const state = !h.bin ? "not installed" : h.signedIn === false ? "installed, signed out" : h.signedIn ? "ready" : "installed";
    console.log(`  ${pad(h.label)}${state}${h.version ? `  ${h.version}` : ""}${h.status === "preview" ? "  (Preview)" : ""}${h.bin ? `  ${h.bin}` : ""}`);
  }
  for (const [name, port] of [["server", PORTS.server], ["preview proxy", PORTS.proxy]] as const) {
    console.log(`  ${pad(name)}${port} ${(await portFree(port)) ? "free" : "in use"}`);
  }
  // The One CLI: Builder's own One (catalog, connections, publish). Status only, never its credentials.
  const cli = await new OneCli({ tmpRoot: join(home.state, "one-calls") }).status(true);
  const cliLine = !cli.installed
    ? `not installed. Install it with ${cli.installHint}, then run one login`
    : !cli.version
      ? `found at ${cli.path}, but it did not start${cli.error ? `: ${cli.error}` : ""}`
      : cli.signedIn
        ? `${cli.version}, signed in as ${[cli.account?.name, cli.account?.email && `<${cli.account.email}>`].filter(Boolean).join(" ")}  ${cli.path}`
        : `${cli.version}, signed out. Run one login, or sign in from Settings, One CLI  ${cli.path}`;
  console.log(`  ${pad("One CLI")}${cliLine}`);
  if (cli.installed && cli.node) console.log(`  ${pad("")}runs on the Node in ${cli.node}`);

  const store = new EnvStore(home);
  for (const line of await connectSummary(home, store)) console.log(`  ${line}`);
  // The retired builder-level Connect app, if an older home still has it.
  const legacy = CONNECT_VAR_SPECS.filter((s) => store.has("builder", s.name));
  if (legacy.length) console.log(`  ${pad("earlier app")}a builder-level Connect app is still stored (${legacy.map((s) => s.name).join(", ")}). The server moves it into the template "Your earlier Connect app" on its next start.`);
  console.log(`  ${pad("storage")}${store.preferred === "keychain" ? "macOS Keychain" : `${store.displayFile("connect:new")} (mode 0600)`}`);
  return 0;
}

/**
 * Each project's One Connect and the saved templates, by name. Reads the
 * database only when this home has one (an editor already running keeps its
 * Postgres; doctor reuses it and leaves it running). Never a value.
 */
async function connectSummary(home: Home, store: EnvStore): Promise<string[]> {
  const pad = (s: string) => s.padEnd(16);
  if (!existsSync(join(home.db, "PG_VERSION"))) return [`${pad("One Connect")}no projects yet. Each project turns it on in its Settings, One Connect`];
  let db: Awaited<ReturnType<typeof bootDatabase>> | null = null;
  try {
    db = await bootDatabase({ dataDir: home.db, port: PORTS.pg + 7 });
    const setups = await db.db.select().from(schema.connectSetups);
    const rows = (await db.db.select({ id: schema.projects.id, name: schema.projects.name, c: schema.projects.oneConnect, archivedAt: schema.projects.archivedAt }).from(schema.projects)).filter((r) => !r.archivedAt);
    const required = CONNECT_VAR_SPECS.filter((s) => s.required).map((s) => s.name);
    const configured = (id: string) => required.every((n) => store.has(`connect:${id}`, n));
    const byId = new Map(setups.map((s) => [s.id, s]));
    const names = new Map(rows.map((r) => [r.id, r.name]));
    const on = rows.filter((r) => r.c?.enabled && r.c.setupId);
    const out = [`${pad("One Connect")}${rows.length} project${rows.length === 1 ? "" : "s"}, ${on.length} with One Connect on. Preview redirect URI for every Connect app: http://127.0.0.1:${PORTS.proxy}/api/one/callback`];
    const width = Math.min(28, Math.max(8, ...rows.map((r) => r.name.length)));
    for (const r of rows) {
      const s = r.c?.setupId ? byId.get(r.c.setupId) : null;
      if (!s) {
        out.push(`  ${r.name.padEnd(width)}  off, no Connect app`);
        continue;
      }
      const from = s.kind === "template" ? `template "${s.name}"` : s.ownerProjectId === r.id ? "its own Connect app" : `${names.get(s.ownerProjectId ?? "") ?? "another project"}'s Connect app`;
      const how = r.c?.via === "new" ? "" : " (linked)";
      out.push(`  ${r.name.padEnd(width)}  ${r.c?.enabled ? "on" : "off"}, ${from}${how}${configured(s.id) ? "" : ", values missing"}${s.sample ? "  [Sample]" : ""}`);
    }
    const templates = setups.filter((s) => s.kind === "template");
    for (const t of templates) {
      const used = rows.filter((r) => r.c?.setupId === t.id).length;
      out.push(`${pad("template")}${t.name}: ${configured(t.id) ? "set up" : "values missing"}, used by ${used} project${used === 1 ? "" : "s"}${t.sample ? "  [Sample]" : ""}`);
    }
    if (!templates.length) out.push(`${pad("templates")}none saved. Save one in ${SERVER_ORIGIN}/settings/templates`);
    return out;
  } catch (err) {
    return [`${pad("One Connect")}could not read the projects: ${(err as Error).message.split("\n")[0]}`];
  } finally {
    await db?.stop().catch(() => {});
  }
}
