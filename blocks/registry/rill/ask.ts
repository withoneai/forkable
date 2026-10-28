import type { MailThreadDetail } from "../gmail/types.js";

// Ask your inbox, lifted from Rill (orez/packages/core/src/ask.ts).
// Retrieval is code: keywords out of the question, matched against subject,
// sender and body. The writer only answers from the evidence it is handed,
// with citations code checks against that evidence.

export interface AskEvidence { threadId: string; subject: string; from: string; date: string; excerpt: string }

const STOP = new Set(
  "a an the and or but if then of to in on at for from by with about into over after before between out up down off as is are was were be been being am do does did doing have has had having i me my mine we our us you your yours he she it its they them their what which who whom whose this that these those when where why how all any both each few more most other some such no nor not only own same so than too very can will just should would could did say said says tell told ask asked email emails mail inbox thread message messages did anything something someone anyone last week month today yesterday recent recently please show find waiting".split(/\s+/),
);

export function keywordsOf(q: string): string[] {
  const words = q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}@.\s-]/gu, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[.-]+|[.-]+$/g, ""))
    .filter((w) => w.length >= 3 && !STOP.has(w));
  return [...new Set(words)].slice(0, 8);
}

export function excerptAround(body: string, keywords: string[], width = 600): string {
  const text = body.replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  let at = -1;
  for (const k of keywords) {
    const i = lower.indexOf(k);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0 || text.length <= width) return text.slice(0, width);
  const start = Math.max(0, at - Math.floor(width / 3));
  return `${start > 0 ? "…" : ""}${text.slice(start, start + width)}${start + width < text.length ? "…" : ""}`;
}

const esc = (k: string) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whole-word match, so "lease" does not hit "please". */
export const hasWord = (hay: string, k: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(k)}`, "iu").test(hay);

/** Scores every message against the keywords and keeps the best few, Rill's way. */
export function retrieve(threads: MailThreadDetail[], keywords: string[], max = 8): AskEvidence[] {
  if (!keywords.length) return [];
  const scored: { e: AskEvidence; score: number; at: string }[] = [];
  for (const t of threads)
    for (const m of t.messages) {
      const hay = `${t.subject} ${m.from.name} ${m.from.email} ${m.body}`.toLowerCase();
      const hits = keywords.filter((k) => hasWord(hay, k)).length;
      if (!hits) continue;
      const subjectHits = keywords.filter((k) => hasWord(t.subject, k)).length;
      scored.push({
        e: { threadId: t.id, subject: t.subject, from: m.fromMe ? "me" : `${m.from.name} <${m.from.email}>`, date: m.date, excerpt: excerptAround(m.body, keywords) },
        score: hits * 2 + subjectHits + (m.fromMe ? 0 : 0.5),
        at: m.date,
      });
    }
  scored.sort((a, b) => b.score - a.score || b.at.localeCompare(a.at));
  return scored.slice(0, max).map((s) => s.e);
}

/** The first sentence of an excerpt that holds a keyword, copied exactly. */
export function quoteFrom(excerpt: string, keywords: string[]): string {
  const sentences = excerpt.replace(/^…/, "").replace(/…$/, "").split(/(?<=[.?!])\s+/).filter((s) => /[.?!]$/.test(s) || s.length > 40);
  const hit = sentences.find((s) => keywords.some((k) => hasWord(s, k) || s.toLowerCase().includes(k))) ?? sentences[0] ?? "";
  return hit.split(/\s+/).slice(0, 25).join(" ");
}
