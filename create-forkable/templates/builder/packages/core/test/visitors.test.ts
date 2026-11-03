// Visitors on the owner's grant: the setting, the
// publish scan's block and warning, and the value a published app gets.

import { describe, expect, it } from "vitest";
import { visitorFindings } from "../src/publish/scan.js";
import type { Manifest, ManifestAction } from "../src/types.js";
import { allowedForVisitors, parseVisitors, patchVisitors, visitorEnvValue, visitorSplit, VISITORS_OFF } from "../src/visitors.js";

const PAGE = "conn_mod_def::GJ7H84zBlaI::BCfuA16aTaGVIax5magsLA";
const SEARCH = "conn_mod_def::GJ7H9zmRFIk::1RxrzeicS-ibnXF4sFC5Ww";
const POST = "conn_mod_def::GJ7K6GQFqoM::jSNC3ykpSqG7RdLQOF2rWQ";
const LIST = "conn_mod_def::GJ7KsRfyH8M::DEPSKKu2TUK22IjVPP1Hfg";

const act = (actionId: string, platform: string, title: string, level: ManifestAction["level"], runsAs?: ManifestAction["runsAs"]): ManifestAction => ({ platform, connDefId: null, actionId, title, method: level === "read" ? "GET" : "POST", level, ...(runsAs ? { runsAs } : {}) });

const manifest: Manifest = {
  version: 1,
  actions: [
    act(PAGE, "notion", "Create a Page", "write", ["owner"]),
    act(SEARCH, "notion", "Search by Title", "read", ["owner"]),
    act(POST, "slack", "Send Message", "write", ["user", "owner"]),
    act(LIST, "slack", "List Channels", "read"),
  ],
  unused: [],
};
const describeA = (a: ManifestAction) => `${a.platform} · ${a.title} (${a.level})`;

describe("the visitor setting", () => {
  it("is off by default and reads junk as off", () => {
    expect(parseVisitors(null)).toEqual(VISITORS_OFF);
    expect(parseVisitors({ enabled: "yes", actions: ["x", 3, PAGE, PAGE] })).toEqual({ enabled: false, actions: [PAGE] });
    expect(allowedForVisitors({ enabled: false, actions: [PAGE] }).size).toBe(0);
  });

  it("ticks and unticks per action; the switch is separate", () => {
    let v = patchVisitors(VISITORS_OFF, { allow: [PAGE, "not an id"] });
    expect(v).toEqual({ enabled: false, actions: [PAGE] });
    v = patchVisitors(v, { enabled: true, allow: [POST] });
    expect(v).toEqual({ enabled: true, actions: [PAGE, POST].sort() });
    v = patchVisitors(v, { disallow: [PAGE] });
    expect(v).toEqual({ enabled: true, actions: [POST] });
  });

  it("splits owner-run actions into allowed and not, leaving users-only actions out", () => {
    const s = visitorSplit(manifest, { enabled: true, actions: [PAGE, LIST] });
    expect(s.allowed.map((a) => a.actionId)).toEqual([PAGE]);
    expect(s.notAllowed.map((a) => a.actionId)).toEqual([SEARCH, POST]);
  });

  it("gives a published app only the allowed owner-run ids, or none", () => {
    expect(visitorEnvValue(manifest, VISITORS_OFF)).toBe("none");
    expect(visitorEnvValue(manifest, { enabled: false, actions: [PAGE] })).toBe("none");
    expect(visitorEnvValue(manifest, { enabled: true, actions: [POST, PAGE, LIST] })).toBe([PAGE, POST].sort().join(","));
  });
});

describe("publish scan: visitors", () => {
  it("blocks every owner-run action the builder has not allowed", () => {
    const f = visitorFindings(manifest, VISITORS_OFF, describeA);
    expect(f.map((x) => [x.code, x.level])).toEqual([
      ["visitor_not_allowed", "block"],
      ["visitor_not_allowed", "block"],
      ["visitor_not_allowed", "block"],
    ]);
    expect(f[0]!.title).toContain("notion · Create a Page (write)");
    expect(f[0]!.detail).toMatch(/off for this app/);
  });

  it("warns, naming them, when allowed owner-run actions write; allowed reads say nothing", () => {
    const f = visitorFindings(manifest, { enabled: true, actions: [PAGE, SEARCH, POST] }, describeA);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ code: "visitor_writes", level: "warn", detail: "notion · Create a Page (write), slack · Send Message (write)" });
    expect(visitorFindings(manifest, { enabled: true, actions: [SEARCH] }, describeA).filter((x) => x.level === "warn")).toEqual([]);
  });

  it("says nothing for an app with no owner-run calls", () => {
    expect(visitorFindings({ version: 1, actions: [act(LIST, "slack", "List Channels", "read")], unused: [] }, VISITORS_OFF)).toEqual([]);
  });
});
