import { Hono } from "hono";
import type { OneServer } from "../lib/one-server.js";
import { GMAIL } from "../gmail/actions.js";
import { fromHelper, type HelperThread } from "../gmail/map.js";
import { rillConfig } from "../rill/config.js";
import { vipFor } from "../rill/policy.js";
import { RILL_SAMPLE } from "../rill/sample.js";
import type { VipSuggestion } from "../rill/types.js";

// Rill's VIP suggestions (orez providers/gmail/mail.ts, sentTo): the people
// you write to most, from your Sent mail. Code only, no model.
const NOT_A_PERSON = /no-?reply|notifications?@|calendar-notification/i;

/** GET /api/rill/vip-suggestions?max= -> VipSuggestion[] */
export function rillVipSuggestionsRoute(one: OneServer) {
  const r = new Hono();
  r.get("/api/rill/vip-suggestions", async (c) => {
    const max = Math.min(20, Math.max(1, Number(c.req.query("max") ?? 8)));
    try {
      const res = await one.call<{ threads?: HelperThread[] }>(c, {
        action: GMAIL.getThreads,
        body: { query: "in:sent newer_than:90d", numberOfThreads: 100, format: "full", maxBodyLength: 200 },
        sample: () => ({ threads: [] }),
      });
      const sample = res.meta.mode === "sample";
      const vips = sample ? RILL_SAMPLE.vips : rillConfig.vips;
      const counts = new Map<string, { name: string; count: number }>();
      if (sample) for (const s of RILL_SAMPLE.sent) counts.set(s.email, { name: s.name, count: s.count });
      else
        for (const t of res.data.threads ?? []) {
          const thread = fromHelper(t, "");
          for (const m of thread?.messages ?? []) {
            for (const e of m.to.map((x) => x.toLowerCase())) {
              const cur = counts.get(e) ?? { name: e.split("@")[0]!, count: 0 };
              cur.count++;
              counts.set(e, cur);
            }
          }
        }
      const out: VipSuggestion[] = [...counts.entries()]
        .filter(([e]) => !NOT_A_PERSON.test(e))
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, max)
        .map(([email, v]) => ({ name: v.name, email, sentCount: v.count, reason: v.count === 1 ? "You wrote to them once" : `You wrote to them ${v.count} times`, alreadyVip: !!vipFor(email, vips) }));
      return c.json({ data: out, meta: res.meta });
    } catch (e) {
      return one.error(c, e);
    }
  });
  return r;
}
