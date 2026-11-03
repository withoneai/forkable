// Environment values: the paste parser, format checks, the store (Keychain
// with the 0600 file fallback), the code scan, and that status never
// carries a value.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanEnvRefs } from "../src/envscan.js";
import { EnvService } from "../src/envservice.js";
import { EnvStore, readEnvFile, type SecurityRunner } from "../src/envstore.js";
import { guessConnectName, isSecretName, looksLikeBlock, parseEnvBlock, validateAppValue, validateConnectVar } from "../src/envvars.js";
import { PREVIEW_CALLBACK } from "../src/brand.js";
import { resolveHome, type Home } from "../src/home.js";

const REDIRECT = PREVIEW_CALLBACK;
const SECRET = "one_secret_CANARYa1b2c3d4e5f6g7h8";
const KEY = "sk_live_CANARYz9y8x7w6v5u4";

/** An in-memory /usr/bin/security that speaks just enough of its CLI. */
function fakeSecurity(o: { failWrites?: boolean } = {}): SecurityRunner & { items: Map<string, string>; calls: string[][] } {
  const items = new Map<string, string>();
  const calls: string[][] = [];
  const run = (async (args: string[], stdin?: string) => {
    calls.push(args);
    if (args[0] === "-i") {
      if (o.failWrites) return { code: 1, stdout: "" };
      const m = /-s "([^"]+)" -a "([^"]+)".* -w "([^"]+)"/.exec(stdin ?? "");
      if (!m) return { code: 1, stdout: "" };
      items.set(`${m[1]}|${m[2]}`, m[3]!);
      return { code: 0, stdout: "" };
    }
    const at = (flag: string) => args[args.indexOf(flag) + 1];
    const key = `${at("-s")}|${at("-a")}`;
    if (args[0] === "find-generic-password") return items.has(key) ? { code: 0, stdout: `${items.get(key)}\n` } : { code: 44, stdout: "" };
    if (args[0] === "delete-generic-password") return { code: items.delete(key) ? 0 : 44, stdout: "" };
    return { code: 1, stdout: "" };
  }) as SecurityRunner & { items: Map<string, string>; calls: string[][] };
  run.items = items;
  run.calls = calls;
  return run;
}

describe("the paste parser", () => {
  it("splits a .env block, with export, quotes, comments and CRLF", () => {
    const text = [
      "# from the dashboard",
      "ONE_CLIENT_ID=abc123def",
      `export ONE_CLIENT_SECRET="${SECRET}"`,
      `ONE_CONNECT_KEY='${KEY}'   `,
      `ONE_REDIRECT_URI=${REDIRECT}  # exactly`,
      "",
      "not a line",
      "ONE_PERMISSION_SET: ask_42",
    ].join("\r\n");
    const r = parseEnvBlock(text);
    expect(r.entries).toEqual([
      { name: "ONE_CLIENT_ID", value: "abc123def" },
      { name: "ONE_CLIENT_SECRET", value: SECRET },
      { name: "ONE_CONNECT_KEY", value: KEY },
      { name: "ONE_REDIRECT_URI", value: REDIRECT },
      { name: "ONE_PERMISSION_SET", value: "ask_42" },
    ]);
    expect(r.skipped).toBe(1);
  });

  it("keeps the last line for a name, and keeps # inside quotes", () => {
    const r = parseEnvBlock('A=1\nA=2\nB="x # y"');
    expect(r.entries).toEqual([{ name: "A", value: "2" }, { name: "B", value: "x # y" }]);
  });

  it("tells a block from a single value", () => {
    expect(looksLikeBlock("ONE_CLIENT_ID=a\nONE_CLIENT_SECRET=b")).toBe(true);
    expect(looksLikeBlock("ONE_CLIENT_ID=a")).toBe(true);
    expect(looksLikeBlock(SECRET)).toBe(false);
    expect(looksLikeBlock("abc=def")).toBe(false);
  });

  it("routes a bare value to its field by shape", () => {
    expect(guessConnectName(SECRET)).toBe("ONE_CLIENT_SECRET");
    expect(guessConnectName(KEY)).toBe("ONE_CONNECT_KEY");
    expect(guessConnectName(REDIRECT)).toBe("ONE_REDIRECT_URI");
    expect(guessConnectName("abc123")).toBeNull();
  });
});

