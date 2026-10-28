import type { Context } from "hono";
import type { OneServer } from "../lib/one-server.js";
import { ENGINE_ACTIONS, MODELS } from "./actions.js";
import type { Citation, EngineId } from "./types.js";

// Each engine through One on the user's own account, lifted from Brief
// (reoz/packages/core/src/engines). Web grounding is on where the provider
// has it; citations come from the provider's own field first and fall back
// to URLs the prose names (never a claim the model searched).

export const domainOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};
const URL_RE = /https?:\/\/[^\s)>\]"'`]+/gi;
export function extractUrls(text: string): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const m of text.match(URL_RE) ?? []) {
    const url = m.replace(/[.,;:)\]]+$/, "");
    if (seen.has(url)) continue;
    seen.add(url);
    const domain = domainOf(url);
    if (domain) out.push({ url, domain });
  }
  return out;
}
const asCitations = (urls: (string | undefined)[]) => urls.filter((u): u is string => !!u).map((url) => ({ url, domain: domainOf(url) })).filter((c) => c.domain);

const SYSTEM = "Answer the question directly and naturally, the way you would for someone researching options. Be specific about names of products, companies or tools when relevant.";

/** Null before a Connect app exists: the caller answers from the sample instead. */
export async function runEngine(one: OneServer, c: Context, engine: EngineId, prompt: string): Promise<{ text: string; citations: Citation[] } | null> {
  const fail = () => ({}) as never;
  if (engine === "openai") {
    const r = await one.call<{ choices?: { message?: { content?: string; annotations?: { type?: string; url_citation?: { url?: string } }[] } }[] }>(c, {
      action: ENGINE_ACTIONS.openai,
      body: { model: MODELS.openai, messages: [{ role: "user", content: prompt }], web_search_options: {} },
      sample: fail,
    });
    if (r.meta.mode === "sample") return null;
    const m = r.data.choices?.[0]?.message;
    const text = m?.content ?? "";
    const native = asCitations((m?.annotations ?? []).filter((a) => a.type === "url_citation").map((a) => a.url_citation?.url));
    return { text, citations: native.length ? native : extractUrls(text) };
  }
  if (engine === "anthropic") {
    const r = await one.call<{ content?: { type?: string; text?: string }[] }>(c, {
      action: ENGINE_ACTIONS.anthropic,
      headers: { "anthropic-version": "2023-06-01" },
      body: { model: MODELS.anthropic, max_tokens: 900, system: SYSTEM, messages: [{ role: "user", content: prompt }] },
      sample: fail,
    });
    if (r.meta.mode === "sample") return null;
    const text = r.data.content?.find((b) => b.type === "text")?.text ?? "";
    return { text, citations: extractUrls(text) };
  }
  if (engine === "gemini") {
    const r = await one.call<{ candidates?: { content?: { parts?: { text?: string }[] }; groundingMetadata?: { groundingChunks?: { web?: { uri?: string } }[] } }[] }>(c, {
      action: ENGINE_ACTIONS.gemini,
      pathParams: { model: MODELS.gemini },
      body: { contents: [{ role: "user", parts: [{ text: prompt }] }], tools: [{ googleSearch: {} }] },
      sample: fail,
    });
    if (r.meta.mode === "sample") return null;
    const cand = r.data.candidates?.[0];
    const text = (cand?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    const native = asCitations((cand?.groundingMetadata?.groundingChunks ?? []).map((g) => g.web?.uri));
    return { text, citations: native.length ? native : extractUrls(text) };
  }
  const r = await one.call<{ choices?: { message?: { content?: string } }[]; citations?: string[] | null }>(c, {
    action: ENGINE_ACTIONS.perplexity,
    body: { model: MODELS.perplexity, messages: [{ role: "user", content: prompt }] },
    sample: fail,
  });
  if (r.meta.mode === "sample") return null;
  const text = r.data.choices?.[0]?.message?.content ?? "";
  const native = asCitations(r.data.citations ?? []);
  return { text, citations: native.length ? native : extractUrls(text) };
}
