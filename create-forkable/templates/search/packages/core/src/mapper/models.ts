// Models before mapping (SPEC 10.2): the platform's read actions grouped by the
// thing they list, so the user picks Contacts, Deals and Notes first and only
// those go to the dry run and the proposal. One's catalog has a modelName per
// action (/v1/available-actions), but a Connect token cannot read that route and
// /knowledge does not carry it (checked 2026-10-29), so the model comes from the
// action itself: One's modelName when present, else the title, else the path.

import type { CatalogAction, CatalogModel, ItemKind } from "../contract.js";
import { classifyAction } from "./catalog.js";

const VERSION = /^(v\d+(\.\d+)?|\d{4}-\d{2}(-\d{2})?|api|rest|latest)$/i;
const TEMPLATE = /\{\{?\s*([\w.-]+)\s*\}?\}/g;
const LEAD_VERB = /^(list|retrieve|search|get|fetch|query|read|find|export|incremental|browse|show|lookup)\b\s*(all|many|every|a page of|recent|the)?\s*/i;
const SINGLE = /^(retrieve|get|fetch|read|show|lookup|find)\s+(a|an|the|one|single|specific)\b|\bby\s+(its\s+)?id\b|\bdetails?\b$/i;
const GENERIC = /^(crm\s+)?(objects?|records?|items?|entities|resources?|data|results?|all|by\s+.*|v\d.*)?$/i;
const NOISE = /\b(crm|export|incremental|time-based|cursor-based|paginated|paged|list|api)\b/gi;

export const MAX_PICKS = 8;
const PER_MODEL = 3;

const UNCOUNTED = /(people|data|media|news|information|staff|series|analytics|software|feedback)$/i;
const singular = (w: string) => UNCOUNTED.test(w) ? w : w.replace(/ies$/i, "y").replace(/(ss|us|is)$/i, "$1").replace(/(x|ch|sh|ss)es$/i, "$1").replace(/s$/i, "");
const plural = (w: string) => UNCOUNTED.test(w) || /(s|x|ch|sh)$/i.test(w) ? w : /[^aeiou]y$/i.test(w) ? `${w.slice(0, -1)}ies` : `${w}s`;
const words = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

/** The model's key: lowercase words, the last one singular, joined with _. */
export function modelKey(label: string): string {
  const w = words(label).toLowerCase().split(" ").filter(Boolean);
  if (!w.length) return "";
  w[w.length - 1] = singular(w[w.length - 1]!);
  return w.join("_");
}

/** "deal" -> "Deals", "goal_target" -> "Goal targets". */
export function modelLabel(key: string): string {
  const w = key.split("_");
  w[w.length - 1] = plural(w[w.length - 1]!);
  const s = w.join(" ");
  return s[0]!.toUpperCase() + s.slice(1);
}

