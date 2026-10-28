import type { OneAction } from "../lib/one-server.js";

// The engines Brief asks and the judge it uses, by their One action ids
// (reoz/packages/core/src/engines/*.ts and jev.ts). Each runs on the user's
// own account for that provider, through their grant.
export const ENGINE_ACTIONS = {
  openai: { platform: "openai", actionId: "conn_mod_def::GJ563wrwc5Q::nxVg0tlnR-6fNNpRZkHuKg", method: "POST", path: "/chat/completions", access: "write" },
  anthropic: { platform: "anthropic", actionId: "conn_mod_def::GJfJ6hmtpYo::zy68VQHpRFmqayjAzxkjDA", method: "POST", path: "/messages", access: "write" },
  gemini: { platform: "gemini", actionId: "conn_mod_def::GKYsL21usZ8::V-gBgeQuT06Ynd5FjAyvnA", method: "POST", path: "/v1beta/models/{{model}}:generateContent", access: "write" },
  perplexity: { platform: "perplexity", actionId: "conn_mod_def::GJ6CZeTvPJc::zmkwnSM8S6egtsvqG96MKQ", method: "POST", path: "/v1/sonar", access: "write" },
} as const satisfies Record<string, OneAction>;

export const JEV = { platform: "typesafe", actionId: "conn_mod_def::GNh4bXcHPaU::V2ndvy5CQJmYHvkElwVM_w", method: "POST", path: "/v1/systemone", access: "read" } as const satisfies OneAction;

export const MODELS = { openai: "gpt-5", anthropic: "claude-sonnet-5-5", gemini: "gemini-2.5-flash", perplexity: "sonar", jev: "jev-latest" } as const;
