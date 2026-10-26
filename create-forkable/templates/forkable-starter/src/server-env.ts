import type { HttpBindings } from "@hono/node-server";

// Hono's generic env, so route handlers can reach the raw Node request and
// response objects the One Connect node adapter needs (see connect.ts).
export type AppEnv = { Bindings: HttpBindings };
