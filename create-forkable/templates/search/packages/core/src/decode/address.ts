// Email, domain and "Name <email>" parsing. EMAIL_RE from the One CLI (mem-writer.ts:393).

export const EMAIL_RE = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "icloud.com", "me.com", "mac.com",
  "yahoo.com", "ymail.com", "proton.me", "protonmail.com", "pm.me", "aol.com", "fastmail.com", "hey.com", "zoho.com",
  "mail.com", "yandex.com", "qq.com", "163.com",
]);

export function isFreeMail(domain: string): boolean {
  const d = domain.toLowerCase();
  return FREE_MAIL.has(d) || /^gmx\./.test(d);
}

/** First email address in a string, lowercased; undefined when none. */
export function decodeEmail(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const m = v.match(EMAIL_RE);
  return m?.[0]?.toLowerCase();
}

export function allEmails(v: unknown): string[] {
  if (typeof v !== "string") return [];
  return (v.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase());
}

// Two-level public suffixes common enough to matter for company domains.
const TWO_LEVEL = new Set(["co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "co.nz", "co.jp", "co.in", "com.br", "com.mx", "co.za", "com.sg", "com.hk", "com.cn", "co.kr", "com.tr", "com.ar", "co.il"]);

/** Registrable domain of an email, URL or host: "mail.eu.globex.com" -> "globex.com". */
export function decodeDomain(v: unknown): string | undefined {
  if (typeof v !== "string" || !v.trim()) return undefined;
  let host = v.trim().toLowerCase();
  const email = decodeEmail(host);
  if (email) host = email.split("@")[1]!;
  else {
    try {
      if (/^[a-z]+:\/\//.test(host)) host = new URL(host).hostname;
    } catch { /* not a URL */ }
    host = host.replace(/^www\./, "").split("/")[0]!.split(":")[0]!;
  }
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return undefined;
  const parts = host.split(".");
  const last2 = parts.slice(-2).join(".");
  if (TWO_LEVEL.has(last2) && parts.length >= 3) return parts.slice(-3).join(".");
  return last2;
}

export interface Address { name?: string; email?: string }

/** "Jane <jane@acme.com>, Bob <b@x.io>" | { name, email } | Graph { emailAddress: { name, address } } -> Address[]. */
export function decodeAddress(v: unknown): Address[] {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v.flatMap(decodeAddress);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (o.emailAddress && typeof o.emailAddress === "object") return decodeAddress(o.emailAddress);
    const email = decodeEmail(String(o.email ?? o.address ?? o.mail ?? ""));
    const name = typeof o.name === "string" ? o.name.trim() : typeof o.displayName === "string" ? o.displayName.trim() : undefined;
    return email || name ? [{ ...(name ? { name } : {}), ...(email ? { email } : {}) }] : [];
  }
  if (typeof v !== "string") return [];
  const out: Address[] = [];
  // split on commas that are not inside quotes or angle brackets
  const parts: string[] = [];
  let depth = 0, q = false, cur = "";
  for (const ch of v) {
    if (ch === '"') q = !q;
    if (!q && ch === "<") depth++;
    if (!q && ch === ">") depth = Math.max(0, depth - 1);
    if (ch === "," && !q && depth === 0) { parts.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  for (const p of parts) {
    const email = decodeEmail(p);
    let name = p.replace(/<[^>]*>/g, "").replace(EMAIL_RE, "").replace(/["']/g, "").trim();
    if (!name && !email) continue;
    if (name === email) name = "";
    out.push({ ...(name ? { name } : {}), ...(email ? { email } : {}) });
  }
  return out;
}

/** Display name from an email local part: "priya.shah" -> "Priya Shah". */
export function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local.split(/[._-]+/).filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ") || email;
}
