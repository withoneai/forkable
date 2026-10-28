import sample from "../../fixtures/brief.json" with { type: "json" };
import { domainOf } from "./engines.js";
import type { Brand, Competitor, EngineId, Position, Run, Sentiment } from "./types.js";

// The Acme Inc sample Brief ships: Acme Inc as a fictional expense-management
// company against four made-up competitors, ten unbranded prompts, four
// engines, the last seven days. Generated sample answers with the judgments
// Brief stored for them (reoz/fixtures), not recordings of real engines.
// Days move with the calendar, so the sample always ends today.

interface SampleRun { promptId: string; day: string; engine: EngineId; mentioned: boolean; position: Position; sentiment: Sentiment; competitors: Record<string, boolean>; citations: string[] }
interface SampleAnswer { text: string; citations: { url: string; domain: string }[]; judgment: Record<string, number | string | null> }
const S = sample as unknown as { brand: Brand; competitors: Competitor[]; prompts: { id: string; text: string }[]; runs: SampleRun[]; answers: Record<string, Record<EngineId, SampleAnswer>> };

export const BRIEF_SAMPLE = { brand: S.brand, competitors: S.competitors, prompts: S.prompts, answers: S.answers };

export function sampleRuns(): Run[] {
  const last = S.runs.reduce((m, r) => (r.day > m ? r.day : m), "");
  const shift = Math.round((Date.parse(new Date().toISOString().slice(0, 10)) - Date.parse(last)) / 864e5);
  const prompt = new Map(S.prompts.map((p) => [p.id, p.text]));
  return S.runs.map((r) => ({
    ...r,
    prompt: prompt.get(r.promptId) ?? "",
    day: new Date(Date.parse(r.day) + shift * 864e5).toISOString().slice(0, 10),
    citations: r.citations.map((url) => ({ url, domain: domainOf(url) })),
  }));
}
