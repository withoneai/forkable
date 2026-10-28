// The shapes the Brief routes return and the Brief blocks render.

export const ENGINES = ["openai", "anthropic", "gemini", "perplexity"] as const;
export type EngineId = (typeof ENGINES)[number];
export const ENGINE_LABELS: Record<EngineId, string> = { openai: "ChatGPT", anthropic: "Claude", gemini: "Gemini", perplexity: "Perplexity" };

/** Where the brand lands among the names an answer gives. "Order mentioned", never a rank. */
export type Position = "first" | "listed" | "buried" | "not_mentioned";
export type Sentiment = "positive" | "neutral" | "negative";

export interface Brand { name: string; domain: string; aliases: string[] }
export interface Competitor { id: string; name: string; domain: string }
export interface Citation { url: string; domain: string }

/** One prompt asked of one engine on one day, judged. */
export interface Run {
  promptId: string;
  prompt: string;
  day: string;
  engine: EngineId;
  mentioned: boolean;
  position: Position;
  sentiment: Sentiment;
  competitors: Record<string, boolean>;
  citations: Citation[];
}

export interface EngineAnswer {
  engine: EngineId;
  ok: boolean;
  error: string | null;
  text: string;
  mentioned: boolean;
  /** Jev's probability that the brand is named. */
  mentionedP: number;
  recommended: boolean;
  position: Position;
  sentiment: Sentiment;
  competitorsNamed: string[];
  citations: Citation[];
}

export interface CheckResponse {
  prompt: string;
  brand: Brand;
  competitors: Competitor[];
  answers: EngineAnswer[];
  /** Engines naming the brand, out of engines that answered. */
  visibility: number;
  note: string | null;
}

export interface ReportResponse {
  brand: Brand;
  competitors: Competitor[];
  runs: number;
  prompts: number;
  days: string[];
  /** 0..100, per engine then averaged. */
  visibility: number;
  perEngine: { engine: EngineId; visibility: number; runs: number }[];
  /** 0..100 per asset, summed over the period and divided once. */
  shareOfVoice: { id: string; name: string; share: number; isBrand: boolean }[];
  /** Per day, for the trend line. */
  trend: { day: string; brand: number }[];
  /** Mean order mentioned (1 first, 2 listed, 3 buried). Lower is better. */
  averagePosition: number | null;
  citations: { domain: string; count: number; share: number; owned: boolean; competitor: string | null; pages: { url: string; count: number }[] }[];
}

export const SAMPLE_PROMPTS_NOTE = "The Acme sample has ten recorded prompts.";
