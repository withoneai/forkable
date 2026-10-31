// Chunker (SPEC 7.1 "chunk"): header + text, sha256 per chunk. Bump CHUNKER_VERSION
// (ENGINE_VERSIONS.chunker) when output changes.

import type { NormalizedItem, NormalizeEnv, RawRecord, SearchProfile } from "../contract.js";
import { evalString } from "../expr/field.js";
import { resolvePath } from "../expr/path.js";
import { renderTemplate, CTX_ROOTS } from "../expr/template.js";
import { sha256 } from "../profile/hash.js";
import { templateCtx } from "./normalize.js";
import { tokenizePath } from "../expr/path.js";

export interface ChunkDraft { ord: number; text: string; textHash: string; tokens: number }

/** Rough token count: about 4 characters a token. */
export function estimateTokens(s: string): number {
  return Math.max(1, Math.ceil(s.length / 4));
}

function splitLong(text: string, maxTokens: number, overlapTokens: number): string[] {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return [text];
  const paras = text.split(/\n{2,}/).flatMap((p) => (p.length <= maxChars ? [p] : p.split(/(?<=[.!?])\s+/)));
  const out: string[] = [];
  let cur = "";
  const overlap = overlapTokens * 4;
  for (const p of paras) {
    const piece = p.length > maxChars ? p.match(new RegExp(`[\\s\\S]{1,${maxChars}}`, "g")) ?? [p] : [p];
    for (const q of piece) {
      if (cur && cur.length + q.length + 2 > maxChars) {
        out.push(cur.trim());
        cur = overlap > 0 ? cur.slice(-overlap) : "";
        const sp = cur.indexOf(" ");
        if (sp > 0) cur = cur.slice(sp + 1);
      }
      cur += (cur ? "\n\n" : "") + q;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function headingSplit(text: string): string[] {
  const lines = text.split("\n");
  const sections: string[] = [];
  let cur: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!.trim();
    const next = lines[i + 1]?.trim() ?? "";
    const looksHeading = l.length > 0 && l.length <= 80 && !/[.,;:!?]$/.test(l) && next.length > 0 && cur.length > 0 && (i === 0 || lines[i - 1]!.trim() === "");
    if (looksHeading) { sections.push(cur.join("\n")); cur = []; }
    cur.push(lines[i]!);
  }
  if (cur.length) sections.push(cur.join("\n"));
  return sections.filter((s) => s.trim());
}

const ROOTS = new Set<string>(CTX_ROOTS);

export function chunkItem(item: NormalizedItem, profile: SearchProfile, raw: RawRecord, env: NormalizeEnv): ChunkDraft[] {
  const spec = profile.chunk ?? { strategy: "paragraph" as const };
  const maxTokens = spec.maxTokens ?? 400;
  const overlapTokens = spec.overlapTokens ?? 50;
  const doc = { title: item.title, container: item.container, status: item.status, labels: item.labels, occurredAt: item.occurredAt, facets: item.facets, externalId: item.externalId };
  const base = templateCtx(raw, env, { doc });
  const header = (unit?: unknown) => renderTemplate(spec.header ?? "{{ doc.title }}", unit === undefined ? base : { ...base, unit }) ?? item.title;

  const texts: { header: string; text: string }[] = [];
  if (spec.strategy === "message" && spec.unit) {
    for (const unit of resolvePath(base, spec.unit)) {
      const ub = spec.unitBody;
      let text: string | null = null;
      if (ub !== undefined) {
        const first = typeof ub === "string" ? ub : "path" in ub ? ub.path : null;
        const t0 = first ? tokenizePath(first)[0] : undefined;
        const rooted = t0?.type === "field" && ROOTS.has(t0.name);
        text = evalString(ub, { ...base, unit }, rooted ? undefined : unit);
      } else text = typeof unit === "string" ? unit : null;
      if (text && text.trim()) for (const piece of splitLong(text.trim(), maxTokens, overlapTokens)) texts.push({ header: header(unit), text: piece });
    }
  }
  if (texts.length === 0) {
    const body = item.body.trim();
    const parts = !body ? [] : spec.strategy === "whole" ? splitLong(body, maxTokens, overlapTokens) : spec.strategy === "heading" ? headingSplit(body).flatMap((s) => splitLong(s, maxTokens, overlapTokens)) : splitLong(body, maxTokens, overlapTokens);
    const h = header();
    for (const p of parts) texts.push({ header: h, text: p });
  }
  if (texts.length === 0) {
    const t = [item.snippet && item.snippet !== item.title ? item.snippet : ""].filter(Boolean).join("\n");
    texts.push({ header: header(), text: t });
  }
  return texts.map((t, ord) => {
    const text = t.text ? `${t.header}\n${t.text}` : t.header;
    return { ord, text, textHash: sha256(text), tokens: estimateTokens(text) };
  });
}
