// The mock's router and its server-event bus. Route modules register handlers
// with `route()`; server.ts patches fetch and EventSource to call them.
import type { ServerEvent } from "@/contract/api-types";

export type Ctx = { params: Record<string, string>; url: URL; body: unknown; signal?: AbortSignal | null };
export type Handler = (c: Ctx) => Response | Promise<Response> | unknown | Promise<unknown>;
interface Route { method: string; re: RegExp; names: string[]; handler: Handler }
export const routes: Route[] = [];

export function route(method: string, pattern: string, handler: Handler) {
  const names: string[] = [];
  const re = new RegExp(`^${pattern.replace(/:([a-zA-Z]+)/g, (_, n: string) => { names.push(n); return "([^/]+)"; })}$`);
  routes.push({ method, re, names, handler });
}

export const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
export const noContent = () => new Response(null, { status: 204 });
export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly data?: unknown) { super(message); }
}
export const fail = (status: number, code: string, message: string, data?: unknown): never => { throw new HttpError(status, code, message, data); };
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Listener = (e: ServerEvent) => void;
export const listeners = new Set<Listener>();
export function emit(e: ServerEvent) { listeners.forEach((l) => l(e)); }
