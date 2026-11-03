// The auto-fix loop on the real engine with replay scenarios.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BRAND } from "../src/brand.js";
import * as git from "../src/git.js";
import { linkScratchTemplateCache } from "../src/home.js";
import { createPlatform, type Platform } from "../src/platform.js";

let p: Platform;
let scratch: string;

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), `${BRAND.slug}-engine-test-`));
  linkScratchTemplateCache(scratch);
  // Its own Postgres port range, away from 51995 where the editor, the eval and the smokes boot.
  p = await createPlatform({ home: scratch, databasePort: 51840, preview: false, engine: { quietMs: 50, replaySpeed: 0 } });
}, 240_000);
afterAll(async () => {
  await p?.stop();
  rmSync(scratch, { recursive: true, force: true });
});

async function play(scenario: string) {
  const { row } = await p.workspace.create({ name: scenario, harness: "replay", model: scenario, permission: "build", autoFix: true });
  const t = await p.turns.submit(row, { prompt: "Add a broken file" });
  await p.turns.idle(row.id, 120_000);
  const all = (await p.turns.list(row.id)).turns;
  return { row, user: all.find((x) => x.id === t.id)!, fixes: all.filter((x) => x.parentTurnId === t.id).reverse() };
}

describe("auto-fix loop", () => {
  it("fixes and ends done, one checkpoint per changing turn", { timeout: 120_000 }, async () => {
    const { row, user, fixes } = await play("test-fix-ok");
    expect(user.status).toBe("done");
    expect(fixes).toHaveLength(1);
    expect(await p.errors.open(row.id)).toHaveLength(0);
    const log = await git.log(row.path);
    expect(log.map((l) => l.trailers[`${BRAND.name}-Kind`])).toEqual(["fix", "user", "template"]);
  });

  it("stops at 3 fix turns", { timeout: 180_000 }, async () => {
    const { user, fixes } = await play("test-fix-cap");
    expect(fixes.map((f) => f.fixAttempt)).toEqual([1, 2, 3]);
    expect(user.status).toBe("failed");
    expect(user.error).toMatch(/after 3 fixes/);
  });

  it("stops early on a repeated signature", { timeout: 120_000 }, async () => {
    const { user, fixes } = await play("test-fix-repeat");
    expect(fixes).toHaveLength(1);
    expect(user.status).toBe("failed");
    expect(user.error).toMatch(/same error came back/);
  });
});
