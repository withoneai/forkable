import type { Context } from "hono";
import type { OneServer } from "../lib/one-server.js";
import { JEV, MODELS } from "./actions.js";
import type { Brand, Competitor, Position, Sentiment } from "./types.js";

// One Jev request per answer, lifted from Brief (reoz/packages/core/src/jev.ts):
// is the brand named, is it recommended, where it lands among the names,
// what tone it gets, and one question per competitor. Thresholds at 0.5,
// as Brief's metrics read them.

const POSITION: Record<Position, string> = {
  first: "The brand is named first among any specific brand or product names in the answer, or named alone as the top or best option.",
  listed: "The brand is named, but only after at least one other named competitor, option or alternative.",
  buried: "The brand is named only deep in a list, a footnote, or as a minor aside after several other names, never as a considered option.",
  not_mentioned: "The brand's name, product name or any of its aliases is not mentioned anywhere in the answer.",
};
const SENTIMENT: Record<Sentiment, string> = {
  positive: "Where the brand is mentioned, the tone toward it is favorable, endorsing or complimentary.",
  neutral: "Where the brand is mentioned, the tone toward it is factual or descriptive, neither praising nor criticizing.",
  negative: "Where the brand is mentioned, the tone toward it is unfavorable, critical or discouraging.",
};

export interface Judgment { mentioned: number; recommended: number; position: Position; sentiment: Sentiment; competitors: Record<string, number> }

export async function judge(one: OneServer, c: Context, input: { brand: Brand; competitors: Competitor[]; prompt: string; engine: string; text: string }): Promise<Judgment> {
  const { brand } = input;
  const questions: Record<string, unknown> = {
    mentioned: { type: "noul", instructions: `Is ${brand.name} (or any of its aliases: ${brand.aliases.join(", ") || "none"}) mentioned anywhere in \`answer\`, by name?`, criteria: { true: "The brand's name or an alias appears in the answer.", false: "The brand is never named." } },
    recommended: { type: "noul", instructions: `Does \`answer\` actively recommend or endorse ${brand.name}, as opposed to a neutral or passing mention?`, criteria: { true: "The answer recommends, endorses or names it as a good choice.", false: "No recommendation of the brand, or it is not mentioned at all." } },
    position: { type: "choice", instructions: `Where does ${brand.name} land relative to the other options named in \`answer\`, for the question in \`prompt\`?`, criteria: POSITION },
    sentiment: { type: "choice", instructions: `What tone does \`answer\` take toward ${brand.name}? Only meaningful when the brand is mentioned; answer your best read regardless.`, criteria: SENTIMENT },
  };
  for (const comp of input.competitors) questions[`competitor_${comp.id}`] = { type: "noul", instructions: `Is ${comp.name} mentioned anywhere in \`answer\`, by name?`, criteria: { true: "That competitor's name appears in the answer.", false: "That competitor is never named." } };

  const r = await one.call<{ answers?: Record<string, { noul?: number; choice?: string }> }>(c, {
    action: JEV,
    body: {
      model: MODELS.jev,
      state: { brand, competitors: Object.fromEntries(input.competitors.map((x) => [x.id, `${x.name} (${x.domain})`])), prompt: { text: input.prompt }, answer: { text: input.text.slice(0, 6000), engine: input.engine } },
      questions,
    },
    sample: () => ({ answers: {} }),
  });
  const a = r.data.answers ?? {};
  const n = (k: string) => Math.max(0, Math.min(1, Number(a[k]?.noul ?? 0)));
  const pick = <T extends string>(k: string, allowed: Record<T, string>, d: T): T => ((a[k]?.choice ?? "") in allowed ? (a[k]!.choice as T) : d);
  return {
    mentioned: n("mentioned"),
    recommended: n("recommended"),
    position: pick("position", POSITION, "not_mentioned"),
    sentiment: pick("sentiment", SENTIMENT, "neutral"),
    competitors: Object.fromEntries(input.competitors.map((x) => [x.id, n(`competitor_${x.id}`)])),
  };
}
