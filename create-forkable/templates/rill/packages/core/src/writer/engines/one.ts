import { eq } from "drizzle-orm";
import type { Ctx, Writer, WriterCompletion } from "../../contract.js";
import { ledger as ledgerTable } from "../../db/schema.js";
import { one } from "../../one.js";
import type { Platform } from "../../types.js";

// The "one" engine: Anthropic, OpenAI or Gemini through One on the user's grant's
// connection. No model SDKs in the repo; one ledger for every call. The call
// layer writes the ledger row; this file adds engine, model and cost to it.

export const ANTHROPIC_ACTION = { id: "conn_mod_def::GJfJ6hmtpYo::zy68VQHpRFmqayjAzxkjDA", method: "POST", path: "/messages" } as const;

export const ONE_MODELS: Record<"anthropic" | "openai" | "gemini", { draft: string; fast: string }> = {
  anthropic: { draft: "claude-sonnet-5-5", fast: "claude-haiku-5-5" },
  openai: { draft: "gpt-5", fast: "gpt-5-mini" },
  gemini: { draft: "gemini-2.5-pro", fast: "gemini-2.5-flash" },
};

/** USD per million tokens, input then output. Used only for the ledger's cost column. */
const PRICE: Record<string, [number, number]> = {
  "claude-sonnet-5-5": [2, 10],
  "claude-sonnet-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-haiku-4-5": [1, 5],
  "claude-opus-5-5": [4, 20],
};

function costOf(model: string, input: number, output: number): number | null {
  const p = PRICE[model];
  if (!p) return null;
  return (input * p[0] + output * p[1]) / 1e6;
}

interface AnthropicResponse {
  content?: { type?: string; text?: string }[];
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  stop_reason?: string;
}

export function oneWriter(provider: "anthropic" | "openai" | "gemini", model?: string): Writer {
  const draftModel = model ?? ONE_MODELS[provider].draft;
  return {
    engine: "one",
    provider,
    model: draftModel,
    async complete(ctx: Ctx, input): Promise<WriterCompletion> {
      const w = this;
      if (provider !== "anthropic") throw new Error(`${provider} through One is not wired yet. Pick Anthropic or a local agent in settings`);
      const platform: Platform = "anthropic";
      const { row, data, meta } = await one.attempt<AnthropicResponse>(ctx, {
        platform,
        action: "messages",
        level: "read",
        actionId: ANTHROPIC_ACTION.id,
        method: ANTHROPIC_ACTION.method,
        path: ANTHROPIC_ACTION.path,
        headers: { "anthropic-version": "2023-06-01" },
        body: {
          model: w.model,
          max_tokens: input.maxTokens ?? 1024,
          system: input.system,
          messages: [{ role: "user", content: input.user }],
        },
        credential: "grant",
        summary: input.summary,
        fixture: () => {
          throw new Error("the one writer has no fixtures; sample mailboxes replay recordings");
        },
      });
      const text = data?.content?.find((c) => c.type === "text" && typeof c.text === "string")?.text ?? data?.content?.[0]?.text ?? "";
      const usedModel = data?.model ?? w.model;
      const costUsd = data?.usage ? costOf(usedModel, data.usage.input_tokens ?? 0, data.usage.output_tokens ?? 0) : null;
      await ctx.db.update(ledgerTable).set({ engine: "one", model: usedModel, costUsd }).where(eq(ledgerTable.id, row.id));
      if (!meta.ok) throw new Error(`Anthropic through One answered ${meta.status}${row.note ? `: ${row.note}` : ""}`);
      if (!text) throw new Error("Anthropic through One returned no text");
      input.stream?.(text); // no token streaming through One yet: deliver the whole reply at once
      return { text, model: usedModel, costUsd, ms: meta.ms };
    },
  };
}
