// One place for dates, times, money and counts, so every page shows the same
// thing the same way (a time on the list and on the detail page must match).

const toDate = (v: Date | string | number) => (v instanceof Date ? v : new Date(typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v));

/** "Oct 24" this year, "Oct 24, 2025" otherwise. */
export function formatDate(v: Date | string | number): string {
  const d = toDate(v);
  if (Number.isNaN(d.getTime())) return "";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

/** "2:05 PM" */
export function formatTime(v: Date | string | number): string {
  const d = toDate(v);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** "Oct 24, 2:05 PM" */
export function formatDateTime(v: Date | string | number): string {
  const d = toDate(v);
  return Number.isNaN(d.getTime()) ? "" : `${formatDate(d)}, ${formatTime(d)}`;
}

/** "just now", "5 min ago", "3 h ago", "yesterday", then the date. */
export function formatRelative(v: Date | string | number): string {
  const d = toDate(v);
  const s = (Date.now() - d.getTime()) / 1000;
  if (Number.isNaN(s)) return "";
  if (s < 0) return formatDateTime(d);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 172_800) return "yesterday";
  return formatDate(d);
}

/** formatMoney(123456, "usd") -> "$1,234.56" (amounts in cents, as Stripe sends them). */
export function formatMoney(cents: number, currency = "usd"): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase() }).format((cents ?? 0) / 100);
}

/** formatCount(3, "thread") -> "3 threads" */
export function formatCount(n: number, noun: string, plural = `${noun}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? noun : plural}`;
}