describe("format checks", () => {
  const v = (n: string, x: string) => validateConnectVar(n, x, { redirectUri: REDIRECT });
  it("accepts the documented shapes", () => {
    expect(v("ONE_CLIENT_ID", "client_8f2a91").level).toBe("ok");
    expect(v("ONE_CLIENT_SECRET", SECRET).level).toBe("ok");
    expect(v("ONE_CONNECT_KEY", KEY).level).toBe("ok");
    expect(v("ONE_PERMISSION_SET", "").level).toBe("ok");
  });

  it("names a value pasted in the wrong field, without echoing it", () => {
    const r = v("ONE_CLIENT_SECRET", KEY);
    expect(r.level).toBe("error");
    expect(r.message).toMatch(/connect key/i);
    expect(r.message).not.toContain(KEY);
    expect(v("ONE_CLIENT_ID", SECRET).message).toMatch(/Client secret/);
  });

  it("refuses test keys, spaces and masks", () => {
    expect(v("ONE_CONNECT_KEY", "sk_test_abcdefghijkl").message).toMatch(/Production/);
    expect(v("ONE_CLIENT_ID", "abc def").level).toBe("error");
    expect(v("ONE_CLIENT_SECRET", "••••••").level).toBe("error");
    expect(v("ONE_CLIENT_SECRET", "").message).toBe("Required.");
  });

  it("never takes a redirect URI: the platform sets it for each place the app runs", () => {
    for (const u of [REDIRECT, "http://127.0.0.1:3000/api/one/callback", "https://evil.example/api/one/callback"]) {
      const r = v("ONE_REDIRECT_URI", u);
      expect(r.level).toBe("error");
      expect(r.message).toMatch(/sets the redirect URI/);
      expect(r.message).not.toContain(u);
    }
  });

  it("checks app values by name", () => {
    expect(validateAppValue("APP_OWNER_EMAIL", "not-an-email").level).toBe("error");
    expect(validateAppValue("DATABASE_URL", "libsql://db.turso.io?authToken=x").level).toBe("error");
    expect(validateAppValue("BUILDER_RELAY_TOKEN", "x").level).toBe("error");
    expect(validateAppValue("lower", "x").level).toBe("error");
    expect(validateAppValue("WEATHER_API_KEY", "k-123").level).toBe("ok");
    expect(validateAppValue("WEATHER_API_KEY", "a\nb").level).toBe("error");
    expect(isSecretName("WEATHER_API_KEY")).toBe(true);
    expect(isSecretName("APP_OWNER_EMAIL")).toBe(false);
    expect(isSecretName("SOMETHING")).toBe(true);
  });
});

