// The query operator grammar (SPEC 9.3). Browser-safe. parseQuery <-> formatQuery, applyChip.

import type { ChipEdit, OpValue, OperatorKey, ParsedQuery, QueryClause } from "../api-types.js";
import { resolveDateValue } from "./dates.js";

export const OPERATOR_KEYS: OperatorKey[] = ["source", "account", "type", "is", "from", "to", "with", "about", "before", "after", "on", "updated", "during", "has", "status", "stage", "lane", "label", "container", "amount", "id"];
const ALIASES: Record<string, OperatorKey> = { in: "source" };
export const DATE_KEYS = new Set<OperatorKey>(["before", "after", "on", "updated", "during"]);
export const IS_VALUES = ["unread", "vip", "needs-you", "waiting", "mine", "open", "upcoming", "past"];
export const HAS_VALUES = ["attachment", "link", "joinurl", "transcript"];
export const LANE_VALUES = ["vip", "needs-you", "needs_you", "waiting", "fyi", "low"];

/** type: aliases -> item kinds. */
export const TYPE_ALIASES: Record<string, string[]> = {
  mail: ["email_thread"], email: ["email_thread"], thread: ["email_thread"], email_thread: ["email_thread"],
  event: ["event"], events: ["event"], meeting: ["meeting_note", "event"], meetings: ["meeting_note", "event"], meeting_note: ["meeting_note"],
  person: ["person"], people: ["person"], contact: ["person"], company: ["company"], companies: ["company"],
  doc: ["doc"], docs: ["doc"], page: ["doc"], issue: ["task"], issues: ["task"], task: ["task"], tasks: ["task"],
  message: ["message"], messages: ["message"], chat: ["message"], note: ["note"], notes: ["note"], deal: ["deal"], deals: ["deal"], record: ["record"],
};

interface RawTok { text: string; start: number }

function lex(input: string): RawTok[] {
  const out: RawTok[] = [];
  let i = 0;
  while (i < input.length) {
    while (i < input.length && /\s/.test(input[i]!)) i++;
    if (i >= input.length) break;
    const start = i;
    let q = false;
    let s = "";
    while (i < input.length && (q || !/\s/.test(input[i]!))) {
      if (input[i] === '"') q = !q;
      s += input[i];
      i++;
    }
    out.push({ text: s, start });
  }
  return out;
}

