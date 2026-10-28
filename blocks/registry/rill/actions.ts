import type { OneAction } from "../lib/one-server.js";

// Jev (TypeSafe's System One) answers typed questions about an email with
// calibrated probabilities. Rill uses it for every lane. Same action id Rill
// calls (orez/packages/core/src/jev.ts).
export const JEV = {
  systemOne: { platform: "typesafe", actionId: "conn_mod_def::GNh4bXcHPaU::V2ndvy5CQJmYHvkElwVM_w", method: "POST", path: "/v1/systemone", access: "read" },
} as const satisfies Record<string, OneAction>;

export const JEV_MODEL = "jev-latest";
