// test:profiles (CONTRACT 12): every built-in pack validates, names only manifest actions, and
// indexes its fixtures to the counts in fixtures/sample/<platform>/expect.json.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { sql } from "drizzle-orm";
import { loadBuiltinPacks } from "../src/profile/packs.js";
import { validateProfile } from "../src/profile/validate.js";
import { runSource } from "../src/engine/run.js";
import { fixtureTransport, loadSampleWorld } from "../src/sample/world.js";
import { upsertProfileVersion, createSource } from "../src/profile/builtins.js";
import { users } from "../src/db/schema.js";
import { makeCtx, testDb } from "./helpers.js";
// @ts-expect-error plain .mjs helper
import { profileActionIds } from "../scripts/gen-manifest.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const packs = loadBuiltinPacks(join(ROOT, "profiles"));
const manifest = JSON.parse(readFileSync(join(ROOT, "connect.manifest.json"), "utf8")) as { actions: { platform: string; actionId: string; method?: string; path?: string; grant?: boolean }[] };
const world = loadSampleWorld(join(ROOT, "fixtures", "sample"));
let b: Awaited<ReturnType<typeof testDb>>;

before(async () => { b = await testDb("profiles"); });
after(async () => { await b.done(); });

describe("built-in packs", () => {
  it("the 11 Acme packs are there (more may be added)", () => {
    for (const p of ["attio", "gmail", "google-calendar", "granola", "hubspot", "linear", "notion", "outlook-calendar", "outlook-mail", "slack", "teams"]) assert.ok(packs.some((k) => k.platform === p), `profiles/${p}/pack.json`);
  });
  it("a Google sync token never rides with the filters Google refuses next to it", () => {
    // Delta runs send the list request plus syncToken; Google answers 400
    // syncTokenWithRequestRestrictions if the list also carries any of these.
    const refused = ["timeMin", "timeMax", "updatedMin", "orderBy", "q", "iCalUID", "privateExtendedProperty", "sharedExtendedProperty"];
    for (const pack of packs) for (const p of pack.profiles) {
      const inc = p.incremental as { strategy?: string; tokenPassAs?: string } | undefined;
      if (inc?.strategy !== "delta" || (inc.tokenPassAs ?? "query:syncToken") !== "query:syncToken") continue;
      const q = (p.list as { query?: Record<string, unknown> }).query ?? {};
      for (const k of refused) assert.ok(!(k in q), `${p.id}: list.query.${k} is sent with syncToken; move it to incremental.bootstrap`);
    }
  });
  for (const pack of packs) {
    describe(pack.platform, () => {
      it("validates statically", () => {
        for (const p of pack.profiles) {
          const r = validateProfile(p);
          assert.ok(r.ok, `${p.id}: ${r.issues.filter((i) => i.level === "error").map((i) => i.message).join("; ")}`);
          assert.equal(p.verified, "fixture");
        }
      });
      it("calls native provider actions, never One's composite /v1/<platform>/ ones", () => {
        // One-served composites (POST /v1/attio/get-companies, /v1/gmail/get-threads) answered
        // 403 blockedByGrant on a real grant that listed them; see docs/CONTRACT.md, "Actions in the ask".
        for (const p of pack.profiles) for (const id of profileActionIds(p) as string[]) {
          const a = manifest.actions.find((x) => x.actionId === id);
          assert.ok(a?.method && a.path, `${p.id}: ${id} has no method/path in the manifest (node packages/core/scripts/gen-manifest.mjs --fill)`);
          assert.ok(!a.path!.startsWith(`/v1/${p.platform}/`), `${p.id}: ${id} is One's composite ${a.method} ${a.path}`);
        }
      });
      it("names only actions in connect.manifest.json", () => {
        for (const p of pack.profiles) for (const id of profileActionIds(p) as string[]) assert.ok(manifest.actions.some((a) => a.actionId === id && a.platform === p.platform), `${p.id}: ${id} missing from the manifest`);
      });
      const expectFile = join(ROOT, "fixtures", "sample", pack.platform, "expect.json");
      it("indexes its fixtures to expect.json", { skip: !existsSync(expectFile) }, async () => {
        const exp = JSON.parse(readFileSync(expectFile, "utf8")) as { profiles: Record<string, number>; kinds?: Record<string, number>; tombstoned?: number; items?: number; entities?: Record<string, { sources: string[] }> };
        const userId = `usr_${pack.platform.replace(/-/g, "_")}`;
        await b.db.insert(users).values({ id: userId, name: "Dana Oyelaran", email: "dana@acme.com", isSample: true }).onConflictDoNothing();
        const ctx = makeCtx(b, fixtureTransport(world));
        const ids: string[] = [];
        const ordered = [...pack.profiles].sort((x, y) => Number(!x.entities?.directory) - Number(!y.entities?.directory));
        for (const p of ordered) {
          if (!(p.id in exp.profiles)) continue;
          const v = await upsertProfileVersion(b.db, null, p, "builtin", "builtin");
          ids.push(await createSource(b.db, { userId, platform: p.platform, connectionKey: `sample:${p.platform}`, connectionLabel: "Acme sample", profileId: v.profileId, versionId: v.versionId, profile: p, mode: "fixture" }));
        }
        for (const pass of [1, 2]) for (const id of ids) {
          const r = await runSource(ctx, id, { trigger: pass === 1 ? "first" : "schedule" });
          assert.equal(r.outcome, "ok", `${id} pass ${pass}: ${r.error?.message}`);
        }
        const per = (await b.db.execute(sql`select pv.json->>'id' as id, count(i.id)::int as n from sources s join profile_versions pv on pv.id = s.profile_version_id left join items i on i.source_id = s.id and i.deleted_at is null where s.user_id = ${userId} group by 1`)).rows as { id: string; n: number }[];
        for (const [pid, n] of Object.entries(exp.profiles)) assert.equal(per.find((x) => x.id === pid)?.n ?? 0, n, `${pid} items`);
        if (exp.kinds) {
          const kinds = (await b.db.execute(sql`select kind, count(*)::int as n from items where user_id = ${userId} and deleted_at is null group by 1`)).rows as { kind: string; n: number }[];
          for (const [k, n] of Object.entries(exp.kinds)) assert.equal(kinds.find((x) => x.kind === k)?.n ?? 0, n, `kind ${k}`);
        }
        if (exp.tombstoned !== undefined) {
          const [t] = (await b.db.execute(sql`select count(*)::int as n from items where user_id = ${userId} and deleted_at is not null`)).rows as { n: number }[];
          assert.equal(t!.n, exp.tombstoned, "tombstoned");
        }
        for (const [key, want] of Object.entries(exp.entities ?? {})) {
          const got = ((await b.db.execute(sql`select distinct i.platform from entity_keys k join entities e on e.id = k.entity_id join entity_links l on l.entity_id = coalesce(e.merged_into_id, e.id) join items i on i.id = l.item_id where k.user_id = ${userId} and k.key = ${key} and i.deleted_at is null`)).rows as { platform: string }[]).map((r) => r.platform);
          for (const s of want.sources) assert.ok(got.includes(s), `${key} should link to ${s}`);
        }
      });
    });
  }
});
