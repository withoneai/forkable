// RequestSpec + template context -> one.call input. Pagination and page size are applied
// through `passAs` ("query:x", "body:a.b", "header:x").

import type { CallInput, PassAs, RequestSpec } from "../contract.js";
import { setPath } from "../expr/path.js";
import { renderDeep, renderTemplate, type TemplateCtx } from "../expr/template.js";

export interface BuiltRequest {
  actionId: string;
  pathParams: Record<string, string>;
  query: Record<string, string | string[]>;
  body: unknown;
  headers: Record<string, string>;
}

export function buildRequest(spec: RequestSpec, ctx: TemplateCtx): BuiltRequest {
  const pathParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(spec.pathVars ?? {})) {
    const r = renderTemplate(v, ctx);
    if (r !== null) pathParams[k] = r;
  }
  const query: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(spec.query ?? {})) {
    if (Array.isArray(v)) {
      const vals = v.map((x) => renderTemplate(x, ctx)).filter((x): x is string => x !== null && x !== "");
      if (vals.length) query[k] = vals;
    } else {
      const r = renderTemplate(v, ctx);
      if (r !== null && r !== "") query[k] = r;
    }
  }
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(spec.headers ?? {})) {
    const r = renderTemplate(v, ctx);
    if (r !== null) headers[k] = r;
  }
  const body = spec.body === undefined ? undefined : renderDeep(spec.body, ctx);
  return { actionId: spec.actionId, pathParams, query, body, headers };
}

export function applyParam(req: BuiltRequest, passAs: PassAs | string, value: unknown): void {
  const i = passAs.indexOf(":");
  const where = passAs.slice(0, i);
  const name = passAs.slice(i + 1);
  if (where === "query") {
    if (value === undefined || value === null) delete req.query[name];
    else req.query[name] = String(value);
  } else if (where === "header") {
    if (value === undefined || value === null) delete req.headers[name];
    else req.headers[name] = String(value);
  } else {
    const body = (req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {}) as Record<string, unknown>;
    setPath(body, name, value);
    req.body = body;
  }
}

/** A full next URL (Graph @odata.nextLink / deltaLink): keep only its query. */
export function queryFromUrl(url: string): Record<string, string> {
  try {
    const u = new URL(url, "https://x.invalid");
    const out: Record<string, string> = {};
    u.searchParams.forEach((v, k) => { out[k] = v; });
    return out;
  } catch {
    return {};
  }
}

export function toCallInput(req: BuiltRequest, meta: { platform: string; action: string; summary: string; cursor?: string | null; partition?: string | null; delta?: string | null }): CallInput<unknown, unknown> {
  return {
    platform: meta.platform,
    action: meta.action,
    level: "read",
    actionId: req.actionId,
    method: req.body === undefined ? "GET" : "POST", // ledger hint only
    path: "", // looked up from the action id by runAction
    pathParams: req.pathParams,
    query: Object.keys(req.query).length ? req.query : undefined,
    body: req.body,
    headers: Object.keys(req.headers).length ? req.headers : undefined,
    summary: meta.summary,
    cursor: meta.cursor ?? null,
    partition: meta.partition ?? null,
    delta: meta.delta ?? null,
  };
}
