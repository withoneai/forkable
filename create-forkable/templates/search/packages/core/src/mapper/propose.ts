// The LLM proposal (SPEC 10.3, D24): Claude Haiku through One on the grant reads the
// candidates' docs, ioSchema, trimmed samples and the inference hints, and writes
// complete profiles. Up to 2 repair rounds send the static validation errors
// back. On the user's computer the local Claude Code or Codex writes it instead
// (local-agent.ts), so the grant needs no Anthropic. No model, or no usable answer:
// the rules proposal.
// Sample users replay fixtures/sample/proposals/<platform>.<model>.json.

import type { CatalogPlatform, InferenceHints, ItemKind, ProposalInput, ProposalOutput, SearchProfile, ValidationIssue } from "../contract.js";
import { FACETS_BY_KIND, ITEM_KINDS } from "../contract.js";
import type { CallCtx } from "../ctx.js";
import { BlockedByGrant, NotConnected } from "../errors.js";
import { localEngine, runLocal } from "../local-agent.js";
import { getSettings } from "../settings.js";
import { one } from "../one.js";
import { validateProfile } from "../profile/validate.js";
import { DECODERS } from "../profile/schema.js";
import { profileFromHints } from "./infer.js";

export const ANTHROPIC_MESSAGES = { platform: "anthropic", actionId: "conn_mod_def::GJfJ6hmtpYo::zy68VQHpRFmqayjAzxkjDA", method: "POST" as const, path: "/messages" };

export const SYSTEM_PROMPT = [
  "You map one platform's list actions into Search profiles. Output JSON only, matching the ProposalOutput schema you are given. Rules:",
  "- Use only action ids from the candidates. Never invent ids, paths or fields.",
  "- Every path must exist in the sample responses (path grammar: a.b, a[0], a[-1], a[], a[name=X]). Field paths start with item.",
  "- Pick kind from: person, company, email_thread, event, doc, task, message, meeting_note, deal, note, record.",
  "- title, occurredAt and idPath are required. Prefer a URL the API returns over a template.",
  "- occurredAt is when the thing happened: for docs and files the last change (modifiedTime, updated) before the creation time; for records the creation time. Never the time of the sync. If the sample has no date, add the API's own field selector to list.query (Google: fields=nextPageToken,files(id,name,modifiedTime,createdTime,...)) so one comes back.",
  "- Incremental: prefer a provider filter on an updated time; else 'full'.",
  "- Say for each field why you chose it, in under 12 words.",
  "- The user already picked the models. Each candidate names its model; return exactly one profile per model, using that model's best candidate. Set recommended true and say in one short sentence what the user will find.",
  "- A candidate with pathVars runs with those path values; copy them into list.pathVars.",
  "- Read-only. Never choose an action that creates, updates, sends or deletes.",
  "- Facet keys must be the kind's own facets or start with x_.",
  'Answer shape: {"models": [{"recommended": true, "reason": "...", "profile": <a complete profile>, "fieldNotes": [{"target": "fields.title", "path": "item.subject", "confidence": 0.9, "reason": "..."}], "questions": []}], "notes": "..."}.',
  "Each profile has exactly the keys and format of the exampleProfile in the input (a rules draft for the first candidate); improve its choices, keep its shape.",
].join("\n");

export const GRAMMAR = "Paths: a.b, a.0, a[0], a[-1], a[], a[name=From], quoted keys a[\"@odata.nextLink\"]. Templates: {{ expr | filter:arg }} with filters iso, unix, unixms, date:\"yyyy-MM-dd\", lower, upper, email, domain, urlencode, json, join:\",\", first, last, default:\"x\". Roots: item, detail, run, account, settings. Expr: a path string, { path, pick, decode }, { template }, { coalesce: [] }, { join: [], sep }, { test }.";

export interface Candidate { actionId: string; title: string; method: string; path: string; model?: string; pathVars?: Record<string, string>; knowledge: string; ioSchema?: unknown; sample: unknown; hints: InferenceHints }

/** The input schema as name -> "type: description" per location, which is what the map needs (filters, paging); the sample carries the output shape. */
export function compactSchema(io: unknown): Record<string, Record<string, string>> | undefined {
  const root = (io as { inputSchema?: { properties?: Record<string, { properties?: Record<string, { type?: unknown; description?: string; enum?: unknown[] }> }> } } | undefined)?.inputSchema?.properties;
  if (!root) return undefined;
  const out: Record<string, Record<string, string>> = {};
  for (const [where, node] of Object.entries(root)) {
    const props = node?.properties;
    if (!props) continue;
    const m: Record<string, string> = {};
    for (const [name, p] of Object.entries(props)) {
      if (name === "connectionKey") continue;
      const t = Array.isArray(p.enum) ? `enum ${p.enum.slice(0, 6).join("|")}` : String(p.type ?? "any");
      m[name] = `${t}${p.description ? `: ${p.description.slice(0, 100)}` : ""}`;
    }
    if (Object.keys(m).length) out[where] = m;
  }
  return Object.keys(out).length ? out : undefined;
}

