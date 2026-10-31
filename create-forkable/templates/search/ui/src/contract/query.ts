// The query grammar (SPEC 9.3). parseQuery, formatQuery and applyChip come
// from @search/core (query/parse.ts, browser-safe), so the chips read the box
// exactly the way the server does. Below them, small UI helpers.
// The UI chips are a view over ParsedQuery and every chip edit goes back
// through applyChip, so the box is the only state.
export { parseQuery, formatQuery, applyChip, OPERATOR_KEYS } from "@search/core/query/parse";
import type { OperatorKey, ParsedQuery, QueryClause } from "./api-types";

const DAY = 86_400_000;
function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

/** Relative date words and N-units-ago to an absolute window. */
export function resolveDate(v: string, now = new Date()): { from: string; to: string } | null {
  const today = startOfDay(now);
  const iso = (d: Date) => d.toISOString();
  const span = (from: Date, to: Date) => ({ from: iso(from), to: iso(to) });
  if (v === "today") return span(today, new Date(today.getTime() + DAY));
  if (v === "yesterday") return span(new Date(today.getTime() - DAY), today);
  if (v === "tomorrow") return span(new Date(today.getTime() + DAY), new Date(today.getTime() + 2 * DAY));
  const dow = (today.getDay() + 6) % 7;
  const monday = new Date(today.getTime() - dow * DAY);
  if (v === "this-week") return span(monday, new Date(monday.getTime() + 7 * DAY));
  if (v === "last-week") return span(new Date(monday.getTime() - 7 * DAY), monday);
  if (v === "this-month") return span(new Date(today.getFullYear(), today.getMonth(), 1), new Date(today.getFullYear(), today.getMonth() + 1, 1));
  if (v === "last-month") return span(new Date(today.getFullYear(), today.getMonth() - 1, 1), new Date(today.getFullYear(), today.getMonth(), 1));
  const rel = /^(\d+)([dwmy])$/.exec(v);
  if (rel) {
    const n = Number(rel[1]);
    const unit = { d: DAY, w: 7 * DAY, m: 30 * DAY, y: 365 * DAY }[rel[2] as "d" | "w" | "m" | "y"];
    return span(new Date(now.getTime() - n * unit), now);
  }
  const ymd = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(v);
  if (ymd) {
    const y = Number(ymd[1]), mo = Number(ymd[2]) - 1;
    if (ymd[3]) { const d = new Date(y, mo, Number(ymd[3])); return span(d, new Date(d.getTime() + DAY)); }
    return span(new Date(y, mo, 1), new Date(y, mo + 1, 1));
  }
  return null;
}

function clauseText(c: QueryClause): string {
  if (c.kind === "or") return "OR";
  if (c.kind === "op") return c.raw;
  const v = c.kind === "phrase" ? `"${c.value}"` : c.value;
  return `${c.negate ? "-" : ""}${v}`;
}


/** Values of one operator as plain strings (the chip's view). */
export function opValues(q: ParsedQuery, key: OperatorKey, negate = false): string[] {
  const out: string[] = [];
  for (const c of q.clauses) {
    if (c.kind !== "op" || c.key !== key || c.negate !== negate) continue;
    for (const v of c.values) out.push(v.t === "range" ? `${v.from}..${v.to}` : v.t === "cmp" ? `${v.op}${v.v}` : v.v);
  }
  return out;
}

/** The free text only, without operators: what the keyword engine matches. */
export function freeText(q: ParsedQuery): string {
  return q.clauses.filter((c) => c.kind === "word" || c.kind === "phrase").map((c) => clauseText(c)).join(" ");
}

/** Whether a query reads like a question (SPEC 14, answer strip). */
export function isQuestion(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.length < 6) return false;
  return t.endsWith("?") || /^(who|what|when|where|why|how|did|does|do|is|are|which|can)\b/.test(t);
}

/** The half-typed operator at the caret, for completions: "from:pri" -> { key: "from", partial: "pri" }. */
export function partialOperator(text: string, caret = text.length): { key: string; partial: string; start: number } | null {
  const before = text.slice(0, caret);
  const m = /(^|\s)(-?)([a-z]+):("?[^\s"]*)$/i.exec(before);
  if (m) return { key: m[3]!.toLowerCase(), partial: m[4]!.replace(/^"/, ""), start: before.length - m[0].length + m[1]!.length };
  return null;
}
