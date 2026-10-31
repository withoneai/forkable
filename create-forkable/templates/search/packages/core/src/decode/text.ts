// Text decoders: plain text out of HTML, Markdown, mail, Graph bodies and Slack mrkdwn.

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", hellip: "...", mdash: "-", ndash: "-", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Trim, collapse runs of spaces, keep paragraph breaks (max one blank line). */
export function decodeText(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "";
  return s.replace(/\r\n?/g, "\n").replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function decodeHtml(v: unknown): string {
  if (typeof v !== "string") return decodeText(v);
  let s = v;
  s = s.replace(/<(script|style|head|title)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|li|tr|h[1-6]|blockquote|section|article|table|ul|ol)>/gi, "\n");
  s = s.replace(/<li[^>]*>/gi, "- ");
  s = s.replace(/<[^>]+>/g, " ");
  return decodeText(decodeEntities(s));
}

export function decodeMarkdown(v: unknown): string {
  if (typeof v !== "string") return decodeText(v);
  let s = v;
  s = s.replace(/```[a-z]*\n?([\s\S]*?)```/gi, "$1");
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  s = s.replace(/^\s{0,3}>\s?/gm, "");
  s = s.replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, "- ");
  s = s.replace(/(\*\*|__)(.*?)\1/g, "$2").replace(/(\*|_)([^*_\n]+)\1/g, "$2");
  s = s.replace(/`([^`]+)`/g, "$1");
  s = s.replace(/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/gm, "");
  s = s.replace(/<[^>]+>/g, " ");
  return decodeText(decodeEntities(s));
}

/** Mail body: HTML when it looks like HTML, then drop quoted replies and signatures. */
export function decodeMailStrip(v: unknown): string {
  if (typeof v !== "string") return decodeText(v);
  let s = /<\/?(div|p|br|html|body|table|span)\b/i.test(v) ? decodeHtml(v) : decodeText(v);
  const lines = s.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const t = line.trim();
    // "On Tue, Oct 28, 2026 at 9:14 AM Priya Shah <priya@globex.com> wrote:" (may wrap onto 2 lines)
    if (/^On\b.{4,200}\bwrote:\s*$/i.test(t) || (/^On\b.{4,160}$/i.test(t) && /wrote:\s*$/i.test(lines[i + 1]?.trim() ?? ""))) break;
    if (/^-{2,}\s*Original Message\s*-{2,}$/i.test(t) || /^From:\s.+/.test(t) && /^(Sent|Date):\s/.test(lines[i + 1]?.trim() ?? "")) break;
    if (t === "--" || t === "-- " || /^__+$/.test(t)) break;
    if (/^Sent from my (iPhone|iPad|Android|mobile)/i.test(t)) break;
    if (t.startsWith(">")) continue;
    out.push(line);
  }
  s = out.join("\n");
  return decodeText(s);
}

/** Graph { contentType: "html" | "text", content }. */
export function decodeGraphBody(v: unknown): string {
  if (v && typeof v === "object") {
    const o = v as { contentType?: string; content?: string };
    const c = o.content ?? "";
    return String(o.contentType ?? "").toLowerCase() === "html" ? decodeMailStrip(c) : decodeMailStrip(String(c));
  }
  return decodeMailStrip(v);
}

/** Slack mrkdwn: <@U123> -> @U123, <url|label> -> label, <#C1|deals> -> #deals, *b* _i_ ~s~ marks dropped. */
export function decodeSlackMrkdwn(v: unknown): string {
  if (typeof v !== "string") return decodeText(v);
  let s = v;
  s = s.replace(/<#([A-Z0-9]+)\|([^>]+)>/g, "#$2");
  s = s.replace(/<@([A-Z0-9]+)(\|[^>]+)?>/g, (_m, id: string, label?: string) => `@${label ? label.slice(1) : id}`);
  s = s.replace(/<!(here|channel|everyone)[^>]*>/g, "@$1");
  s = s.replace(/<(https?:[^|>]+)\|([^>]+)>/g, "$2");
  s = s.replace(/<(mailto:)?([^|>]+)>/g, "$2");
  s = s.replace(/(^|\s)[*_~]([^*_~\n]+)[*_~](?=\s|$|[.,!?])/g, "$1$2");
  s = s.replace(/```([\s\S]*?)```/g, "$1").replace(/`([^`]+)`/g, "$1");
  return decodeText(decodeEntities(s));
}

/** base64url (or base64) -> UTF-8 text; "" when it is not valid. */
export function decodeBase64Url(s: string): string {
  try { return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"); } catch { return ""; }
}

interface MimePart { mimeType?: string; filename?: string; body?: { data?: string }; parts?: MimePart[] }

/**
 * A MIME part tree (Gmail's message `payload`, format=full) -> the message text.
 * Walks the parts, skips attachments (a filename), prefers text/plain over text/html,
 * decodes the base64url body and runs mail-strip on it.
 */
export function decodeMimeBody(v: unknown): string {
  if (!v || typeof v !== "object") return typeof v === "string" ? decodeMailStrip(v) : "";
  const found: Record<"plain" | "html", string[]> = { plain: [], html: [] };
  const walk = (p: MimePart) => {
    if (!p || typeof p !== "object" || p.filename) return;
    const mt = (p.mimeType ?? "").toLowerCase();
    const data = p.body?.data;
    if (typeof data === "string" && data && !data.startsWith("[stripped")) {
      if (mt === "text/plain") found.plain.push(decodeBase64Url(data));
      else if (mt === "text/html") found.html.push(decodeBase64Url(data));
    }
    for (const c of p.parts ?? []) walk(c);
  };
  walk(v as MimePart);
  if (found.plain.length) return decodeMailStrip(found.plain.join("\n\n"));
  if (found.html.length) return decodeMailStrip(decodeHtml(found.html.join("\n")));
  return "";
}
