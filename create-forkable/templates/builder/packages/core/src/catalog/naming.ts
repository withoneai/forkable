// Names derived from a catalog action: the wrapper name in actions.gen.ts,
// the short verb a receipt shows ("Gmail · send"), and the level.
// Browser-safe (the UI uses verbFor too).

import type { ActionLevel } from "../types.js";

const FILLER = new Set(["a", "an", "the", "users", "user", "user's", "users'"]);

const clean = (s: string) => s.replace(/[’‘]/g, "'").replace(/\([^)]*\)/g, " ");

/** "List and View Email Threads" -> "listAndViewEmailThreads". */
export function wrapperName(title: string): string {
  const parts = clean(title)
    .split(/[^A-Za-z0-9']+/)
    .map((w) => w.replace(/'/g, ""))
    .filter((w) => w && !FILLER.has(w.toLowerCase()) && w.toLowerCase() !== "s");
  const name = parts.map((w, i) => (i === 0 ? w.toLowerCase() : w[0]!.toUpperCase() + w.slice(1).toLowerCase())).join("");
  const safe = name.replace(/^[0-9]/, (d) => `n${d}`);
  return safe || "action";
}

/** "google-calendar" -> "googleCalendar", the export name for a platform's wrappers. */
export function platformIdent(platform: string): string {
  const id = platform.replace(/[^A-Za-z0-9]+(.)?/g, (_m, c: string | undefined) => (c ? c.toUpperCase() : ""));
  return /^[0-9]/.test(id) ? `p${id}` : id || "platform";
}

/** "google-calendar" -> "Google Calendar" when the catalog has no name. */
export function nameFromSlug(slug: string): string {
  const special: Record<string, string> = { github: "GitHub", hubspot: "HubSpot", linkedin: "LinkedIn", youtube: "YouTube", openai: "OpenAI" };
  if (special[slug]) return special[slug]!;
  return slug
    .split("-")
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

const READ_TITLE = /^(list|get|view|search|find|retrieve|fetch|read|look ?up|query|count|check|download|export)\b/i;
const READ_TAGS = new Set(["read", "readonly", "read-only", "safe"]);

/**
 * GET read, POST/PUT/PATCH write, DELETE delete. A POST stays a read when the
 * catalog tags it as one, or when it is a One-served (custom) action whose
 * title says it only reads ("List and View Email Threads"; the catalog has no
 * read tag today).
 */
export function levelFor(a: { method: string; title?: string | null; tags?: string[] | null }): ActionLevel {
  const m = a.method.toUpperCase();
  if (m === "GET" || m === "HEAD") return "read";
  if (m === "DELETE") return "delete";
  const tags = a.tags ?? [];
  if (tags.some((t) => READ_TAGS.has(t.toLowerCase()))) return "read";
  if (m === "POST" && tags.includes("custom") && a.title && READ_TITLE.test(a.title.trim())) return "read";
  return "write";
}

const VERBS = new Set(["send", "trash", "untrash", "modify", "import", "cancel", "archive", "unarchive", "publish", "search", "query", "stop", "start", "watch", "merge", "close", "reopen", "approve", "reject", "refund", "capture", "confirm", "move", "copy", "batchmodify", "batchdelete", "reply", "forward"]);
const NOUNS = new Set(["email", "emails", "message", "messages", "mail"]);
const METHOD_VERB: Record<string, string> = { GET: "get", POST: "create", PUT: "update", PATCH: "update", DELETE: "delete" };

function singular(w: string): string {
  if (/ies$/.test(w)) return w.replace(/ies$/, "y");
  if (/ses$/.test(w)) return w.replace(/es$/, "");
  return w.replace(/s$/, "");
}

/**
 * The short verb a receipt or manifest line shows: "get threads", "send",
 * "delete". From the path's last static segment, the method, and the
 * platform's own nouns dropped ("send-email" is "send" on Gmail).
 */
export function verbFor(a: { method: string; path: string; platform?: string }): string {
  const method = a.method.toUpperCase();
  const segs = a.path.split("?")[0]!.split("/").filter(Boolean);
  const isParam = (s: string) => /^\{\{?.+\}?\}$/.test(s) || s.startsWith(":");
  const last = segs[segs.length - 1] ?? "";
  let phrase: string[];
  if (!last) phrase = [METHOD_VERB[method] ?? method.toLowerCase()];
  else if (isParam(last)) {
    const noun = [...segs].reverse().find((s) => !isParam(s)) ?? "";
    phrase = [METHOD_VERB[method] ?? method.toLowerCase(), singular(noun.toLowerCase())];
  } else if (last.includes("-")) {
    phrase = last.toLowerCase().split(/-+/);
  } else if (VERBS.has(last.toLowerCase())) {
    const noun = [...segs].slice(0, -1).reverse().find((s) => !isParam(s)) ?? "";
    phrase = [last.toLowerCase(), singular(noun.toLowerCase())];
  } else {
    const prevParam = segs.length > 1 && isParam(segs[segs.length - 2]!);
    const plural = /s$/i.test(last);
    const lastWords = last.toLowerCase().replace(/_/g, " ");
    if (prevParam && method !== "GET" && !plural) {
      // /messages/{id}/trash: an action on one item.
      const noun = [...segs].slice(0, -2).reverse().find((s) => !isParam(s)) ?? "";
      phrase = [lastWords, singular(noun.toLowerCase())];
    } else if (method === "GET") phrase = [plural ? "list" : "get", lastWords];
    else if (method === "POST") phrase = ["create", singular(lastWords)];
    else phrase = [METHOD_VERB[method] ?? method.toLowerCase(), lastWords];
  }
  const platformWords = new Set((a.platform ?? "").toLowerCase().split("-"));
  const kept = phrase.filter((w, i) => i === 0 || (!NOUNS.has(w) && !platformWords.has(w)));
  return kept.filter(Boolean).join(" ");
}
