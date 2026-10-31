// Templates: literal text with {{ expr | filter:arg }} parts. Closed filter list (SPEC 5.1).
// Rendering rules:
// - a template with no {{ }} is a literal;
// - when every {{ }} renders empty, the template renders null;
// - with { strict: true } (links), any empty {{ }} renders null, and so does a non-absolute URL.

import { decodeDomain, decodeEmail } from "../decode/address.js";
import { decodeHtml } from "../decode/text.js";
import { pathValue, isValidPath } from "./path.js";
import { formatDate, parseDuration, toDate } from "./time.js";

export type TemplateCtx = Record<string, unknown>;

export const FILTERS = ["iso", "unix", "unixms", "date", "lower", "upper", "email", "domain", "urlencode", "json", "join", "first", "last", "default", "slackts", "firstline", "truncate", "striphtml", "plus"] as const;
export type FilterName = (typeof FILTERS)[number];

/** The root names templates and paths may start with (SPEC 5.2). */
export const CTX_ROOTS = ["item", "detail", "children", "partition", "unit", "doc", "cursor", "run", "account", "settings", "now", "el"] as const;

interface Part { kind: "lit"; text: string }
interface Slot { kind: "slot"; expr: { path?: string; lit?: string | number }; filters: { name: FilterName; arg?: string }[]; raw: string }
type Piece = Part | Slot;

export class TemplateError extends Error {}

const parsed = new Map<string, Piece[]>();

