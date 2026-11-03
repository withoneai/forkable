import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { scanAgentProcesses, stopAgentProcesses } from "../src/processes.js";

describe("escaped agent processes", () => {
  it("finds a tagged listener started with nohup-style detach and stops it", async () => {
    const pid = "p_scan_test";
    const child = spawn(process.execPath, ["-e", "require('net').createServer().listen(0,'127.0.0.1'); setInterval(()=>{},1000)"], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, BUILDER_AGENT: "1", BUILDER_PROJECT_ID: pid, BUILDER_TURN_ID: "t_scan" },
    });
    child.unref();
    await new Promise((r) => setTimeout(r, 800));
    const found = await scanAgentProcesses(pid);
    expect(found.map((f) => f.pid)).toContain(child.pid);
    expect(found.find((f) => f.pid === child.pid)!.ports.length).toBe(1);
    const stopped = await stopAgentProcesses(pid);
    expect(stopped.length).toBeGreaterThan(0);
    expect(await scanAgentProcesses(pid)).toHaveLength(0);
  });
});

describe("the boot sweep stays in its own home", () => {
  const homeTag = /(?:^|\s)BUILDER_PREVIEW_HOME=(\S+)/;
  // The prefixes stopOrphanDevServers passes: the dev check's URL, and the retired relay's for older previews.
  const mine = ["BUILDER_DEV_URL=http://127.0.0.1:51979/", "BUILDER_RELAY_URL=http://127.0.0.1:51979/"];
  const dev = (home: string | null, port: number) =>
    `123 123 node vite.js BUILDER_DEV_PORT=52001 BUILDER_DEV_URL=http://127.0.0.1:${port}/api/dev/p1${home ? ` BUILDER_PREVIEW_HOME=${home}` : ""}`;
  const relay = (port: number) => `123 123 node vite.js BUILDER_DEV_PORT=52001 BUILDER_RELAY_URL=http://127.0.0.1:${port}/api/relay/p1`;
  it("stops a preview of the same home and server", async () => {
    const { previewIsOurs } = await import("../src/processes.js");
    expect(previewIsOurs(dev("/tmp/builder-eval-1", 51979), homeTag, "/tmp/builder-eval-1", mine)).toBe(true);
  });
  it("leaves another home's previews alone, even on the same server port", async () => {
    const { previewIsOurs } = await import("../src/processes.js");
    expect(previewIsOurs(dev("/Users/me/.builder", 51979), homeTag, "/tmp/builder-eval-1", mine)).toBe(false);
    expect(previewIsOurs(dev("/tmp/builder-eval-2", 51979), homeTag, "/tmp/builder-eval-1", mine)).toBe(false);
  });
  it("matches an untagged (older) preview by its dev URL, or older still its relay URL, only", async () => {
    const { previewIsOurs } = await import("../src/processes.js");
    expect(previewIsOurs(dev(null, 51989), homeTag, "/tmp/builder-eval-1", mine)).toBe(false);
    expect(previewIsOurs(dev(null, 51979), homeTag, "/tmp/builder-eval-1", mine)).toBe(true);
    expect(previewIsOurs(relay(51979), homeTag, "/tmp/builder-eval-1", mine)).toBe(true);
    expect(previewIsOurs(relay(51989), homeTag, "/tmp/builder-eval-1", mine)).toBe(false);
  });
  it("with no server origin, matches only a tagged preview of its own home", async () => {
    const { previewIsOurs } = await import("../src/processes.js");
    expect(previewIsOurs(dev("/tmp/builder-eval-1", 51989), homeTag, "/tmp/builder-eval-1", [])).toBe(true);
    expect(previewIsOurs(dev(null, 51989), homeTag, "/tmp/builder-eval-1", [])).toBe(false);
  });
});
