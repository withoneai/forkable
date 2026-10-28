import { Hono } from "hono";
import type { OneMeta, OneServer } from "../lib/one-server.js";
import { briefConfig } from "../brief/config.js";
import { report } from "../brief/metrics.js";
import { BRIEF_SAMPLE, sampleRuns } from "../brief/sample.js";
import { runStore } from "../brief/store.js";
import type { ReportResponse } from "../brief/types.js";

/**
 * GET /api/brief/report?days= -> ReportResponse
 * Brief's metrics over the runs your app has stored. No platform call: the
 * runs were made (and paid for) by the visibility check.
 */
export function briefShareOfVoiceRoute(one: OneServer) {
  const r = new Hono();
  r.get("/api/brief/report", (c) => {
    const days = Math.min(90, Math.max(1, Number(c.req.query("days") ?? 7)));
    const mode = one.mode();
    const all = mode === "sample" ? sampleRuns() : runStore.all();
    const since = new Date(Date.now() - (days - 1) * 864e5).toISOString().slice(0, 10);
    const runs = all.filter((x) => x.day >= since);
    const { brand, competitors } = mode === "sample" ? BRIEF_SAMPLE : briefConfig;
    const meta: OneMeta = { mode, platform: "brief", access: "read", status: 200 };
    return c.json({ data: report(runs, brand, competitors) satisfies ReportResponse, meta });
  });
  return r;
}