function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let q: string | null = null, cur = "";
  for (const ch of s) {
    if (q) { if (ch === q) q = null; cur += ch; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === sep) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function unquote(s: string): string {
  const t = s.trim();
  return /^(['"]).*\1$/.test(t) ? t.slice(1, -1) : t;
}

export function parseTemplate(tpl: string): Piece[] {
  const hit = parsed.get(tpl);
  if (hit) return hit;
  const pieces: Piece[] = [];
  let i = 0;
  while (i < tpl.length) {
    const open = tpl.indexOf("{{", i);
    if (open < 0) { pieces.push({ kind: "lit", text: tpl.slice(i) }); break; }
    if (open > i) pieces.push({ kind: "lit", text: tpl.slice(i, open) });
    const close = tpl.indexOf("}}", open + 2);
    if (close < 0) throw new TemplateError(`unclosed {{ in "${tpl}"`);
    const raw = tpl.slice(open + 2, close).trim();
    const [head, ...rest] = splitTop(raw, "|");
    const h = (head ?? "").trim();
    if (!h) throw new TemplateError(`empty {{ }} in "${tpl}"`);
    let expr: Slot["expr"];
    if (/^(['"]).*\1$/.test(h)) expr = { lit: unquote(h) };
    else if (/^-?\d+(\.\d+)?$/.test(h)) expr = { lit: Number(h) };
    else {
      if (!isValidPath(h)) throw new TemplateError(`bad path "${h}" in "${tpl}"`);
      expr = { path: h };
    }
    const filters = rest.map((f) => {
      const t = f.trim();
      const c = t.indexOf(":");
      const name = (c < 0 ? t : t.slice(0, c)).trim() as FilterName;
      if (!FILTERS.includes(name)) throw new TemplateError(`unknown filter "${name}" in "${tpl}"`);
      return c < 0 ? { name } : { name, arg: unquote(t.slice(c + 1)) };
    });
    pieces.push({ kind: "slot", expr, filters, raw });
    i = close + 2;
  }
  parsed.set(tpl, pieces);
  return pieces;
}

/** Paths a template reads (for static validation of roots). */
export function templatePaths(tpl: string): string[] {
  return parseTemplate(tpl).flatMap((p) => (p.kind === "slot" && p.expr.path ? [p.expr.path] : []));
}

export function hasSlots(tpl: string): boolean {
  return tpl.includes("{{");
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0) || (typeof v === "string" && !v.trim());
}

export function applyFilter(name: FilterName, v: unknown, arg?: string): unknown {
  switch (name) {
    case "iso": { const d = toDate(v); return d ? d.toISOString() : undefined; }
    case "unix": { const d = toDate(v); return d ? Math.floor(d.getTime() / 1000) : undefined; }
    case "unixms": { const d = toDate(v); return d ? d.getTime() : undefined; }
    case "date": { const d = toDate(v); return d ? formatDate(d, arg ?? "yyyy-MM-dd") : undefined; }
    // a date moved forward by a duration: {{ now | plus:365d | iso }} bounds a calendar's expansion (D45)
    case "plus": { const d = toDate(v); const ms = parseDuration(arg); return d && ms !== null && Number.isFinite(ms) ? new Date(d.getTime() + ms) : undefined; }
    case "lower": return typeof v === "string" ? v.toLowerCase() : v;
    case "upper": return typeof v === "string" ? v.toUpperCase() : v;
    case "email": return decodeEmail(Array.isArray(v) ? v[0] : v);
    case "domain": return decodeDomain(Array.isArray(v) ? v[0] : v);
    case "urlencode": return isEmpty(v) ? undefined : encodeURIComponent(String(v));
    case "json": return v === undefined ? undefined : JSON.stringify(v);
    case "join": return Array.isArray(v) ? v.filter((x) => !isEmpty(x)).map(String).join(arg ?? ",") : v;
    case "first": return Array.isArray(v) ? v[0] : v;
    case "last": return Array.isArray(v) ? v[v.length - 1] : v;
    case "default": return isEmpty(v) ? (arg ?? "") : v;
    case "striphtml": {
      const s = Array.isArray(v) ? v[0] : v;
      return typeof s === "string" ? decodeHtml(s) : s;
    }
    case "firstline": {
      const s = Array.isArray(v) ? v[0] : v;
      if (typeof s !== "string") return s;
      return s.split(/\n|(?<=[.!?])\s/).map((x) => x.trim()).find(Boolean) ?? "";
    }
    case "truncate": {
      const s = Array.isArray(v) ? v[0] : v;
      const n = Number(arg ?? 80);
      if (typeof s !== "string" || s.length <= n) return s;
      return s.slice(0, Math.max(1, n - 1)).trimEnd() + "\u2026";
    }
    case "slackts": {
      const s = Array.isArray(v) ? v[0] : v;
      if (isEmpty(s)) return undefined;
      return `p${String(s).replace(".", "")}`;
    }
  }
}

/** Evaluate one slot to a value (not stringified). */
function evalSlot(slot: Slot, ctx: TemplateCtx): unknown {
  let v: unknown = slot.expr.path !== undefined ? pathValue(ctx, slot.expr.path) : slot.expr.lit;
  for (const f of slot.filters) v = applyFilter(f.name, v, f.arg);
  return v;
}

function str(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.filter((x) => !isEmpty(x)).map(str).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function renderTemplate(tpl: string, ctx: TemplateCtx, opts: { strict?: boolean } = {}): string | null {
  if (!hasSlots(tpl)) return tpl;
  const pieces = parseTemplate(tpl);
  let out = "";
  let slots = 0, empty = 0;
  for (const p of pieces) {
    if (p.kind === "lit") { out += p.text; continue; }
    slots++;
    const v = evalSlot(p, ctx);
    if (isEmpty(v)) { empty++; if (opts.strict) return null; continue; }
    out += str(v);
  }
  if (slots > 0 && empty === slots) return null;
  if (opts.strict && !/^https?:\/\/[^\s]+$/.test(out.trim())) return null;
  return out;
}

/** A template that is exactly one slot keeps its value's type (numbers in request bodies). */
export function renderValue(tpl: string, ctx: TemplateCtx): unknown {
  if (!hasSlots(tpl)) return tpl;
  const pieces = parseTemplate(tpl);
  if (pieces.length === 1 && pieces[0]!.kind === "slot") {
    const v = evalSlot(pieces[0] as Slot, ctx);
    return isEmpty(v) ? undefined : v;
  }
  return renderTemplate(tpl, ctx) ?? undefined;
}

/** Renders every string inside a JSON value. Keys whose value renders empty are dropped. */
export function renderDeep(v: unknown, ctx: TemplateCtx, keepType = false): unknown {
  if (typeof v === "string") {
    const r = keepType ? renderValue(v, ctx) : renderTemplate(v, ctx) ?? undefined;
    return r;
  }
  if (Array.isArray(v)) return v.map((x) => renderDeep(x, ctx, keepType)).filter((x) => x !== undefined);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      const r = renderDeep(x, ctx, keepType);
      if (r !== undefined) out[k] = r;
    }
    return out;
  }
  return v;
}
