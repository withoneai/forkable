import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// How a message body is shown. HTML mail renders inside a sandboxed iframe:
// no scripts can run (the sandbox has no allow-scripts), remote images are
// blocked until the reader asks for them (tracking pixels never fire on
// their own), links open in a new tab. Plain text gets tidy whitespace and
// short, clickable links.

const BLOCK_TAGS = /<(script|iframe|object|embed|form|frame|frameset|applet|video|audio)\b[\s\S]*?(<\/\1\s*>|$)/gi;
const EVENT_ATTRS = /\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const JS_URLS = /(href|src|action|background)\s*=\s*("|')\s*javascript:[^"']*\2/gi;
const META = /<meta\b[^>]*http-equiv[^>]*>/gi;
const STYLESHEETS = /<link\b[^>]*>/gi;

/** Drops `@media (prefers-color-scheme: dark) { … }` blocks so mail renders in its light design, as Gmail does. Brace-matched, so nested rules survive. */
function stripDarkMedia(css: string): string {
  const re = /@media[^{]*prefers-color-scheme\s*:\s*dark[^{]*\{/gi;
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    out += css.slice(last, m.index);
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
      i++;
    }
    last = i;
    re.lastIndex = i;
  }
  return out + css.slice(last);
}

function scrub(html: string): string {
  return html
    .replace(BLOCK_TAGS, "")
    .replace(EVENT_ATTRS, "")
    .replace(JS_URLS, '$1=$2#$2')
    .replace(META, "")
    .replace(STYLESHEETS, "")
    .replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (_, attrs: string, css: string) => `<style${attrs}>${stripDarkMedia(css)}</style>`);
}

// A quiet grey block stands in for every remote image while images are blocked,
// so the layout holds and nothing shows a broken-image glyph. Tracking pixels
// (1 to 3 px) are hidden outright.
const PLACEHOLDER = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='100%' height='100%'><rect width='100%' height='100%' fill='#e9e7e2'/></svg>",
);
const IMG_TAG = /<img\b([^>]*)>/gi;
const SRC_ATTR = /\ssrc\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i;
const DIM = (attrs: string, name: "width" | "height") => {
  const m = attrs.match(new RegExp(`\\s${name}\\s*=\\s*["']?(\\d+)`, "i")) ?? attrs.match(new RegExp(`${name}\\s*:\\s*(\\d+)px`, "i"));
  return m ? Number(m[1]) : null;
};

