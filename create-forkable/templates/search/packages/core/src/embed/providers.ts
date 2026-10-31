// Embedding request builders through One on the grant (SPEC 6). One vector width: 1536.

import type { CallInput } from "../contract.js";

export type TaskType = "document" | "query";

export interface EmbedProvider {
  platform: string;
  model: string;
  batch: number;
  build(texts: string[], task: TaskType): CallInput<unknown, number[][]>;
}

export const DIMS = 1536;

export function pad(v: number[], dims = DIMS): number[] {
  if (v.length === dims) return v;
  if (v.length > dims) return v.slice(0, dims);
  return [...v, ...new Array(dims - v.length).fill(0)];
}

const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);

export const PROVIDERS: Record<string, (model?: string) => EmbedProvider> = {
  openai: (model = "text-embedding-3-small") => ({
    platform: "openai", model, batch: 128,
    build: (texts) => ({
      platform: "openai", action: "embed", level: "read", actionId: "conn_mod_def::GJ564JtA2kg::RZSxROt_TaGPn5dj1cERcg",
      method: "POST", path: "/embeddings", body: { model, input: texts, dimensions: DIMS }, summary: "Embed text for semantic search",
      pick: (d) => arr((d as { data?: unknown }).data).map((e) => pad(((e as { embedding?: number[] }).embedding) ?? [])),
    }),
  }),
  gemini: (model = "gemini-embedding-001") => ({
    platform: "gemini", model, batch: 100,
    build: (texts, task) => ({
      platform: "gemini", action: "embed", level: "read", actionId: "conn_mod_def::GKYsLheH12Q::Tpg2bcnfSjenI3U6jlwKzQ",
      method: "POST", path: "/v1beta/models/{{model}}:batchEmbedContents", pathParams: { model },
      body: { requests: texts.map((text) => ({ model: `models/${model}`, content: { parts: [{ text }] }, taskType: task === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT", outputDimensionality: DIMS })) },
      summary: "Embed text for semantic search",
      pick: (d) => arr((d as { embeddings?: unknown }).embeddings).map((e) => pad(((e as { values?: number[] }).values) ?? [])),
    }),
  }),
  cohere: (model = "embed-v4.0") => ({
    platform: "cohere", model, batch: 96,
    build: (texts, task) => ({
      platform: "cohere", action: "embed", level: "read", actionId: "conn_mod_def::GOBI50QrjAs::W77uZN_sRAq12F_k0a3kEg",
      method: "POST", path: "/v2/embed",
      body: { model, texts, input_type: task === "query" ? "search_query" : "search_document", embedding_types: ["float"], output_dimension: DIMS, truncate: "END" },
      summary: "Embed text for semantic search",
      pick: (d) => arr(((d as { embeddings?: { float?: unknown } }).embeddings ?? {}).float).map((e) => pad(e as number[])),
    }),
  }),
  "mistral-ai": (model = "mistral-embed") => ({
    platform: "mistral-ai", model, batch: 64,
    build: (texts) => ({
      platform: "mistral-ai", action: "embed", level: "read", actionId: "conn_mod_def::GMZh4j5K2IA::ZZRIBQWMS0-Kn1uey0EP4A",
      method: "POST", path: "/v1/embeddings", body: { model, input: texts }, summary: "Embed text for semantic search",
      // mistral-embed is 1024 wide: zero-padded to 1536, cosine similarity unchanged
      pick: (d) => arr((d as { data?: unknown }).data).map((e) => pad(((e as { embedding?: number[] }).embedding) ?? [])),
    }),
  }),
};
