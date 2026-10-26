// The draft validator. The writer has no tools, so the only thing it can do
// wrong is write something we would not send. Code checks the text before a
// human sees it: no new URLs, no claimed system actions, no dashes, no
// markdown, no subject line, not a mirror of the inbound, under 150 words.

export const MAX_DRAFT_WORDS = 150;

const CLAIM =
  /\b(I(?:'ll| will| have| just|'ve)?\s+(?:send|sent|attach|attached|book|booked|forward|forwarded|schedule|scheduled|grab|grabbed|invite|invited|pay|paid|share|shared|delete|deleted|transfer|transferred|wire|wired)\b|invite attached|see attached|attached (?:is|are|you'll find)|I(?:'ve| have) (?:gone ahead and|already) )/i;

const URL = /https?:\/\/[^\s)>\]]+/gi;
const normUrl = (u: string) => u.toLowerCase().replace(/[.,;:]+$/, "");

export function validateDraft(text: string, inbound: string): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const t = text.trim();
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length === 0) reasons.push("empty");
  if (words.length > MAX_DRAFT_WORDS) reasons.push(`too long (${words.length} words)`);
  if (/[—–]/.test(t)) reasons.push("contains an em or en dash");
  const urlsIn = new Set((inbound.match(URL) ?? []).map(normUrl));
  for (const u of t.match(URL) ?? []) {
    if (!urlsIn.has(normUrl(u))) reasons.push(`new URL ${u}`);
  }
  if (CLAIM.test(t)) reasons.push("claims a system action");
  if (/^(subject:|re:)/im.test(t)) reasons.push("contains a subject line");
  if (/(^|\n)\s*(#{1,6}\s|[-*]\s|>\s|```)/.test(t) || /\*\*[^*]+\*\*/.test(t)) reasons.push("contains markdown or bullets");
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(t)) reasons.push("contains an emoji");
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  const inW = norm(inbound);
  const outJoined = ` ${norm(t).join(" ")} `;
  for (let i = 0; i + 8 <= inW.length; i++) {
    const win = ` ${inW.slice(i, i + 8).join(" ")} `;
    if (outJoined.includes(win)) {
      reasons.push(`mirrors the inbound: "${win.trim()}"`);
      break;
    }
  }
  return { ok: reasons.length === 0, reasons };
}