export function proposalInput(platform: CatalogPlatform, cands: Candidate[], previousErrors?: ValidationIssue[]): ProposalInput {
  return {
    platform,
    candidates: cands.map((c) => ({ actionId: c.actionId, title: c.title, method: c.method, path: c.path, ...(c.model ? { model: c.model } : {}), ...(c.pathVars ? { pathVars: c.pathVars } : {}), knowledgeExcerpt: c.knowledge.slice(0, 2500), ioSchema: compactSchema(c.ioSchema), sample: c.sample, inference: c.hints })),
    vocabulary: { kinds: ITEM_KINDS as ItemKind[], fields: ["title", "body", "snippet", "occurredAt", "updatedAt", "url", "container", "groupKey", "status", "labels", "facets"], facetsByKind: FACETS_BY_KIND, decoders: [...DECODERS], filters: ["iso", "unix", "unixms", "date", "lower", "upper", "email", "domain", "urlencode", "json", "join", "first", "last", "default"] },
    grammar: GRAMMAR,
    ...(previousErrors?.length ? { previousErrors } : {}),
  };
}

/** The rules proposal: one model per candidate that answered, the first recommended. */
export function rulesProposal(platform: string, cands: Candidate[], o: { userId?: string; sampleOnly?: boolean } = {}): ProposalOutput {
  const seen = new Set<string>();
  const models: ProposalOutput["models"] = [];
  for (const c of cands) {
    if (!c.hints.resultsPath && c.hints.resultsPath !== "") continue;
    const p = profileFromHints({ platform, actionId: c.actionId, title: c.title, method: c.method, path: c.path, hints: c.hints, userId: o.userId, sampleOnly: o.sampleOnly });
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    const notes = [
      { target: "list.idPath", path: p.list.idPath, confidence: c.hints.idPath ? 0.9 : 0.3, reason: c.hints.idPath ? "Unique on every sample" : "No unique id found" },
      ...(c.hints.titleCandidates[0] ? [{ target: "fields.title", path: `item.${c.hints.titleCandidates[0]}`, confidence: 0.6, reason: "Short text on every record" }] : []),
      ...(c.hints.dateCandidates[0] ? [{ target: "fields.occurredAt", path: `item.${c.hints.dateCandidates[0]}`, confidence: 0.6, reason: "First date field, created first" }] : []),
    ];
    models.push({ recommended: models.length === 0, reason: models.length === 0 ? "The broadest list on this platform." : "Another list; on if you want it.", profile: p, fieldNotes: notes, questions: [] });
  }
  return { models, notes: "Suggested by rules." };
}

