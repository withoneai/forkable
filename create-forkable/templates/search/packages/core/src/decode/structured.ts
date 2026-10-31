// Structured rich text: Notion blocks and titles, ProseMirror (Linear, Tiptap) JSON.

function richText(rt: unknown): string {
  if (!Array.isArray(rt)) return "";
  return rt.map((r) => (r && typeof r === "object" ? String((r as { plain_text?: string; text?: { content?: string } }).plain_text ?? (r as { text?: { content?: string } }).text?.content ?? "") : "")).join("");
}

/** Array of Notion blocks (or { results: [...] }) -> text, one line per block. */
export function decodeNotionBlocks(v: unknown): string {
  const blocks = Array.isArray(v) ? v : v && typeof v === "object" && Array.isArray((v as { results?: unknown[] }).results) ? (v as { results: unknown[] }).results : [];
  const lines: string[] = [];
  for (const b of blocks) {
    if (!b || typeof b !== "object") continue;
    const type = (b as { type?: string }).type;
    const body = type ? (b as Record<string, unknown>)[type] : undefined;
    let line = body && typeof body === "object" ? richText((body as { rich_text?: unknown }).rich_text) : "";
    if (!line && body && typeof body === "object" && Array.isArray((body as { title?: unknown }).title)) line = richText((body as { title: unknown }).title);
    if (type?.startsWith("heading")) line = line.trim();
    if (type === "bulleted_list_item" || type === "numbered_list_item" || type === "to_do") line = `- ${line}`;
    if (line.trim()) lines.push(line);
  }
  return lines.join("\n").trim();
}

/** Notion page properties -> the title property's plain text. Accepts the page itself too. */
export function decodeNotionTitle(v: unknown): string {
  if (!v || typeof v !== "object") return typeof v === "string" ? v : "";
  const props = ((v as { properties?: unknown }).properties ?? v) as Record<string, unknown>;
  for (const p of Object.values(props)) {
    if (p && typeof p === "object" && (p as { type?: string }).type === "title") return richText((p as { title?: unknown }).title).trim();
  }
  return "";
}

const BLOCK = new Set(["paragraph", "heading", "blockquote", "listItem", "bulletList", "orderedList", "codeBlock", "taskItem", "horizontalRule", "table", "tableRow"]);

/** ProseMirror JSON (object or string) -> text. A plain string that is not JSON passes through. */
export function decodeProsemirror(v: unknown): string {
  let doc = v;
  if (typeof v === "string") {
    const t = v.trim();
    if (!t.startsWith("{")) return t;
    try { doc = JSON.parse(t); } catch { return t; }
  }
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    const node = n as { type?: string; text?: string; content?: unknown[] };
    if (typeof node.text === "string") out.push(node.text);
    if (node.type === "hardBreak") out.push("\n");
    for (const c of node.content ?? []) walk(c);
    if (node.type && BLOCK.has(node.type)) out.push("\n");
  };
  walk(doc);
  return out.join("").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/** A meeting transcript speaker as Granola and most recorders send it: a name string or an object. */
function speakerLabel(s: unknown): string {
  if (typeof s === "string") return s.trim();
  if (!s || typeof s !== "object") return "";
  const o = s as Record<string, unknown>;
  for (const k of ["name", "display_name", "displayName", "diarization_label", "label"]) if (typeof o[k] === "string" && (o[k] as string).trim()) return (o[k] as string).trim();
  // Granola on macOS: { source, attribution: "me" | "them" }; the microphone is you, the
  // system audio ("speaker", "system") is everyone else.
  if (o.attribution === "me") return "Me";
  if (o.attribution === "them") return "Them";
  if (o.source === "microphone") return "Me";
  if (o.source === "system" || o.source === "speaker") return "Them";
  return "";
}

/**
 * Transcript segments ([{ speaker, text }], or { transcript: [...] }) -> "Transcript" then one
 * "Speaker: text" line per turn, consecutive segments from one speaker joined. Empty when there
 * is no spoken text, so a join leaves no stray heading.
 */
export function decodeTranscript(v: unknown): string {
  const segs = Array.isArray(v) ? v : v && typeof v === "object" && Array.isArray((v as { transcript?: unknown[] }).transcript) ? (v as { transcript: unknown[] }).transcript : [];
  const turns: { who: string; text: string }[] = [];
  for (const s of segs) {
    if (typeof s === "string") { if (s.trim()) turns.push({ who: "", text: s.trim() }); continue; }
    if (!s || typeof s !== "object") continue;
    const o = s as Record<string, unknown>;
    const text = typeof o.text === "string" ? o.text.replace(/\s+/g, " ").trim() : "";
    if (!text) continue;
    const who = speakerLabel(o.speaker ?? o.speaker_name ?? o.source);
    const last = turns[turns.length - 1];
    if (last && last.who === who) last.text += ` ${text}`;
    else turns.push({ who, text });
  }
  if (!turns.length) return "";
  return ["Transcript", ...turns.map((t) => (t.who ? `${t.who}: ${t.text}` : t.text))].join("\n");
}
