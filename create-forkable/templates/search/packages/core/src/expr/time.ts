// Durations and date coercion shared by templates, predicates, decoders and the engine.

const UNIT_MS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000, y: 365 * 86_400_000 };

/** "10m" -> 600000; "all" -> Infinity; null when it does not parse. */
export function parseDuration(s: string | null | undefined): number | null {
  if (s === null || s === undefined) return null;
  const t = String(s).trim();
  if (t === "all") return Number.POSITIVE_INFINITY;
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w|y)$/.exec(t);
  if (!m) return null;
  return Number(m[1]) * UNIT_MS[m[2]!]!;
}

/** Any of: Date, ISO 8601, RFC 2822, epoch seconds or ms (number or numeric string), Slack ts. */
export function toDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "number") return epoch(v);
  if (typeof v === "string") {
    const s = v.trim();
    if (/^-?\d+(\.\d+)?$/.test(s)) return epoch(Number(s));
    // zone-less ISO date-times (Graph dateTime, Attio) are UTC, never server-local
    const zl = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/.exec(s);
    if (zl) { const d0 = new Date(`${zl[1]!.replace(/(\.\d{3})\d+$/, "$1")}Z`); return Number.isNaN(d0.getTime()) ? null : d0; }
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d;
    return null;
  }
  return null;
}

function epoch(n: number): Date | null {
  if (!Number.isFinite(n)) return null;
  // seconds until year ~5138, ms after
  const ms = Math.abs(n) < 1e11 ? n * 1000 : n;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function toIso(v: unknown): string | null {
  const d = toDate(v);
  return d ? d.toISOString() : null;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** Formats in UTC: yyyy MM dd HH mm ss. */
export function formatDate(d: Date, fmt: string): string {
  return fmt
    .replace(/yyyy/g, String(d.getUTCFullYear()))
    .replace(/MM/g, pad(d.getUTCMonth() + 1))
    .replace(/dd/g, pad(d.getUTCDate()))
    .replace(/HH/g, pad(d.getUTCHours()))
    .replace(/mm/g, pad(d.getUTCMinutes()))
    .replace(/ss/g, pad(d.getUTCSeconds()));
}