/** The noun a title lists: "List CRM Objects (Deals) by Object Type" -> "Deals". */
export function nounFromTitle(title: string, platformName = ""): string | null {
  const plat = platformName ? new RegExp(`\\b${platformName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi") : null;
  const clean = (s: string) => {
    let x = s.replace(LEAD_VERB, "").replace(/^(and\s+)?(view|show|list|all)\s+/i, "").replace(/\s+(by|for|in|from|of|with|using)\s+.*$/i, "");
    if (plat) x = x.replace(plat, "");
    return x.replace(NOISE, "").replace(/\s+/g, " ").trim();
  };
  const main = clean(title.replace(/\([^)]*\)/g, " "));
  if (main && !GENERIC.test(main)) return main;
  for (const m of title.matchAll(/\(([^)]*)\)/g)) {
    const inner = clean(m[1]!.replace(/^read a page of\s+/i, "").replace(/^list\s+/i, ""));
    if (inner && !GENERIC.test(inner) && !/^(by|v\d|\d)/i.test(inner)) return inner;
  }
  return null;
}

/** The last literal path segment that names something: "/crm/v3/objects/contacts/search" -> "contacts". */
export function nounFromPath(path: string): string | null {
  const segs = path.split("?")[0]!.split("/").filter(Boolean);
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i]!;
    if (TEMPLATE.test(s)) { TEMPLATE.lastIndex = 0; return null; }
    TEMPLATE.lastIndex = 0;
    if (VERSION.test(s) || /^(search|query|list|all|recent|export|incremental|cursor|feed)$/i.test(s)) continue;
    const t = s.replace(/^(get|list|search|fetch|retrieve)-(all-)?/i, "").replace(/\.json$/i, "");
    return t && !GENERIC.test(words(t)) ? words(t) : null;
  }
  return null;
}

const KINDS: [RegExp, ItemKind][] = [
  [/\b(contact|person|people|user|member|lead|customer|candidate|subscriber|employee)\b/, "person"],
  [/\b(compan(y|ie)|organi[sz]ation|account|business)\b/, "company"],
  [/\b(deal|opportunit(y|ie))\b/, "deal"],
  [/\b(transcript|recording|meeting note)\b/, "meeting_note"],
  [/\b(meeting|appointment|event|booking)\b/, "event"],
  [/\b(email|mail|thread)\b/, "email_thread"],
  [/\b(message|chat|conversation|communication|comment|call)\b/, "message"],
  [/\b(task|todo|issue|ticket|story|bug)\b/, "task"],
  [/\b(note)\b/, "note"],
  [/\b(doc|document|page|post|article|file|wiki|block|knowledge)\b/, "doc"],
];
// records a person still looks up by name
const WORTH = /^(invoice|charge|payment|subscription|order|product|quote|refund|dispute|project|issue|cycle|contract|listing)$/;
const KIND_ORDER: ItemKind[] = ["person", "company", "deal", "email_thread", "message", "meeting_note", "event", "task", "note", "doc", "record"];

// account plumbing, not something a person searches for
const CONFIG = /(definition|type|setting|statistic|histogram|folder|template|preference|role|team|currenc|activit|channel|sequence|scheduling|limit|propert|schema|pipeline|stage|webhook|subscription|campaign|occurrence|link|login|audit|import|export|log|metric|report|usage|quota|token|key|integration|app|extension|association|label|permission|config)/i;

/** The kind of the model's head noun (the last word), so "Account login activities" stays a record. */
export function kindFor(key: string, path = ""): ItemKind {
  if (CONFIG.test(key) || /\/(settings|account-info|automation|integrations|webhooks|developer)\//i.test(path)) return "record";
  const head = key.split("_").pop() ?? key;
  for (const [re, k] of KINDS) if (re.test(head) || re.test(plural(head))) return k;
  return "record";
}

type Raw = CatalogAction & { modelName?: string };

/** Lists the action can run on its own, with the path values it needs filled from the model when the title names it. */
function listable(a: Raw, key: string, fromTitle: boolean): { ok: boolean; pathVars?: Record<string, string>; rank: number } {
  const { readOnly } = classifyAction(a);
  const medleyRead = /^\/v\d+\/[^/]+\/(get|list|search|fetch|retrieve)-/i.test(a.path);
  if (!(readOnly || medleyRead) || SINGLE.test(a.title)) return { ok: false, rank: 9 };
  // counts, autocompletes, "me" and by-ids lookups are reads that list nothing
  if (/^(count|autocomplete|preview|show many)\b|\bmultiple\b/i.test(a.title) || /\/(count|autocomplete|me|show_many|preview|histogram|statistics?)\/?$/i.test(a.path.split("?")[0]!)) return { ok: false, rank: 9 };
  const vars = [...a.path.matchAll(TEMPLATE)].map((m) => m[1]!);
  let pathVars: Record<string, string> | undefined;
  if (vars.length) {
    // one type variable the title already answers: HubSpot's /crm/objects/{{objectType}} lists Deals
    if (vars.length === 1 && /^(object_?type|objecttype|type|entity_?type|model)$/i.test(vars[0]!) && fromTitle && !/\{\{?\s*[\w.-]+\s*\}?\}\/[^/]*\{\{/.test(a.path)) {
      pathVars = { [vars[0]!]: plural(key) };
    } else return { ok: false, rank: 9 };
  }
  const t = a.title;
  const rank = /incremental|export|changes|sync/i.test(t) ? 0 : /^(list|get all|get many|retrieve all)\b/i.test(t) || a.method.toUpperCase() === "GET" ? 1 : /^(search|query)\b/i.test(t) ? 2 : 3;
  return { ok: true, ...(pathVars ? { pathVars } : {}), rank };
}

/** Groups a platform's actions into models. Writes and single-record reads are counted, never listed. */
export function groupModels(actions: Raw[], o: { platformName?: string; builtin?: Map<string, string> } = {}): { models: CatalogModel[]; hidden: number } {
  const by = new Map<string, { key: string; actions: (CatalogAction & { rank: number })[] }>();
  let hidden = 0;
  for (const a of actions) {
    const fromOne = a.modelName ? words(a.modelName) : null;
    const titleNoun = nounFromTitle(a.title, o.platformName);
    const noun = fromOne ?? titleNoun ?? nounFromPath(a.path);
    const key = noun ? modelKey(noun) : "";
    const l = key ? listable(a, key, !!(fromOne || titleNoun)) : { ok: false, rank: 9 };
    if (!key || !l.ok) { hidden++; continue; }
    const g = by.get(key) ?? { key, actions: [] };
    const { modelName: _m, ...rest } = a;
    void _m;
    g.actions.push({ ...rest, model: key, ...(l.pathVars ? { pathVars: l.pathVars } : {}), rank: l.rank });
    by.set(key, g);
  }
  const models: CatalogModel[] = [...by.values()].map((g) => {
    const acts = g.actions.sort((x, y) => x.rank - y.rank || x.path.length - y.path.length);
    const kind = kindFor(g.key, acts[0]?.path);
    const builtinProfile = o.builtin?.get(g.key) ?? acts.map((a) => o.builtin?.get(`action:${a.actionId}:${JSON.stringify(a.pathVars ?? {})}`)).find(Boolean) ?? null;
    return {
      key: g.key, label: modelLabel(g.key), kind,
      actions: acts.slice(0, PER_MODEL).map(({ rank: _r, ...a }) => { void _r; return a; }),
      more: Math.max(0, acts.length - PER_MODEL),
      permitted: acts.some((a) => a.permitted),
      suggested: (kind !== "record" || WORTH.test(g.key.split("_").pop() ?? "")) && !/^(deleted|suspended|archived|trashed)_/.test(g.key) && !builtinProfile,
      builtinProfile,
    };
  });
  models.sort((a, b) => Number(b.suggested) - Number(a.suggested) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.key.split("_").length - b.key.split("_").length || a.label.localeCompare(b.label));
  return { models, hidden };
}
