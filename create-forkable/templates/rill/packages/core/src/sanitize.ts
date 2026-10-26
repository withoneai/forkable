// Email text handling, in code. HTML to text, the newest message's own words
// (quotes and signatures stripped), the text a human would not see, and
// address parsing. Nothing here calls a model; Jev and the writer get the
// output of these functions, never raw HTML.

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#160": " " };

function unescapeHtml(s: string): string {
  return s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (ENTITIES[k] !== undefined) return ENTITIES[k]!;
    try {
      if (k.startsWith("#x")) return String.fromCodePoint(parseInt(k.slice(2), 16));
      if (k.startsWith("#")) return String.fromCodePoint(parseInt(k.slice(1), 10));
    } catch {
      return m;
    }
    return m;
  });
}

const ZERO_WIDTH = /[​‌‍⁠﻿­]/g;

export function looksLikeHtml(s: string): boolean {
  return /<\s*(html|body|div|p|br|table|span|a|img|td|tr|style|head)\b[^>]*>/i.test(s);
}

export function htmlToText(html: string): string {
  if (!html) return "";
  return unescapeHtml(
    html
      .replace(/<(style|script|head|title)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h[1-6]|blockquote|table|pre|section|article|header|footer)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(ZERO_WIDTH, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const QUOTE_CUTS: RegExp[] = [
  /^\s*On .{0,300}?wrote:\s*$/ms,
  /^\s*>?\s*From:\s.+\n(?:>?\s*)?(?:Sent|Date|To|Cc|Subject):/m,
  /^\s*Begin forwarded message:\s*$/mi,
  /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/mi,
  /^\s*-{2,}\s*Forwarded message\s*-{2,}\s*$/mi,
  /^\s*_{8,}\s*$/m,
  /^\s*Le .{0,200}? a écrit\s*:\s*$/ms,
  /^\s*Am .{0,200}? schrieb .{0,100}?:\s*$/ms,
  /^\s*El .{0,200}? escribió:\s*$/ms,
  /^-- ?$/m, // the signature separator
  /^\s*Sent from my (iPhone|iPad|Android|Galaxy|phone)\b.*$/mi,
];

/** The newest message's own words: everything before the quoted history, minus quote lines. */
export function stripQuoted(text: string): string {
  if (!text) return "";
  let cut = text.length;
  for (const re of QUOTE_CUTS) {
    const m = re.exec(text);
    if (m && m.index < cut && m.index > 0) cut = m.index;
  }
  const head = text.slice(0, cut);
  return head
    .split("\n")
    .filter((l) => !/^\s*>/.test(l))
    .join("\n")
    .replace(ZERO_WIDTH, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const HIDDEN_STYLE =
  /display\s*:\s*none|font-size\s*:\s*0(?:\.0+)?(?:px|pt|em|rem)?\s*(?:;|"|'|$)|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\.0+)?\s*(?:;|"|'|$)|(?:max-height|height|width)\s*:\s*0(?:px)?\s*(?:;|"|'|$)|(?:left|top|text-indent)\s*:\s*-\d{3,}|color\s*:\s*(?:#fff(?:fff)?|white|transparent|rgba\([^)]*,\s*0\s*\))\s*(?:;|"|'|$)/i;
const HIDDEN_ATTR = /(?:^|\s)hidden(?:\s|=|$)|aria-hidden\s*=\s*["']true["']/i;

function colorMatchesBackground(attrs: string): boolean {
  const style = /style\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] ?? "";
  const color = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(style)?.[1]?.trim().toLowerCase();
  const bg =
    /background(?:-color)?\s*:\s*([^;]+)/i.exec(style)?.[1]?.trim().toLowerCase() ??
    /bgcolor\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1]?.toLowerCase();
  if (!color || !bg) return false;
  const norm = (c: string) => c.replace(/\s+/g, "").replace(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i, "#$1$1$2$2$3$3");
  return norm(color) === norm(bg);
}

/**
 * Text a human would not see: elements styled away, text coloured like its
 * background, HTML comments, and anything the HTML says that the plain-text
 * alternative does not. Zero-width characters are stripped from the visible
 * body; a run of them inside a word is reported here because that is how
 * filters get evaded.
 */
export function hiddenText(html: string, plain = ""): string {
  if (!html) return "";
  const found: string[] = [];
  const re = /<([a-z0-9]+)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const attrs = m[2] ?? "";
    if (HIDDEN_STYLE.test(attrs) || HIDDEN_ATTR.test(attrs) || colorMatchesBackground(attrs)) {
      const t = htmlToText(m[3] ?? "");
      if (t.length >= 3) found.push(t);
    } else {
      // Look inside a visible element too: a hidden div wrapped in <html><body> was skipped whole. Gmail's
      // plain-text alternative used to catch it below; Outlook has no plain alternative to compare with.
      re.lastIndex = m.index + 1 + (m[1]?.length ?? 0);
    }
  }
  for (const c of html.match(/<!--([\s\S]*?)-->/g) ?? []) {
    const t = c.slice(4, -3).replace(/\s+/g, " ").trim();
    if (t.length >= 20 && !/^\[if |^\s*\/?\w+\s*$/i.test(t)) found.push(t);
  }
  const zw = html.match(/\w[​‌‍⁠﻿]+\w/g) ?? [];
  if (zw.length >= 3) {
    const joined = htmlToText(html).slice(0, 300);
    found.push(`Zero-width characters split ${zw.length} words in the visible text: ${joined}`);
  }
  if (plain) {
    const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    const plainNorm = norm(stripQuoted(plain));
    const visible = stripQuoted(htmlToText(html))
      .split(/(?<=[.!?])\s+|\n/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 40 && !s.includes(" | "));
    for (const s of visible) {
      const n = norm(s);
      if (n.length >= 30 && !plainNorm.includes(n) && !found.some((f) => norm(f).includes(n))) found.push(s);
    }
  }
  return found.join("\n").replace(/\s+/g, " ").trim().slice(0, 1500);
}

export function parseFrom(value: string | null | undefined): { name: string; email: string } {
  const v = (value ?? "").trim();
  if (!v) return { name: "", email: "" };
  const m = v.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) {
    const email = (m[2] ?? "").trim().toLowerCase();
    const name = (m[1] ?? "").trim() || email.split("@")[0] || email;
    return { name, email };
  }
  const bare = v.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/);
  if (bare) {
    const email = bare[0].toLowerCase();
    const name = v.replace(bare[0], "").replace(/[<>"]/g, "").trim() || email.split("@")[0] || email;
    return { name, email };
  }
  return { name: v, email: v.toLowerCase() };
}

/** "a@x.com, Bob <b@y.com>" or ["a@x.com", …] -> lowercase addresses. */
export function parseAddressList(value: string | string[] | null | undefined): string[] {
  if (!value) return [];
  const parts = Array.isArray(value) ? value : splitAddresses(value);
  const out: string[] = [];
  for (const p of parts) {
    const e = parseFrom(p).email;
    if (e && e.includes("@") && !out.includes(e)) out.push(e);
  }
  return out;
}

function splitAddresses(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of s) {
    if (ch === '"') quoted = !quoted;
    if ((ch === "," || ch === ";") && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

export function emailOf(value: string): string {
  return parseFrom(value).email;
}

export function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : "";
}

/** The text a model should see for one message: text or HTML in, the newest words out. */
export function bodyText(raw: string): { body: string; hidden: string; wasHtml: boolean } {
  if (!raw) return { body: "", hidden: "", wasHtml: false };
  if (looksLikeHtml(raw)) {
    const text = htmlToText(raw);
    return { body: stripQuoted(text), hidden: hiddenText(raw), wasHtml: true };
  }
  // "HTML reduced to text" from the Gmail helper can still carry a doctype, stray tags
  // and entities (&zwnj; runs in newsletter preheaders). Clean it the same way.
  const plain = unescapeHtml(raw.replace(/<!doctype[^>]*>/gi, "").replace(/<[a-z\/!][^>]*>/gi, " "))
    .replace(ZERO_WIDTH, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\u00a0]{2,}/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { body: stripQuoted(plain), hidden: "", wasHtml: false };
}

/** Gmail's snippet (or a body fallback) as one clean preview line: no doctype, tags, entities or zero-width runs. */
export function cleanSnippet(value: string | null | undefined, max = 140): string {
  if (!value) return "";
  return unescapeHtml(value.replace(/<!doctype[^>]*>/gi, " ").replace(/<[a-z\/!][^>]*>/gi, " "))
    .replace(ZERO_WIDTH, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