describe("the store", () => {
  let root: string;
  let home: Home;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "builder-env-test-"));
    home = resolveHome(root);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("puts values in the Keychain over stdin, never on the command line, and reads them back", async () => {
    const sec = fakeSecurity();
    const s = new EnvStore(home, { backend: "keychain", security: sec });
    const where = await s.set("builder", { ONE_CLIENT_SECRET: SECRET });
    expect(where.ONE_CLIENT_SECRET).toBe("keychain");
    expect(sec.calls.flat().join(" ")).not.toContain(SECRET);
    expect(await s.values("builder")).toEqual({ ONE_CLIENT_SECRET: SECRET });
    // Nothing on disk holds it, not the index nor the fallback file.
    expect(readFileSync(join(root, "env-index.json"), "utf8")).not.toContain(SECRET);
    expect(() => readFileSync(home.envFile, "utf8")).toThrow();
  });

  it("falls back to a 0600 file when the Keychain refuses", async () => {
    const s = new EnvStore(home, { backend: "keychain", security: fakeSecurity({ failWrites: true }) });
    const where = await s.set("builder", { ONE_CONNECT_KEY: KEY });
    expect(where.ONE_CONNECT_KEY).toBe("file");
    expect(statSync(home.envFile).mode & 0o777).toBe(0o600);
    expect(statSync(join(root, "env-index.json")).mode & 0o777).toBe(0o600);
    expect(readEnvFile(home.envFile)).toEqual({ ONE_CONNECT_KEY: KEY });
    expect(s.status("builder")).toMatchObject([{ name: "ONE_CONNECT_KEY", where: "file" }]);
  });

  it("uses the file off macOS, keeps lines it does not own, and replaces and removes", async () => {
    writeFileSync(home.envFile, "# mine\nOTHER=1\nONE_CLIENT_ID=old\n");
    const s = new EnvStore(home, { backend: "file" });
    expect(s.status("builder").find((x) => x.name === "ONE_CLIENT_ID")?.manual).toBe(true);
    await s.set("builder", { ONE_CLIENT_ID: "new_client_1", ONE_CLIENT_SECRET: SECRET });
    expect(readFileSync(home.envFile, "utf8")).toBe(`# mine\nOTHER=1\nONE_CLIENT_ID=new_client_1\nONE_CLIENT_SECRET=${SECRET}\n`);
    await s.remove("builder", ["ONE_CLIENT_SECRET"]);
    expect(readEnvFile(home.envFile)).toEqual({ OTHER: "1", ONE_CLIENT_ID: "new_client_1" });
    expect(s.has("builder", "ONE_CLIENT_SECRET")).toBe(false);
  });

  it("moves a hand-written file value into the Keychain on replace", async () => {
    writeFileSync(home.envFile, `ONE_CLIENT_SECRET=${SECRET}\n`);
    const sec = fakeSecurity();
    const s = new EnvStore(home, { backend: "keychain", security: sec });
    await s.set("builder", { ONE_CLIENT_SECRET: `${SECRET}2` });
    expect(readFileSync(home.envFile, "utf8")).not.toContain(SECRET);
    expect((await s.values("builder")).ONE_CLIENT_SECRET).toBe(`${SECRET}2`);
  });

  it("keeps project values apart, outside the project, and drops them with the project", async () => {
    const s = new EnvStore(home, { backend: "file" });
    await s.set("project:prj_a", { WEATHER_API_KEY: "wk-CANARY-1" });
    await s.set("project:prj_b", { WEATHER_API_KEY: "wk-CANARY-2" });
    expect(s.fileFor("project:prj_a").startsWith(home.state)).toBe(true);
    expect(await s.values("project:prj_a")).toEqual({ WEATHER_API_KEY: "wk-CANARY-1" });
    await s.removeScope("project:prj_a");
    expect(await s.values("project:prj_a")).toEqual({});
    expect(await s.values("project:prj_b")).toEqual({ WEATHER_API_KEY: "wk-CANARY-2" });
  });

  it.runIf(process.platform === "darwin" && spawnSync("/usr/bin/security", ["show-keychain-info"], { stdio: "ignore" }).status === 0)(
    "round-trips through the real login Keychain under a scratch home, and cleans up",
    async () => {
      const s = new EnvStore(home, { backend: "keychain" });
      try {
        const where = await s.set("project:prj_kc", { KC_TEST_SECRET: "kc-CANARY-'\"$`\\ value" });
        expect(where.KC_TEST_SECRET).toBe("keychain");
        expect((await s.values("project:prj_kc")).KC_TEST_SECRET).toBe("kc-CANARY-'\"$`\\ value");
      } finally {
        await s.remove("project:prj_kc", ["KC_TEST_SECRET"]);
      }
      expect(await s.values("project:prj_kc")).toEqual({});
    },
  );
});