function extractJson(text: string): unknown {
  // a fenced block, the whole answer, then first { to last }: the first that parses wins
  const tries = [...text.matchAll(/```(?:json)?\s*\n?([\s\S]*?)```/g)].map((m) => m[1]!);
  tries.push(text.trim(), text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  for (const t of tries) { try { return JSON.parse(t); } catch { /* next */ } }
  throw new SyntaxError("no JSON object in the answer");
}

/** Keeps only models whose actions are candidates and whose profiles pass static validation. */
export function checkProposal(out: unknown, cands: Candidate[]): { ok: ProposalOutput; errors: ValidationIssue[] } {
  const ids = new Set(cands.map((c) => c.actionId));
  const o = (out && typeof out === "object" ? out : {}) as Partial<ProposalOutput>;
  const errors: ValidationIssue[] = [];
  const models: ProposalOutput["models"] = [];
  for (const m of Array.isArray(o.models) ? o.models : []) {
    const p = m?.profile as SearchProfile | undefined;
    if (!p || typeof p !== "object") continue;
    p.$schema = "https://search.forkable.dev/schema/profile-1.json";
    if (!ids.has(p.list?.actionId)) { errors.push({ check: "actions", level: "error", message: `${p.list?.actionId ?? "(none)"} is not one of the candidates`, profileId: p.id }); continue; }
    const r = validateProfile(p);
    const errs = r.issues.filter((i) => i.level === "error");
    if (errs.length) { errors.push(...errs.map((e) => ({ ...e, profileId: p.id }))); continue; }
    models.push({ recommended: !!m.recommended, reason: String(m.reason ?? "").slice(0, 140), profile: p, fieldNotes: Array.isArray(m.fieldNotes) ? m.fieldNotes : [], questions: Array.isArray(m.questions) ? m.questions.map(String) : [] });
  }
  return { ok: { models, ...(o.notes ? { notes: String(o.notes) } : {}) }, errors };
}

export interface ProposeResult { output: ProposalOutput; by: string }

/** The local CLI, else Haiku on the grant, with repair rounds; rules when neither answers or nothing usable comes back. */
export async function propose(call: CallCtx, o: { platform: CatalogPlatform; candidates: Candidate[]; model: string; userId: string; hint?: string; fixtureKeys?: string[]; log?: (l: string) => void }): Promise<ProposeResult> {
  const answered = o.candidates.filter((c) => c.hints.resultsPath !== undefined);
  if (call.mode === "fixture") {
    // replay fixtures/sample/proposals/<platform>.<model>.json, one ledger row each
    const models: ProposalOutput["models"] = [];
    for (const key of o.fixtureKeys ?? []) {
      const r = await one.raw(call, { ...ANTHROPIC_MESSAGES, action: "messages", level: "read", summary: `Propose a ${o.platform.name} profile (sample)`, fixtureKey: `proposal:${key}`, body: {} }).catch(() => null);
      const out = r?.ok ? (r.data as ProposalOutput) : null;
      for (const m of out?.models ?? []) if (!models.some((x) => x.profile.id === m.profile.id)) models.push(m);
    }
    if (models.length) return { output: { models }, by: "fixture" };
    return { output: rulesProposal(o.platform.platform, answered, { userId: o.userId, sampleOnly: true }), by: "rules" };
  }
  if (!answered.length) return { output: { models: [] }, by: "rules" };
  let previous: ValidationIssue[] | undefined;
  let best: ProposalOutput | null = null;
  let local = await localEngine(await getSettings(call.db, o.userId));
  const example = rulesProposal(o.platform.platform, answered.slice(0, 1), { userId: o.userId }).models[0]?.profile;
  const by = () => (local ? `${local.id}:${local.proposalModel}` : `anthropic:${o.model}`);
  for (let round = 0; round < 3; round++) {
    const input = { ...proposalInput(o.platform, answered, previous), exampleProfile: example };
    let text = "";
    const user = `${o.hint ? `User hint: ${o.hint}\n\n` : ""}${JSON.stringify(input)}`;
    if (local) {
      try {
        text = await runLocal(call, local, { model: local.proposalModel, system: SYSTEM_PROMPT, user, summary: `Propose a ${o.platform.name} profile` });
      } catch (e) {
        o.log?.(`${local.name} proposal failed, trying Anthropic on the grant: ${(e as Error).message}`);
        local = null;
      }
    }
    if (!local) try {
      const res = await one.call<{ content?: { type: string; text?: string }[] }>(call, {
        ...ANTHROPIC_MESSAGES, action: "messages", level: "read", summary: `Propose a ${o.platform.name} profile`, headers: { "anthropic-version": "2023-06-01" },
        body: { model: o.model, max_tokens: 4000, temperature: 0, system: SYSTEM_PROMPT, messages: [{ role: "user", content: user }] },
      });
      text = (res.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
    } catch (e) {
      if (e instanceof NotConnected || e instanceof BlockedByGrant) { o.log?.("Anthropic is not in your grant, so rules suggest the profile."); break; }
      o.log?.(`proposal failed: ${(e as Error).message}`);
      break;
    }
    try {
      const { ok, errors } = checkProposal(extractJson(text), answered);
      if (ok.models.length && (!best || ok.models.length > best.models.length)) best = ok;
      if (!errors.length && ok.models.length) break;
      previous = errors.length ? errors.slice(0, 20) : [{ check: "schema", level: "error", message: 'No usable models. Answer {"models": [...]} with profiles shaped like exampleProfile.' }];
    } catch {
      previous = [{ check: "schema", level: "error", message: "The answer was not valid JSON. Output JSON only." }];
    }
  }
  if (best?.models.length) {
    if (!best.models.some((m) => m.recommended)) best.models[0]!.recommended = true;
    return { output: best, by: by() };
  }
  if (previous?.length) o.log?.(`proposal unusable after repairs, using rules: ${previous.slice(0, 3).map((e) => e.message).join("; ")}`);
  return { output: rulesProposal(o.platform.platform, answered, { userId: o.userId }), by: "rules" };
}
