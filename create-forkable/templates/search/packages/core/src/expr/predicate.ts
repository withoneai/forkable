// Predicates for keep, deletes.when, classify.when, children.when, partitions keep and
// { test } fields. A real tokenizer and recursive-descent parser; never eval.
//   == != > >= < <= && || ! in, len(x), contains(x, y), lower(x), paths, 'strings',
//   numbers, true false null, durations (30d), now, now - 30d, [list], ( ).

import { isValidPath, pathValue } from "./path.js";
import { parseDuration, toDate } from "./time.js";
import type { TemplateCtx } from "./template.js";

type Tok =
  | { t: "num"; v: number } | { t: "str"; v: string } | { t: "dur"; v: number }
  | { t: "id"; v: string } | { t: "op"; v: string } | { t: "end" };

export type Node =
  | { k: "lit"; v: unknown }
  | { k: "path"; p: string }
  | { k: "now" }
  | { k: "not"; e: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "call"; f: string; args: Node[] }
  | { k: "list"; items: Node[] };

export class PredicateError extends Error {}

const OPS = ["==", "!=", ">=", "<=", "&&", "||", ">", "<", "!", "(", ")", "[", "]", ",", "+", "-"];

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (c === "'" || c === '"') {
      const j = src.indexOf(c, i + 1);
      if (j < 0) throw new PredicateError(`unclosed string in: ${src}`);
      out.push({ t: "str", v: src.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    const num = /^\d+(\.\d+)?([a-z]+)?/.exec(src.slice(i));
    if (num) {
      if (num[2]) {
        const d = parseDuration(num[0]);
        if (d === null) throw new PredicateError(`bad duration ${num[0]} in: ${src}`);
        out.push({ t: "dur", v: d });
      } else out.push({ t: "num", v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    if (/[A-Za-z_$@]/.test(c)) {
      let j = i;
      while (j < src.length) {
        const ch = src[j]!;
        if (/[\w$@.]/.test(ch)) { j++; continue; }
        if (ch === "[") {
          const close = src.indexOf("]", j);
          if (close < 0) throw new PredicateError(`unclosed [ in: ${src}`);
          j = close + 1;
          continue;
        }
        break;
      }
      out.push({ t: "id", v: src.slice(i, j) });
      i = j;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new PredicateError(`unexpected "${c}" in: ${src}`);
    out.push({ t: "op", v: op });
    i += op.length;
  }
  out.push({ t: "end" });
  return out;
}

const FUNCS = new Set(["len", "contains", "lower", "startsWith"]);

export function parsePredicate(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p]!;
  const isOp = (v: string) => { const t = peek(); return t.t === "op" && t.v === v; };
  const eat = (v: string) => { if (!isOp(v)) throw new PredicateError(`expected "${v}" in: ${src}`); p++; };

  const primary = (): Node => {
    const t = toks[p++]!;
    if (t.t === "num" || t.t === "str") return { k: "lit", v: t.v };
    if (t.t === "dur") return { k: "lit", v: { durationMs: t.v } };
    if (t.t === "op" && t.v === "(") { const e = or(); eat(")"); return e; }
    if (t.t === "op" && t.v === "[") {
      const items: Node[] = [];
      if (!isOp("]")) { items.push(or()); while (isOp(",")) { p++; items.push(or()); } }
      eat("]");
      return { k: "list", items };
    }
    if (t.t === "op" && t.v === "-") {
      const n = primary();
      return { k: "bin", op: "-", a: { k: "lit", v: 0 }, b: n };
    }
    if (t.t === "id") {
      if (t.v === "true") return { k: "lit", v: true };
      if (t.v === "false") return { k: "lit", v: false };
      if (t.v === "null") return { k: "lit", v: null };
      if (t.v === "now") return { k: "now" };
      if (isOp("(")) {
        if (!FUNCS.has(t.v)) throw new PredicateError(`unknown function ${t.v}() in: ${src}`);
        p++;
        const args: Node[] = [];
        if (!isOp(")")) { args.push(or()); while (isOp(",")) { p++; args.push(or()); } }
        eat(")");
        return { k: "call", f: t.v, args };
      }
      if (!isValidPath(t.v)) throw new PredicateError(`bad path ${t.v} in: ${src}`);
      return { k: "path", p: t.v };
    }
    throw new PredicateError(`unexpected token in: ${src}`);
  };
  const add = (): Node => {
    let a = primary();
    while (isOp("+") || isOp("-")) { const op = (toks[p++] as { v: string }).v; a = { k: "bin", op, a, b: primary() }; }
    return a;
  };
  const cmp = (): Node => {
    const a = add();
    const t = peek();
    if (t.t === "op" && ["==", "!=", ">", ">=", "<", "<="].includes(t.v)) { p++; return { k: "bin", op: t.v, a, b: add() }; }
    if (t.t === "id" && t.v === "in") { p++; return { k: "bin", op: "in", a, b: add() }; }
    return a;
  };
  const not = (): Node => (isOp("!") ? (p++, { k: "not", e: not() }) : cmp());
  const and = (): Node => { let a = not(); while (isOp("&&")) { p++; a = { k: "bin", op: "&&", a, b: not() }; } return a; };
  const or = (): Node => { let a = and(); while (isOp("||")) { p++; a = { k: "bin", op: "||", a, b: and() }; } return a; };

  const node = or();
  if (peek().t !== "end") throw new PredicateError(`unexpected trailing input in: ${src}`);
  return node;
}

/** Paths a predicate reads (for static validation). */
export function predicatePaths(n: Node): string[] {
  switch (n.k) {
    case "path": return [n.p];
    case "not": return predicatePaths(n.e);
    case "bin": return [...predicatePaths(n.a), ...predicatePaths(n.b)];
    case "call": return n.args.flatMap(predicatePaths);
    case "list": return n.items.flatMap(predicatePaths);
    default: return [];
  }
}

function truthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== "" && v !== 0;
}

function asTime(v: unknown): number | null {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return toDate(v)?.getTime() ?? null;
  return null;
}

function eq(a: unknown, b: unknown): boolean {
  if ((a === undefined || a === null) && (b === undefined || b === null)) return true;
  if (a === undefined || a === null || b === undefined || b === null) return false;
  if (Array.isArray(a) && !Array.isArray(b)) return a.some((x) => eq(x, b));
  const ta = asTime(a), tb = asTime(b);
  if (ta !== null && tb !== null && (a instanceof Date || b instanceof Date)) return ta === tb;
  if (typeof a === "boolean" || typeof b === "boolean") return String(a) === String(b);
  return String(a) === String(b);
}

function compare(a: unknown, b: unknown): number | null {
  if (a === undefined || a === null || b === undefined || b === null) return null;
  if (a instanceof Date || b instanceof Date) {
    const ta = a instanceof Date ? a.getTime() : toDate(a)?.getTime();
    const tb = b instanceof Date ? b.getTime() : toDate(b)?.getTime();
    return ta === undefined || tb === undefined ? null : ta - tb;
  }
  const na = Number(a), nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && a !== "" && b !== "") return na - nb;
  const ta = asTime(a), tb = asTime(b);
  if (ta !== null && tb !== null) return ta - tb;
  return String(a).localeCompare(String(b));
}

function evalNode(n: Node, ctx: TemplateCtx): unknown {
  switch (n.k) {
    case "lit": return n.v;
    case "path": return pathValue(ctx, n.p);
    case "now": return ctx.now instanceof Date ? ctx.now : typeof ctx.now === "string" ? new Date(ctx.now) : new Date();
    case "not": return !truthy(evalNode(n.e, ctx));
    case "list": return n.items.map((i) => evalNode(i, ctx));
    case "call": {
      const args = n.args.map((a) => evalNode(a, ctx));
      if (n.f === "len") { const x = args[0]; return Array.isArray(x) ? x.length : typeof x === "string" ? x.length : x === undefined || x === null ? 0 : 1; }
      if (n.f === "lower") return typeof args[0] === "string" ? args[0].toLowerCase() : args[0];
      if (n.f === "startsWith") return typeof args[0] === "string" && typeof args[1] === "string" && args[0].startsWith(args[1]);
      const [hay, needle] = args;
      if (Array.isArray(hay)) return hay.some((h) => eq(h, needle));
      if (typeof hay === "string") return needle !== undefined && needle !== null && hay.toLowerCase().includes(String(needle).toLowerCase());
      return false;
    }
    case "bin": {
      if (n.op === "&&") return truthy(evalNode(n.a, ctx)) && truthy(evalNode(n.b, ctx));
      if (n.op === "||") return truthy(evalNode(n.a, ctx)) || truthy(evalNode(n.b, ctx));
      const a = evalNode(n.a, ctx), b = evalNode(n.b, ctx);
      const dur = (x: unknown) => (x && typeof x === "object" && "durationMs" in x ? (x as { durationMs: number }).durationMs : null);
      if (n.op === "+" || n.op === "-") {
        const sign = n.op === "+" ? 1 : -1;
        const db = dur(b);
        if (db !== null) {
          const d = a instanceof Date ? a : toDate(a);
          return d ? new Date(d.getTime() + sign * db) : null;
        }
        return Number(a) + sign * Number(b);
      }
      const nb = dur(b);
      const bb = nb !== null ? nb : b;
      switch (n.op) {
        case "==": return eq(a, bb);
        case "!=": return !eq(a, bb);
        case "in": return Array.isArray(bb) ? bb.some((x) => eq(a, x)) : typeof bb === "string" && typeof a === "string" ? bb.includes(a) : false;
        default: {
          const c = compare(a, bb);
          if (c === null) return false;
          return n.op === ">" ? c > 0 : n.op === ">=" ? c >= 0 : n.op === "<" ? c < 0 : c <= 0;
        }
      }
    }
  }
}

const cache = new Map<string, Node>();

export function evalPredicate(src: string, ctx: TemplateCtx): boolean {
  let node = cache.get(src);
  if (!node) { node = parsePredicate(src); cache.set(src, node); }
  return truthy(evalNode(node, ctx));
}