describe("the code scan", () => {
  it("finds process.env, c.env, destructuring and VITE_ reads with file:line, and skips the platform's names", () => {
    const dir = mkdtempSync(join(tmpdir(), "builder-envscan-"));
    try {
      mkdirSync(join(dir, "server", "one"), { recursive: true });
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "server", "app.ts"), ['const k = c.env.WEATHER_API_KEY;', 'const s = process.env["STRIPE_SECRET"];', "const { SLACK_SIGNING_SECRET, ONE_MODE } = c.env;", "const r = c.env.BUILDER_RELAY_TOKEN;", "// mentions c.env.COMMENTED_OUT"].join("\n"));
      writeFileSync(join(dir, "server", "one", "connect.ts"), "const x = c.env.ONE_CLIENT_SECRET;");
      writeFileSync(join(dir, "src", "App.tsx"), "const u = import.meta.env.VITE_MAPS_KEY;");
      const refs = scanEnvRefs(dir);
      expect(refs.map((r) => r.name)).toEqual(["SLACK_SIGNING_SECRET", "STRIPE_SECRET", "VITE_MAPS_KEY", "WEATHER_API_KEY"]);
      expect(refs.find((r) => r.name === "WEATHER_API_KEY")!.sites).toEqual([{ file: "server/app.ts", line: 1 }]);
      expect(refs.find((r) => r.name === "VITE_MAPS_KEY")!.client).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("EnvService", () => {
  let root: string;
  let home: Home;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "builder-envsvc-"));
    home = resolveHome(root);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  /** A template's Connect app and one project's own, each with its own canaries. */
  const TEMPLATE = { ONE_CLIENT_ID: "client_8f2a91", ONE_CLIENT_SECRET: SECRET, ONE_CONNECT_KEY: KEY };
  const OWN = { ONE_CLIENT_ID: "client_own_77b3", ONE_CLIENT_SECRET: "one_secret_CANARYown1q2w3e4r5t", ONE_CONNECT_KEY: "sk_live_CANARYown6y7u8i9o", ONE_PERMISSION_SET: "ask_CANARY_42" };
  const SECRETS = [SECRET, KEY, OWN.ONE_CLIENT_SECRET, OWN.ONE_CONNECT_KEY];
  const leaks = (text: string) => [...SECRETS, ...SECRETS.map((x) => x.slice(-4)), OWN.ONE_PERMISSION_SET].filter((x) => text.includes(x));

  it("saves a Connect app per setup and reports status with no value in it", async () => {
    const svc = new EnvService({ home, backend: "keychain", security: fakeSecurity(), probe: null });
    expect(svc.setupConfigured("cs_t")).toBe(false);
    await svc.saveSetup("cs_t", TEMPLATE);
    expect(svc.setupConfigured("cs_t")).toBe(true);
    const status = svc.setupStatus("cs_t");
    expect(status.map((x) => x.name)).toEqual(["ONE_CLIENT_ID", "ONE_CLIENT_SECRET", "ONE_CONNECT_KEY", "ONE_PERMISSION_SET"]);
    expect(leaks(JSON.stringify(status))).toEqual([]);
    expect(status.find((x) => x.name === "ONE_CLIENT_ID")!.hint).toBe("…2a91");
    expect(status.find((x) => x.name === "ONE_CLIENT_SECRET")).toMatchObject({ present: true, secret: true, hint: null, where: "keychain" });
    expect(status.find((x) => x.name === "ONE_PERMISSION_SET")).toMatchObject({ present: false, required: false });
  });

  it("keeps each setup apart (a template and a project's own), copies inside the process, and drops one whole", async () => {
    const svc = new EnvService({ home, backend: "file", probe: null });
    await svc.saveSetup("cs_t", TEMPLATE);
    await svc.saveSetup("cs_own", OWN);
    expect(await svc.setupValues("cs_t")).toEqual(TEMPLATE);
    expect(await svc.setupValues("cs_own")).toEqual(OWN);
    await svc.copySetup("cs_t", "cs_copy");
    expect(await svc.setupValues("cs_copy")).toEqual(TEMPLATE);
    // A later change to the template does not reach the copy.
    await svc.saveSetup("cs_t", { ONE_CLIENT_ID: "client_changed_9" });
    expect((await svc.setupValues("cs_copy")).ONE_CLIENT_ID).toBe("client_8f2a91");
    expect((await svc.setupValues("cs_t")).ONE_CLIENT_ID).toBe("client_changed_9");
    // An empty optional value is removed; a required one is refused.
    await svc.saveSetup("cs_own", { ONE_PERMISSION_SET: "" });
    expect(svc.setupStatus("cs_own").find((x) => x.name === "ONE_PERMISSION_SET")!.present).toBe(false);
    await svc.dropSetup("cs_own");
    expect(await svc.setupValues("cs_own")).toEqual({});
    expect(svc.setupConfigured("cs_t")).toBe(true);
    // Nothing on disk outside the store holds a value: the index has names only.
    expect(leaks(readFileSync(join(root, "env-index.json"), "utf8"))).toEqual([]);
  });

  it("refuses a bad save whole, naming fields and never values, and refuses a redirect URI", async () => {
    const svc = new EnvService({ home, backend: "file", probe: null });
    await expect(svc.saveSetup("cs_t", { ONE_CLIENT_SECRET: KEY, ONE_CONNECT_KEY: KEY })).rejects.toMatchObject({ fields: { ONE_CLIENT_SECRET: expect.stringMatching(/connect key/i) } });
    await expect(svc.saveSetup("cs_t", { ...TEMPLATE, ONE_REDIRECT_URI: REDIRECT })).rejects.toMatchObject({ fields: { ONE_REDIRECT_URI: expect.any(String) } });
    await expect(svc.saveSetup("cs_t", { ...TEMPLATE, NOT_CONNECT: "x" })).rejects.toMatchObject({ fields: { NOT_CONNECT: expect.any(String) } });
    expect(svc.store.status("connect:cs_t")).toEqual([]);
    try {
      await svc.saveSetup("cs_t", { ONE_CLIENT_SECRET: KEY });
    } catch (e) {
      expect(JSON.stringify({ m: (e as Error).message, f: (e as { fields: unknown }).fields })).not.toContain(KEY);
    }
  });

  it("checks typed values over stored ones and asks the probe, never returning a value", async () => {
    const seen: string[] = [];
    const svc = new EnvService({ home, backend: "file", probe: async (id, secret, redirect) => (seen.push(id, secret, redirect), { online: "accepted", message: "One knows this app." }) });
    await svc.saveSetup("cs_t", TEMPLATE);
    const r = await svc.checkSetup("cs_t");
    expect(r.ok).toBe(true);
    expect(r.online).toBe("accepted");
    expect(seen).toEqual(["client_8f2a91", SECRET, REDIRECT]);
    expect(leaks(JSON.stringify(r))).toEqual([]);
    const typed = await svc.checkSetup("cs_t", { ONE_CLIENT_SECRET: OWN.ONE_CLIENT_SECRET });
    expect(seen.at(-2)).toBe(OWN.ONE_CLIENT_SECRET);
    expect(leaks(JSON.stringify(typed))).toEqual([]);
    const bad = await svc.checkSetup(null, { ONE_CLIENT_SECRET: "nope" });
    expect(bad.ok).toBe(false);
    expect(bad.online).toBe("skipped");
    const same = await svc.checkSetup(null, { ...TEMPLATE, ONE_CONNECT_KEY: SECRET });
    expect(same.items.find((i) => i.name === "ONE_CONNECT_KEY")!.level).toBe("error");
    const refused = new EnvService({ home, backend: "file", probe: async () => ({ online: "refused", message: "No." }) });
    expect((await refused.checkSetup("cs_t")).ok).toBe(false);
    const sample = new EnvService({ home, backend: "file", probe: "sample" });
    expect((await sample.checkSetup("cs_t")).online).toBe("sample");
  });

  it("scrubs every loaded Connect app's secrets out of any project's output", async () => {
    const svc = new EnvService({ home, backend: "file", probe: null });
    await svc.saveSetup("cs_t", TEMPLATE);
    await svc.saveSetup("cs_own", OWN);
    const fresh = new EnvService({ home, backend: "file", probe: null });
    expect(fresh.redact(null, `boom ${SECRET}`)).toContain(SECRET);
    await fresh.setupValues("cs_t");
    await fresh.setupValues("cs_own");
    for (const pid of [null, "prj_a", "prj_b"]) {
      const out = fresh.redact(pid, `secret=${SECRET} key=${KEY} own=${OWN.ONE_CLIENT_SECRET} ownkey=${OWN.ONE_CONNECT_KEY}`);
      expect(leaks(out)).toEqual([]);
      expect(out.split("[hidden]").length).toBe(5);
    }
    // What a dev server was given (noteLoaded) is scrubbed for that project, client id included.
    fresh.noteLoaded("prj_a", { ONE_CLIENT_ID: OWN.ONE_CLIENT_ID });
    expect(fresh.redact("prj_a", `id ${OWN.ONE_CLIENT_ID}`)).toBe("id [hidden]");
  });

  it("keeps Connect names out of a project's own values and the agent's facts", async () => {
    const svc = new EnvService({ home, backend: "file", probe: null });
    const dir = mkdtempSync(join(tmpdir(), "builder-envsvc-proj-"));
    try {
      mkdirSync(join(dir, "server"), { recursive: true });
      writeFileSync(join(dir, "server", "app.ts"), "const k = c.env.WEATHER_API_KEY; const s = c.env.ONE_CLIENT_SECRET;\n");
      await svc.saveSetup("cs_own", OWN);
      await svc.saveProject("prj_c", { WEATHER_API_KEY: "wk-CANARY-55" });
      const st = svc.projectStatus({ id: "prj_c", path: dir });
      expect(st.vars.map((x) => x.name)).toEqual(["WEATHER_API_KEY"]);
      const facts = svc.facts({ id: "prj_c", path: dir });
      expect(facts).toContain("WEATHER_API_KEY set");
      expect(facts).not.toContain("wk-CANARY-55");
      expect(leaks(facts)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("finds the retired builder-level app and a project's old Connect values, to move them once", async () => {
    const svc = new EnvService({ home, backend: "file", probe: null });
    expect(await svc.legacyBuilderValues()).toEqual({});
    await svc.store.set("builder", { ...TEMPLATE, ONE_REDIRECT_URI: "http://127.0.0.1:51989/api/one/callback" });
    expect(await svc.legacyBuilderValues()).toMatchObject(TEMPLATE);
    await svc.dropLegacyBuilder(["ONE_CLIENT_ID", "ONE_CLIENT_SECRET", "ONE_CONNECT_KEY", "ONE_REDIRECT_URI"]);
    expect(await svc.legacyBuilderValues()).toEqual({});
    await svc.store.set("project:prj_d", { ONE_CLIENT_ID: "client_old_1", WEATHER_API_KEY: "wk" });
    expect(await svc.legacyProjectConnect("prj_d")).toEqual({ ONE_CLIENT_ID: "client_old_1" });
    await svc.dropLegacyProjectConnect("prj_d", ["ONE_CLIENT_ID"]);
    expect(await svc.legacyProjectConnect("prj_d")).toEqual({});
    expect(await svc.store.values("project:prj_d")).toEqual({ WEATHER_API_KEY: "wk" });
  });

  it("scrubs a project's values out of its output once loaded", async () => {
    const svc = new EnvService({ home, backend: "file", probe: null });
    await svc.saveProject("prj_x", { WEATHER_API_KEY: "wk-CANARY-77" });
    expect(await svc.projectValues("prj_x", "preview")).toEqual({ WEATHER_API_KEY: "wk-CANARY-77" });
    expect(svc.redact("prj_x", "fetch failed for key wk-CANARY-77")).toBe("fetch failed for key [hidden]");
  });

  it("keeps published-only names out of the preview", async () => {
    const svc = new EnvService({ home, backend: "file", probe: null });
    await svc.saveProject("prj_y", { DATABASE_AUTH_TOKEN: "dbt-CANARY", WEATHER_API_KEY: "wk" });
    expect(Object.keys(await svc.projectValues("prj_y", "preview"))).toEqual(["WEATHER_API_KEY"]);
    expect(Object.keys(await svc.projectValues("prj_y", "publish")).sort()).toEqual(["DATABASE_AUTH_TOKEN", "WEATHER_API_KEY"]);
  });
});
