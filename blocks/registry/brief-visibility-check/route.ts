import { Hono } from "hono";
import type { OneMeta, OneServer } from "../lib/one-server.js";
import { briefConfig } from "../brief/config.js";
import { runEngine } from "../brief/engines.js";
import { judge } from "../brief/judge.js";
import { BRIEF_SAMPLE } from "../brief/sample.js";
import { runStore } from "../brief/store.js";
import { ENGINES, type CheckResponse, type EngineAnswer, type EngineId, type Position, type Sentiment } from "../brief/types.js";

const words = (s: string) => new Set(s.toLowerCase().split(/\W+/).filter((w) => w.length > 3));

/** The sample prompt closest to what was typed, by shared words. */
function closestSample(prompt: string) {
  const w = words(prompt);
  return [...BRIEF_SAMPLE.prompts].map((p) => ({ p, score: [...words(p.text)].filter((x) => w.has(x)).length })).sort((a, b) => b.score - a.score)[0]!.p;
}

/**
 * POST /api/brief/check { prompt, engines? } -> CheckResponse
 * Asks the prompt of each engine on the user's own accounts, then Jev judges
 * each answer. Spends the user's provider credits, so the block only calls it
 * from a button.
 */
export function briefVisibilityCheckRoute(one: OneServer) {
  const r = new Hono();
  r.post("/api/brief/check", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { prompt?: string; engines?: EngineId[] };
    const prompt = String(body.prompt ?? "").trim().slice(0, 600);
    if (!prompt) return c.json({ error: { code: "bad_request", message: "Type a prompt." } }, 400);
    const engines = (body.engines?.length ? body.engines : [...ENGINES]).filter((e) => (ENGINES as readonly string[]).includes(e));
    try {
      const results = await Promise.all(engines.map(async (engine) => ({ engine, out: await runEngine(one, c, engine, prompt).catch((e: unknown) => (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "outside_grant" ? Promise.reject(e) : { error: String((e as Error)?.message ?? e) })) })));

      if (results.some((x) => x.out === null)) {
        const sp = closestSample(prompt);
        const rec = BRIEF_SAMPLE.answers[sp.id]!;
        const answers: EngineAnswer[] = engines.map((engine) => {
          const a = rec[engine];
          const j = a.judgment;
          return {
            engine,
            ok: true,
            error: null,
            text: a.text,
            mentioned: Number(j.mentioned) >= 0.5,
            mentionedP: Number(j.mentioned),
            recommended: Number(j.recommended) >= 0.5,
            position: j.position as Position,
            sentiment: j.sentiment as Sentiment,
            competitorsNamed: BRIEF_SAMPLE.competitors.filter((x) => Number(j[`competitor_${x.id}`]) >= 0.5).map((x) => x.name),
            citations: a.citations,
          };
        });
        const meta: OneMeta = { mode: "sample", platform: "openai", access: "write", status: 200 };
        const exact = sp.text.toLowerCase() === prompt.toLowerCase();
        return c.json({ data: { prompt: sp.text, brand: BRIEF_SAMPLE.brand, competitors: BRIEF_SAMPLE.competitors, answers, visibility: answers.filter((a) => a.mentioned).length, note: exact ? null : "Sample mode answers the closest of Acme's ten recorded prompts." } satisfies CheckResponse, meta });
      }

      const { brand, competitors } = briefConfig;
      const day = new Date().toISOString().slice(0, 10);
      const answers: EngineAnswer[] = await Promise.all(
        results.map(async ({ engine, out }) => {
          if (!out || "error" in out) return { engine, ok: false, error: out && "error" in out ? out.error : "No answer", text: "", mentioned: false, mentionedP: 0, recommended: false, position: "not_mentioned" as const, sentiment: "neutral" as const, competitorsNamed: [], citations: [] };
          const j = await judge(one, c, { brand, competitors, prompt, engine, text: out.text });
          return { engine, ok: true, error: null, text: out.text, mentioned: j.mentioned >= 0.5, mentionedP: j.mentioned, recommended: j.recommended >= 0.5, position: j.position, sentiment: j.sentiment, competitorsNamed: competitors.filter((x) => (j.competitors[x.id] ?? 0) >= 0.5).map((x) => x.name), citations: out.citations };
        }),
      );
      runStore.add(answers.filter((a) => a.ok).map((a) => ({ promptId: prompt.toLowerCase(), prompt, day, engine: a.engine, mentioned: a.mentioned, position: a.position, sentiment: a.sentiment, competitors: Object.fromEntries(competitors.map((x) => [x.id, a.competitorsNamed.includes(x.name)])), citations: a.citations })));
      const meta: OneMeta = { mode: "grant", platform: "openai", access: "write", status: 200 };
      return c.json({ data: { prompt, brand, competitors, answers, visibility: answers.filter((a) => a.mentioned).length, note: null } satisfies CheckResponse, meta });
    } catch (e) {
      return one.error(c, e);
    }
  });
  return r;
}
