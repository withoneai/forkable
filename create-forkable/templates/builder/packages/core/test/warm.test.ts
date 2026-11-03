// The template warm under races: two warms on one cache, and a cache dir
// left holding only the ready marker (2026-10-24: every project cloned from
// it came out empty, so the auto-fix loop saw no errors and ran no fixes).
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { isWarm, READY_MARKER, TEMPLATE_VERSION, warmTemplate } from "@builder/template/render";
import { BRAND } from "../src/brand.js";

const root = mkdtempSync(join(tmpdir(), `${BRAND.slug}-warm-test-`));
// A stand-in for pnpm: a slow install that makes node_modules.
const pnpm = join(root, "fake-pnpm");
writeFileSync(pnpm, "#!/bin/sh\nsleep 0.3\nmkdir -p node_modules/fake\n");
chmodSync(pnpm, 0o755);
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("warmTemplate", () => {
  it("two warms at once both end on one complete dir and leave no tmp", { timeout: 30_000 }, async () => {
    const cache = join(root, "race");
    const [a, b] = await Promise.all([warmTemplate(cache, BRAND, () => {}, { pnpm }), warmTemplate(cache, BRAND, () => {}, { pnpm })]);
    expect(a).toBe(b);
    expect(isWarm(a)).toBe(true);
    expect(readdirSync(cache)).toEqual([TEMPLATE_VERSION]);
  });

  it("rebuilds a dir that has the marker but not the files", { timeout: 30_000 }, async () => {
    const cache = join(root, "broken");
    mkdirSync(join(cache, TEMPLATE_VERSION), { recursive: true });
    writeFileSync(join(cache, TEMPLATE_VERSION, READY_MARKER), "x\n");
    expect(isWarm(join(cache, TEMPLATE_VERSION))).toBe(false);
    const dir = await warmTemplate(cache, BRAND, () => {}, { pnpm });
    expect(isWarm(dir)).toBe(true);
    expect(readdirSync(cache)).toEqual([TEMPLATE_VERSION]);
  });
});