function unq(s: string): string { return s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s.replace(/^"/, ""); }

function splitList(s: string): string[] {
  const out: string[] = [];
  let q = false, cur = "";
  for (const ch of s) {
    if (ch === '"') { q = !q; cur += ch; continue; }
    if (ch === "," && !q) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

function parseValue(key: OperatorKey, raw: string, now: Date, errs: (m: string) => void): OpValue {
  const v = unq(raw);
  const cmp = /^(>=|<=|>|<)(.+)$/.exec(v);
  if (cmp) {
    const op = cmp[1] as ">" | ">=" | "<" | "<=";
    const val = cmp[2]!;
    if (DATE_KEYS.has(key)) {
      const d = resolveDateValue(val, now);
      if (!d) errs(`${key}: "${val}" is not a date`);
      return { t: "cmp", op, v: val, resolved: d ? (op === ">" || op === ">=" ? d.from : d.from) : undefined };
    }
    const n = Number(val.replace(/[,_$]/g, ""));
    return { t: "cmp", op, v: Number.isFinite(n) ? n : val };
  }
  if (DATE_KEYS.has(key)) {
    const range = /^(.+)\.\.(.+)$/.exec(v);
    if (range) {
      const a = resolveDateValue(range[1]!, now), b = resolveDateValue(range[2]!, now);
      if (!a || !b) errs(`${key}: bad range "${v}"`);
      return { t: "range", from: a?.from ?? "", to: b?.to ?? "" };
    }
    const d = resolveDateValue(v, now);
    if (!d) { errs(`${key}: "${v}" is not a date`); return { t: "text", v }; }
    return { t: "date", v, resolved: d };
  }
  if (key === "amount") {
    const n = Number(v.replace(/[,_$]/g, ""));
    if (Number.isFinite(n)) return { t: "cmp", op: ">=", v: n };
  }
  return { t: "text", v };
}

export function parseQuery(text: string, now: Date = new Date()): ParsedQuery {
  const clauses: QueryClause[] = [];
  const errors: ParsedQuery["errors"] = [];
  const free: string[] = [];
  for (const tok of lex(text)) {
    let t = tok.text;
    if (t === "OR") { clauses.push({ kind: "or" }); free.push("OR"); continue; }
    let negate = false;
    if (t.startsWith("-") && t.length > 1) { negate = true; t = t.slice(1); }
    const m = /^([a-z]+):(.+)$/i.exec(t);
    const key = m ? (ALIASES[m[1]!.toLowerCase()] ?? (OPERATOR_KEYS.includes(m[1]!.toLowerCase() as OperatorKey) ? (m[1]!.toLowerCase() as OperatorKey) : null)) : null;
    if (m && key) {
      const errs = (msg: string) => errors.push({ at: tok.start, message: msg });
      const values = splitList(m[2]!).map((v) => parseValue(key, v, now, errs));
      if (key === "is") for (const v of values) if (v.t === "text" && !IS_VALUES.includes(v.v.toLowerCase())) errs(`is: unknown value "${v.v}"`);
      if (key === "type") for (const v of values) if (v.t === "text" && !TYPE_ALIASES[v.v.toLowerCase()]) errs(`type: unknown type "${v.v}"`);
      if (key === "has") for (const v of values) if (v.t === "text" && !HAS_VALUES.includes(v.v.toLowerCase())) errs(`has: unknown value "${v.v}"`);
      clauses.push({ kind: "op", key, values, negate, raw: tok.text });
      continue;
    }
    if (t.startsWith('"')) {
      const v = unq(t);
      if (v) { clauses.push({ kind: "phrase", value: v, negate }); free.push(tok.text); }
      continue;
    }
    if (t) { clauses.push({ kind: "word", value: t, negate }); free.push(tok.text); }
  }
  return { text: free.join(" ").replace(/^OR\s+|\s+OR$/g, "").trim(), clauses, errors };
}

function fmtValue(v: string): string {
  return /[\s,]/.test(v) ? `"${v.replace(/"/g, "")}"` : v;
}

export function formatQuery(q: ParsedQuery): string {
  const parts: string[] = [];
  for (const c of q.clauses) {
    if (c.kind === "or") parts.push("OR");
    else if (c.kind === "word") parts.push(`${c.negate ? "-" : ""}${c.value}`);
    else if (c.kind === "phrase") parts.push(`${c.negate ? "-" : ""}"${c.value}"`);
    else parts.push(c.raw);
  }
  return parts.join(" ").trim();
}

/** Two-way chip binding: replace (or remove, when values is null) every clause with this key. */
export function applyChip(text: string, chip: ChipEdit): string {
  const q = parseQuery(text);
  const keep = q.clauses.filter((c) => !(c.kind === "op" && c.key === chip.key && (chip.negate === undefined || c.negate === !!chip.negate)));
  if (chip.values && chip.values.length) {
    const raw = `${chip.negate ? "-" : ""}${chip.key}:${chip.values.map(fmtValue).join(",")}`;
    const parsed = parseQuery(raw).clauses[0];
    if (parsed) keep.push(parsed);
  }
  return formatQuery({ ...q, clauses: keep });
}

/** Text values of an operator (positive or negated). */
export function opValues(q: ParsedQuery, key: OperatorKey, negate = false): OpValue[] {
  return q.clauses.flatMap((c) => (c.kind === "op" && c.key === key && c.negate === negate ? c.values : []));
}
