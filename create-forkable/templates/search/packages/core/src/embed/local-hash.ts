// local:hash-v1, the sample embedder: deterministic feature hashing (word unigrams and
// bigrams, char trigrams, signed hash into 1536 dims, L2 normalized). Not semantic.

export const LOCAL_MODEL = "local:hash-v1@1536";
export const LOCAL_LABEL = "Sample embedder (local, not semantic)";
const DIMS = 1536;

const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are", "was", "it", "at", "by", "with", "from", "this", "that", "be", "as", "we", "you", "i"]);

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

function stem(w: string): string {
  return w.replace(/(ing|ed|es|s)$/, (m) => (w.length - m.length >= 3 ? "" : m));
}

export function hashEmbed(text: string): number[] {
  const v = new Float64Array(DIMS);
  const words = text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9@.]+/).filter((w) => w && !STOP.has(w)).map(stem);
  const add = (f: string, w: number) => {
    const h = fnv1a(f);
    v[h % DIMS] += (h & 0x80000000 ? -1 : 1) * w;
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    add(`u:${w}`, 1);
    if (i + 1 < words.length) add(`b:${w} ${words[i + 1]}`, 0.5);
    const p = `#${w}#`;
    for (let j = 0; j + 3 <= p.length; j++) add(`c:${p.slice(j, j + 3)}`, 0.25);
  }
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return Array.from(v, (x) => x / n);
}
