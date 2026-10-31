// Field expressions (the Expr union) evaluated over a template context.

import type { Decoder, Expr } from "../contract.js";
import { decode, STRUCTURAL } from "../decode/index.js";
import { resolvePath } from "./path.js";
import { evalPredicate } from "./predicate.js";
import { renderTemplate, type TemplateCtx } from "./template.js";

export function isEmptyValue(v: unknown): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0) || (typeof v === "string" && !v.trim());
}

function decodeAll(values: unknown[], d: Decoder | undefined): unknown[] {
  if (!d) return values;
  const out: unknown[] = [];
  for (const v of values) {
    const r = decode(d, v);
    if (d === "address" && Array.isArray(r)) out.push(...r);
    else if (!isEmptyValue(r)) out.push(r);
  }
  return out;
}

function scalarString(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

/**
 * Evaluates an Expr. Paths resolve against `root` (default: ctx). Bare string paths
 * and { path } without `pick` return the first non-empty value.
 */
export function evalExpr(expr: Expr, ctx: TemplateCtx, root: unknown = ctx): unknown {
  if (typeof expr === "string") {
    return resolvePath(root, expr).find((v) => !isEmptyValue(v));
  }
  if ("path" in expr) {
    let values = resolvePath(root, expr.path);
    // A structural decoder given a single array (notion blocks) takes it whole.
    values = decodeAll(values, expr.decode);
    const pick = expr.pick ?? "first";
    switch (pick) {
      case "first": return values.find((v) => !isEmptyValue(v));
      case "last": return [...values].reverse().find((v) => !isEmptyValue(v));
      case "all": return values.flatMap((v) => (Array.isArray(v) && !(expr.decode && STRUCTURAL.has(expr.decode)) ? v : [v])).filter((v) => !isEmptyValue(v));
      case "count": {
        const raw = resolvePath(root, expr.path);
        return raw.length === 1 && Array.isArray(raw[0]) ? (raw[0] as unknown[]).length : raw.length;
      }
      case "join": return values.map(scalarString).filter((s) => s.trim()).join(expr.sep ?? "\n");
    }
  }
  if ("template" in expr) return renderTemplate(expr.template, ctx) ?? undefined;
  if ("coalesce" in expr) {
    for (const e of expr.coalesce) {
      const v = evalExpr(e, ctx, root);
      if (!isEmptyValue(v)) return v;
    }
    return undefined;
  }
  if ("join" in expr) {
    const parts = expr.join.map((e) => evalExpr(e, ctx, root)).map((v) => (Array.isArray(v) ? v.map(scalarString).filter(Boolean).join(", ") : scalarString(v)).trim()).filter(Boolean);
    return parts.length ? parts.join(expr.sep ?? " ") : undefined;
  }
  if ("test" in expr) return evalPredicate(expr.test, ctx);
  return undefined;
}

export function evalString(expr: Expr | undefined, ctx: TemplateCtx, root?: unknown): string | null {
  if (expr === undefined) return null;
  const v = evalExpr(expr, ctx, root ?? ctx);
  if (isEmptyValue(v)) return null;
  if (Array.isArray(v)) return v.map(scalarString).filter(Boolean).join(", ") || null;
  if (typeof v === "object") return null;
  return String(v);
}

export function evalList(expr: Expr | undefined, ctx: TemplateCtx): unknown[] {
  if (expr === undefined) return [];
  const v = evalExpr(typeof expr === "string" ? { path: expr, pick: "all" } : expr, ctx);
  if (isEmptyValue(v)) return [];
  return Array.isArray(v) ? v : [v];
}