function withPlaceholders(html: string): string {
  return html.replace(IMG_TAG, (tag: string, attrs: string) => {
    const src = attrs.match(SRC_ATTR)?.[1]?.replace(/^["']|["']$/g, "") ?? "";
    if (!/^https?:/i.test(src) && !/^\/\//.test(src)) return tag;
    const w = DIM(attrs, "width");
    const h = DIM(attrs, "height");
    if ((w !== null && w <= 3) || (h !== null && h <= 3)) return `<img${attrs.replace(SRC_ATTR, "")} src="${PLACEHOLDER}" style="display:none" data-pixel>`;
    const sized = w !== null && h !== null && w > 0 && h > 0 ? ` style="aspect-ratio:${w}/${h}"` : "";
    return `<img${attrs.replace(SRC_ATTR, "")} src="${PLACEHOLDER}" data-blocked${sized}>`;
  });
}

function frameDocument(html: string, images: boolean): string {
  const csp = `default-src 'none'; img-src ${images ? "https: http: data: cid:" : "data: cid:"}; style-src 'unsafe-inline'; font-src 'none'; frame-src 'none'; form-action 'none'`;
  const body = images ? scrub(html) : withPlaceholders(scrub(html));
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>
:root{color-scheme:light only}
html,body{margin:0;padding:0;background:#fff;color:#1a1917}
body{font:14px/1.5 -apple-system,BlinkMacSystemFont,"Inter",Segoe UI,Roboto,Helvetica,Arial,sans-serif;overflow-wrap:anywhere}
td,th{overflow-wrap:normal;word-break:normal}
img{max-width:100%;height:auto}
img[data-blocked]{background:#e9e7e2;border-radius:4px;object-fit:cover;max-height:280px;min-width:16px;min-height:16px}
a{color:#1d4ed8}
blockquote{border-left:2px solid #e5e2db;margin:0;padding-left:12px;color:#6b675f}
</style></head><body>${body}</body></html>`;
}

export function EmailBody({ text, html, className, showImages = true }: { text: string; html?: string | null; className?: string; showImages?: boolean }) {
  if (html && /<[a-z][\s\S]*>/i.test(html)) return <HtmlFrame html={html} className={className} defaultImages={showImages} />;
  return <PlainText text={text} className={className} />;
}

function HtmlFrame({ html, className, defaultImages }: { html: string; className?: string; defaultImages: boolean }) {
  const [images, setImages] = useState(defaultImages);
  useEffect(() => setImages(defaultImages), [defaultImages]);
  const [height, setHeight] = useState(120);
  const ref = useRef<HTMLIFrameElement>(null);
  const hasRemoteImages = useMemo(() => /<img\b[^>]*src\s*=\s*["']?https?:/i.test(html), [html]);
  const doc = useMemo(() => frameDocument(html, images), [html, images]);

  const measure = () => {
    const d = ref.current?.contentDocument;
    if (!d) return;
    const h = Math.max(d.documentElement?.scrollHeight ?? 0, d.body?.scrollHeight ?? 0);
    if (h > 0) setHeight(Math.min(h + 2, 20000));
  };
  useEffect(() => {
    const t = setTimeout(measure, 50);
    const t2 = setTimeout(measure, 600);
    return () => { clearTimeout(t); clearTimeout(t2); };
  }, [doc]);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {hasRemoteImages && !images && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-faint px-3 py-1.5 text-11 text-muted-foreground">
          <span>Images are blocked, so tracking pixels do not fire.</span>
          <button type="button" className="font-medium text-foreground underline-offset-2 hover:underline" onClick={() => setImages(true)}>Show images</button>
        </div>
      )}
      <iframe
        ref={ref}
        title="Email"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        srcDoc={doc}
        onLoad={measure}
        style={{ height }}
        className="w-full rounded-md border border-border bg-white"
        scrolling="auto"
      />
    </div>
  );
}

const URL_RE = /https?:\/\/[^\s<>()"']+/g;

const NAMED: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", zwnj: "", zwj: "", shy: "", ensp: " ", emsp: " ", thinsp: " ", hairsp: "", mdash: ",", ndash: ",", hellip: "…", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', copy: "©", reg: "®", trade: "™" };

/** Text that came from HTML can carry entities, a stray doctype and leftover tags. */
function decodeEntities(text: string): string {
  return text
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<[a-z\/!][^>]*>/gi, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => {
      const cp = parseInt(h, 16);
      return cp === 0x200c || cp === 0x200d || cp === 0xad || cp === 0x200a ? "" : String.fromCodePoint(cp);
    })
    .replace(/&#(\d+);/g, (_, d: string) => {
      const cp = Number(d);
      return cp === 0x200c || cp === 0x200d || cp === 0xad || cp === 0x200a ? "" : String.fromCodePoint(cp);
    })
    .replace(/&([a-z]+);/gi, (m, name: string) => (name.toLowerCase() in NAMED ? NAMED[name.toLowerCase()]! : m))
    .replace(/[\u200b\u200c\u200d\u2060\ufeff\u00ad]/g, "");
}

function tidy(text: string): string {
  return decodeEntities(text)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\u00a0]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s*\n|\n\s*$/g, "")
    .trim();
}

function shortUrl(u: string): string {
  try {
    const url = new URL(u);
    const path = url.pathname.length > 24 ? `${url.pathname.slice(0, 24)}…` : url.pathname;
    return `${url.host}${path === "/" ? "" : path}${url.search ? "…" : ""}`;
  } catch {
    return u.length > 48 ? `${u.slice(0, 48)}…` : u;
  }
}

function PlainText({ text, className }: { text: string; className?: string }) {
  const parts = useMemo(() => {
    const out: (string | { url: string })[] = [];
    const t = tidy(text);
    let last = 0;
    for (const m of t.matchAll(URL_RE)) {
      const i = m.index ?? 0;
      if (i > last) out.push(t.slice(last, i));
      out.push({ url: m[0] });
      last = i + m[0].length;
    }
    if (last < t.length) out.push(t.slice(last));
    return out;
  }, [text]);
  return (
    <p className={cn("whitespace-pre-wrap break-words font-sans text-13 leading-relaxed", className)}>
      {parts.map((p, i) =>
        typeof p === "string" ? (
          <span key={i}>{p}</span>
        ) : (
          <a key={i} href={p.url} target="_blank" rel="noreferrer noopener" title={p.url} className="text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground">
            {shortUrl(p.url)}
          </a>
        ),
      )}
    </p>
  );
}
