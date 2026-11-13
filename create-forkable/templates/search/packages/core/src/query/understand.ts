// Plain sentences to filters (SPEC D48). Browser-safe, no I/O, no model: a few
// hand-written patterns over the free words of the box, checked against the
// person's own people, companies and connected tools.
//
//   "emails from Priya last week"  ->  type:mail from:priya@globex.com after:... before:...
//
// When in doubt, no filter: a wrong filter empties the page with nothing on screen
// saying why. A phrase is applied only when it is unambiguous: a recognized pattern
// and one clear match. Two people with the name, a last name alone, a first name
// that is also a word ("grace"), a tool name that is also a word in an everyday
// phrase ("linear algebra"), a word that is both a name and a tool or a month, "with
// A and B", and "not from Priya" come back as suggestions with choices, never picked
// silently. Typed filters (from:, in:, type:, ...) win: their key is never inferred
// again. Quoted text, words after a negation and filters are never applied. The box
// text is never rewritten here; the UI quotes a phrase to keep it as words.

import type { OperatorKey } from "../api-types.js";
import { PLATFORM_NAMES, platformName } from "../platforms.js";
import { findDates } from "./dates.js";
import { lexQuery, parseQuery } from "./parse.js";

export interface VocabEntity {
  id: string; type: "person" | "company"; name: string;
  email?: string | null; domain?: string | null; itemCount?: number; isSelf?: boolean;
  /** Other records of the same human (same name, at most one address): the filter then names them all. */
  twins?: string[];
}
/** What understanding checks words against: the person's people and companies, and the platforms they have connected. */
export interface Vocab {
  entities: VocabEntity[]; platforms: string[];
  /** The list stops at the busiest people and companies; exact names and addresses past it come in as `extra`. */
  truncated?: boolean;
  /** Chat channels the person has messages in, without the # ("deals"): "in #deals" and "in the deals channel" read as that channel. */
  channels?: string[];
  /** The item kinds each connected platform holds ("slack" -> ["message", "person"]): a type word a tool already implies is not a second chip. */
  kinds?: Record<string, string[]>;
}

export type UnderstoodKind = "person" | "company" | "source" | "type" | "state" | "date";
/** One phrase read as a filter. `filter` is the operator text it stands for. */
export interface Understood { phrase: string; start: number; end: number; filter: string; keys: OperatorKey[]; label: string; kind: UnderstoodKind }
export interface UnderstandChoice { label: string; filter: string; detail: string | null; kind: UnderstoodKind }
/** A phrase that could mean more than one thing: offered, never applied. */
export interface UnderstandSuggestion {
  phrase: string; start: number; end: number;
  /**
   * same_name: two people share it; name_or_tool, name_or_date: a name or a tool or a month;
   * last_name: a last name alone; common_word: a first name that is also a word ("grace");
   * maybe_tool: a tool name that may be an everyday word ("linear algebra"); negated: "not
   * from Priya", offered as the opposite filter; list: "with A and B" (either one);
   * which_year: a month still ahead this year.
   */
  why: "same_name" | "name_or_tool" | "name_or_date" | "last_name" | "common_word" | "maybe_tool" | "negated" | "list" | "which_year";
  choices: UnderstandChoice[];
}
export interface Understanding {
  understood: Understood[];
  suggestions: UnderstandSuggestion[];
  /** The query actually searched: the text with understood phrases taken out and their filters added. */
  query: string;
}

// ---------- words ----------

/**
 * One way to compare words, used for the name list and for what was typed: every
 * combining mark goes (accents, Arabic hamza and harakat, Japanese voicing marks),
 * so "José", "أحمد" and "ガ" read the same however they were entered.
 */
export const fold = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

interface Tok { text: string; norm: string; start: number; end: number; seg: number; poss: boolean; used: boolean; neg: boolean; cue: boolean }

/** Words a name lookup never starts from, even when someone has that name. */
const STOP = new Set([
  "the", "a", "an", "my", "our", "your", "his", "her", "their", "its", "this", "that", "these", "those", "it", "us", "them", "him",
  "you", "we", "they", "i", "and", "or", "of", "for", "about", "all", "any", "every", "some", "someone", "anyone", "everyone", "everybody",
  "scratch", "home", "work", "here", "there", "now", "then", "time", "regards", "regard", "respect", "progress", "love", "care", "thanks",
  "meeting", "meetings", "call", "calls", "email", "emails", "mail", "team", "teams", "people", "customer", "customers", "client", "clients",
  "last", "next", "past", "today", "yesterday", "tomorrow", "week", "month", "year", "morning", "night", "lunch", "launch", "review",
  "what", "who", "when", "where", "why", "how", "which", "new", "old", "one", "two", "other", "others", "outside", "inside", "office",
  "not", "no", "except", "without", "excluding",
]);

/**
 * First names that are also everyday words. Read as a name only when written with a
 * capital right after a connector and followed by nothing that makes it a phrase
 * ("from Mark", not "mark as read" or "emails with grace"); otherwise offered.
 */
const COMMON_WORDS = new Set([
  "will", "bill", "mark", "grace", "rose", "hope", "joy", "faith", "dawn", "summer", "autumn", "winter", "april", "may", "june", "august",
  "art", "pat", "sue", "rob", "jack", "frank", "don", "ray", "max", "chase", "hunter", "page", "sky", "river", "lily", "iris", "daisy",
  "ivy", "holly", "ruby", "pearl", "amber", "crystal", "jade", "penny", "sunny", "sandy", "guy", "gene", "bud", "cliff", "dean", "earl",
  "glen", "grant", "lance", "miles", "norm", "drew", "chip", "brook", "heather", "robin", "jay", "wade", "carol", "harmony", "angel",
  "price", "rich", "young", "white", "black", "green", "brown", "gray", "grey", "hall", "king", "long", "short", "lee", "case", "story",
  "bishop", "cook", "baker", "booth", "bush", "church", "field", "fisher", "ford", "fox", "gold", "hill", "lake", "little", "lord",
  "major", "mason", "moon", "park", "rice", "rivers", "rock", "sharp", "snow", "stone", "street", "swift", "wall", "ward", "wise", "wood",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
]);

/**
 * Connected tools whose name is also an everyday word ("slack time", "linear algebra",
 * "work in teams"). Applied only with a capital ("on Slack") or right after a type word
 * ("messages in teams"); otherwise offered.
 */
const ORDINARY_TOOLS = new Set(["slack", "linear", "teams", "notion", "granola", "outlook", "one", "my calendar", "calendar"]);

/** Words that turn what follows into its opposite. */
const NEG_WORDS = new Set(["not", "no", "except", "excluding", "exclude", "excludes", "without", "never", "nor", "cannot", "unless", "minus"]);
const NEG_RE = /^(?:is|are|was|were|do|does|did|wo|have|has|had|ca|could|should|would|must|need)n['’]?t$|^n['’]t$/;
const NEG_PAIRS: [string, string][] = [["other", "than"], ["apart", "from"], ["aside", "from"], ["but", "not"]];

/**
 * Question and filler words that say nothing about which items to find. Once a filter
 * was read they are dropped from the searched words ("what happened last week" lists
 * last week), since every one of them would otherwise have to match.
 */
const FILLER = new Set([
  "what", "whats", "what's", "who", "whom", "whose", "when", "where", "which", "why", "how", "happened", "happen", "happens", "happening",
  "anything", "everything", "something", "stuff", "things", "thing", "show", "find", "get", "give", "list", "see", "tell", "me",
  "did", "do", "does", "is", "are", "was", "were", "be", "been", "has", "have", "had", "there", "any", "all", "the", "a", "an", "i",
  "please", "can", "could", "would", "you", "us", "we", "our", "my", "of", "that", "this", "these", "those", "going", "on", "up",
  "new", "recent", "latest", "some", "lately", "recently",
]);

/**
 * Words that only restate a filter that was read ("people at Initech", "issues assigned to
 * Mia", "on my calendar"): once a filter is read they are not searched for either, since
 * an item rarely says them about itself and each one would otherwise have to match.
 */
const RESTATE = new Set([
  "people", "person", "persons", "folks", "someone", "somebody", "anyone", "anybody", "everyone", "everybody", "stuff", "items",
  "assigned", "sent", "written", "created", "organized", "organised", "owned", "addressed", "cc", "via", "received",
  "calendar", "calendars", "schedule", "agenda", "inbox",
]);

/** Words whose 's is "is", not a possessive ("what's", "who's", "that's"). */
const CONTRACTED = new Set(["what", "who", "where", "when", "how", "that", "there", "here", "it"]);

interface TypeWord { value: string; label: string; strict?: boolean }
/** Plain words for item types. `strict` (a singular) needs a clearer context to open a sentence. */
const TYPE_WORDS: Record<string, TypeWord> = {
  emails: { value: "mail", label: "Emails" }, mails: { value: "mail", label: "Emails" }, "e-mails": { value: "mail", label: "Emails" },
  email: { value: "mail", label: "Emails", strict: true }, mail: { value: "mail", label: "Emails", strict: true }, "e-mail": { value: "mail", label: "Emails", strict: true },
  meetings: { value: "meeting", label: "Meetings" }, meeting: { value: "meeting", label: "Meetings", strict: true },
  events: { value: "event", label: "Calendar events" }, event: { value: "event", label: "Calendar events", strict: true },
  deals: { value: "deal", label: "Deals" }, deal: { value: "deal", label: "Deals", strict: true }, opportunities: { value: "deal", label: "Deals" },
  docs: { value: "doc", label: "Docs" }, doc: { value: "doc", label: "Docs", strict: true }, documents: { value: "doc", label: "Docs" }, document: { value: "doc", label: "Docs", strict: true },
  notes: { value: "note,meeting_note", label: "Notes" }, note: { value: "note,meeting_note", label: "Notes", strict: true },
  tickets: { value: "issue", label: "Tickets and issues" }, ticket: { value: "issue", label: "Tickets and issues", strict: true },
  issues: { value: "issue", label: "Issues" }, issue: { value: "issue", label: "Issues", strict: true },
  tasks: { value: "issue", label: "Tasks" }, task: { value: "issue", label: "Tasks", strict: true }, bugs: { value: "issue", label: "Issues" },
  messages: { value: "message", label: "Messages" }, message: { value: "message", label: "Messages", strict: true },
  chats: { value: "message", label: "Messages" }, dms: { value: "message", label: "Messages" }, chat: { value: "message", label: "Messages", strict: true },
  pages: { value: "doc", label: "Docs" }, page: { value: "doc", label: "Docs", strict: true }, wiki: { value: "doc", label: "Docs", strict: true },
  people: { value: "person", label: "People" }, contacts: { value: "person", label: "People" },
  companies: { value: "company", label: "Companies" }, organizations: { value: "company", label: "Companies" },
};
const OPENABLE = new Set(["deal", "issue"]);
/** Plain words for "has an attachment" on their own, read like a plural type word ("attachments from Priya"). */
const ATTACH_WORDS = new Set(["attachments", "attachment"]);

/** What a word right before a type word adds: "open deals", "past meetings", "my issues", "all emails". */
function modifierOf(w: string, type: string): "open" | "past" | "mine" | "qualifier" | null {
  if (w === "open" && OPENABLE.has(type)) return "open";
  if ((w === "past" || w === "previous") && (type === "meeting" || type === "event" || type === "meeting_note")) return "past";
  if (w === "my" && OPENABLE.has(type)) return "mine";
  if (QUALIFIERS.has(w)) return "qualifier";
  return null;
}
/** Words before a type word that make it a type ("my deals", "unread emails"). */
const QUALIFIERS = new Set(["my", "all", "any", "recent", "latest", "new", "newest", "older", "every"]);
/** Words after a type word that make it a type ("emails from", "deals with"). */
const FOLLOWERS = new Set([
  "from", "by", "with", "to", "about", "in", "on", "at", "that", "which", "where", "i", "me", "sent", "this", "last", "past", "next",
  "since", "during", "before", "after", "between", "mentioning", "regarding", "for", "today", "yesterday", "tomorrow", "and", "or",
  "assigned", "created", "written", "organized", "organised", "owned", "cc", "via", "still", "waiting", "needing",
  "closing", "closes", "due", "starting", "ending", "signed", "scheduled", "updated", "edited", "received", "i've", "ive",
]);
/** Words right before a date that point it at the last change ("pages edited this week"). */
const EDIT_WORDS = new Set(["edited", "updated", "modified", "changed", "touched"]);
/** Words right before a date that point it at when a thing ends or is due ("deals closing this quarter"). */
const DUE_LABEL: Record<string, string> = { closing: "Closing", closes: "Closing", close: "Closing", due: "Due", expiring: "Expiring", expires: "Expiring", renewing: "Renewing", renews: "Renewing" };
const DUE_WORDS = new Set(["closing", "closes", "close", "due", "ending", "ends", "expiring", "expires", "renewing", "renews"]);

/** Connectors before a name or a tool. `any` is from: a person, a company or a tool. */
type Role = "from" | "to" | "with" | "source" | "at" | "any";
const CONNECTORS: [string[], Role][] = [
  [["sent", "by"], "from"], [["written", "by"], "from"], [["created", "by"], "from"], [["organized", "by"], "from"], [["organised", "by"], "from"], [["owned", "by"], "from"],
  [["sent", "to"], "to"], [["assigned", "to"], "to"], [["addressed", "to"], "to"],
  [["from"], "any"], [["by"], "from"], [["to"], "to"], [["cc"], "to"], [["with"], "with"],
  [["in"], "source"], [["on"], "source"], [["via"], "source"], [["inside"], "source"], [["at"], "at"],
];

/** Plain states, longest first. */
const STATES: [string[], string, string][] = [
  [["i", "need", "to", "reply", "to"], "lane:needs-you", "Needs you"], [["i", "need", "to", "answer"], "lane:needs-you", "Needs you"],
  [["i", "need", "to", "reply"], "lane:needs-you", "Needs you"], [["i", "should", "reply", "to"], "lane:needs-you", "Needs you"],
  [["need", "to", "reply", "to"], "lane:needs-you", "Needs you"], [["need", "to", "reply"], "lane:needs-you", "Needs you"],
  [["need", "to", "answer"], "lane:needs-you", "Needs you"], [["needs", "an", "answer"], "lane:needs-you", "Needs you"],
  [["need", "a", "reply"], "lane:needs-you", "Needs you"], [["needs", "reply"], "lane:needs-you", "Needs you"],
  [["waiting", "to", "hear", "back"], "lane:waiting", "Waiting on others"], [["waiting", "for", "them"], "lane:waiting", "Waiting on others"],
  [["waiting", "on", "a", "reply"], "lane:waiting", "Waiting on others"], [["waiting", "for", "an", "answer"], "lane:waiting", "Waiting on others"],
  [["needs", "my", "reply"], "lane:needs-you", "Needs you"], [["needs", "my", "attention"], "lane:needs-you", "Needs you"],
  [["need", "my", "reply"], "lane:needs-you", "Needs you"], [["needs", "my", "answer"], "lane:needs-you", "Needs you"],
  [["waiting", "on", "me"], "lane:needs-you", "Needs you"], [["waiting", "for", "me"], "lane:needs-you", "Needs you"],
  [["waiting", "for", "my", "reply"], "lane:needs-you", "Needs you"], [["needs", "a", "reply"], "lane:needs-you", "Needs you"],
  [["needs", "me"], "lane:needs-you", "Needs you"], [["need", "me"], "lane:needs-you", "Needs you"], [["needing", "me"], "lane:needs-you", "Needs you"],
  [["waiting", "for", "a", "reply"], "lane:waiting", "Waiting on others"], [["waiting", "on", "them"], "lane:waiting", "Waiting on others"],
  [["with", "an", "attachment"], "has:attachment", "With an attachment"], [["with", "attachments"], "has:attachment", "With an attachment"],
  [["with", "attachment"], "has:attachment", "With an attachment"], [["with", "a", "file"], "has:attachment", "With an attachment"],
  [["with", "files"], "has:attachment", "With an attachment"], [["has", "an", "attachment"], "has:attachment", "With an attachment"],
  [["has", "attachments"], "has:attachment", "With an attachment"], [["have", "attachments"], "has:attachment", "With an attachment"],
  [["that", "have", "attachments"], "has:attachment", "With an attachment"],
  [["from", "my", "vips"], "lane:vip", "VIPs"], [["from", "vips"], "lane:vip", "VIPs"], [["vips"], "lane:vip", "VIPs"], [["vip"], "lane:vip", "VIPs"],
  [["unread"], "is:unread", "Unread"], [["upcoming"], "is:upcoming", "Upcoming"], [["unanswered"], "lane:needs-you", "Needs you"],
];
/** States an issue or ticket can be in, read only after an issue type word ("issues in review"). */
const ISSUE_STATES: [string[], string, string][] = [
  [["in", "review"], "in review", "In review"], [["in", "progress"], "in progress", "In progress"], [["in", "backlog"], "backlog", "In backlog"],
  [["in", "the", "backlog"], "backlog", "In backlog"], [["to", "do"], "todo", "To do"], [["todo"], "todo", "To do"], [["blocked"], "blocked", "Blocked"],
  [["on", "hold"], "hold", "On hold"], [["pending"], "pending", "Pending"], [["solved"], "solved", "Solved"],
];

/** States whose words hold a negation ("I haven't replied to"): read whole, before the negation turns them around. */
const NEG_STATES: [string[], string, string][] = [
  [["i", "haven't", "replied", "to"], "lane:needs-you", "Needs you"], [["i", "havent", "replied", "to"], "lane:needs-you", "Needs you"],
  [["i", "have", "not", "replied", "to"], "lane:needs-you", "Needs you"], [["i", "haven't", "answered"], "lane:needs-you", "Needs you"],
  [["i", "didn't", "reply", "to"], "lane:needs-you", "Needs you"], [["i", "haven't", "replied"], "lane:needs-you", "Needs you"],
  [["i", "havent", "replied"], "lane:needs-you", "Needs you"], [["i", "didn't", "reply"], "lane:needs-you", "Needs you"],
  [["haven't", "replied", "to"], "lane:needs-you", "Needs you"], [["not", "replied", "to"], "lane:needs-you", "Needs you"],
  [["haven't", "replied"], "lane:needs-you", "Needs you"], [["not", "replied"], "lane:needs-you", "Needs you"],
  [["i", "haven't", "answered", "yet"], "lane:needs-you", "Needs you"], [["i", "havent", "answered"], "lane:needs-you", "Needs you"],
  [["i", "have", "not", "answered"], "lane:needs-you", "Needs you"], [["haven't", "answered"], "lane:needs-you", "Needs you"],
  [["not", "answered"], "lane:needs-you", "Needs you"], [["i", "didn't", "answer"], "lane:needs-you", "Needs you"],
  [["haven't", "heard", "back"], "lane:waiting", "Waiting on others"], [["havent", "heard", "back"], "lane:waiting", "Waiting on others"],
  [["not", "heard", "back"], "lane:waiting", "Waiting on others"], [["no", "reply", "yet"], "lane:waiting", "Waiting on others"],
  [["no", "answer", "yet"], "lane:waiting", "Waiting on others"], [["no", "response", "yet"], "lane:waiting", "Waiting on others"],
];

// ---------- the index ----------

interface Index {
  full: Map<string, VocabEntity[]>;
  /** first words of people, whole one-word names, company names and domain stems */
  first: Map<string, VocabEntity[]>;
  /** last names of people with two or more words: never applied alone */
  last: Map<string, VocabEntity[]>;
  email: Map<string, VocabEntity>;
  domain: Map<string, VocabEntity>;
  platforms: Map<string, string[]>; // folded name -> slugs (connected only)
}

const indexes = new WeakMap<object, Index>();

function push<K, V>(m: Map<K, V[]>, k: K, v: V) { const a = m.get(k); if (!a) m.set(k, [v]); else if (!a.includes(v)) a.push(v); }

/** A name as the words it is looked up by. */
export function nameWords(name: string): string[] {
  return fold(name).replace(/[^\p{L}\p{N}'’.&@ -]/gu, " ").split(/\s+/).filter(Boolean);
}

function indexEntities(ents: VocabEntity[], platforms: string[]): Index {
  const ix: Index = { full: new Map(), first: new Map(), last: new Map(), email: new Map(), domain: new Map(), platforms: new Map() };
  for (const e of ents) {
    const words = nameWords(e.name);
    if (!words.length) continue;
    push(ix.full, words.join(" "), e);
    push(ix.first, words[0]!, e);
    if (e.type === "person" && words.length >= 2) push(ix.last, words[words.length - 1]!.replace(/\.$/, ""), e);
    if (e.email) ix.email.set(fold(e.email), e);
    if (e.domain) {
      ix.domain.set(fold(e.domain), e);
      if (e.type === "company") push(ix.first, fold(e.domain).split(".")[0]!, e);
    }
  }
  const extra: Record<string, string[]> = {
    outlook: ["outlook-mail", "outlook-calendar"], gcal: ["google-calendar"], "google mail": ["gmail"],
    "ms teams": ["teams"], "microsoft teams": ["teams"], "my calendar": ["google-calendar", "outlook-calendar"],
  };
  const connected = new Set(platforms);
  for (const slug of connected) {
    push(ix.platforms, fold(slug.replace(/-/g, " ")), slug);
    push(ix.platforms, fold(platformName(slug)), slug);
    if (PLATFORM_NAMES[slug]) push(ix.platforms, fold(PLATFORM_NAMES[slug]!), slug);
  }
  for (const [name, slugs] of Object.entries(extra)) for (const s of slugs) if (connected.has(s)) push(ix.platforms, name, s);
  return ix;
}

function indexOf(v: Vocab): Index {
  const hit = indexes.get(v);
  if (hit) return hit;
  const ix = indexEntities(v.entities, v.platforms);
  indexes.set(v, ix);
  return ix;
}

// ---------- tokens ----------

/** Characters that are not free sentence text: filters, quoted runs, negated words, OR. */
function maskOf(text: string): boolean[] {
  const mask = new Array<boolean>(text.length).fill(false);
  for (const t of lexQuery(text)) {
    const s = t.text;
    if (s === "OR" || s.startsWith('"') || s.includes('"') || (s.startsWith("-") && s.length > 1) || /^[a-z]+:./i.test(s)) {
      for (let i = t.start; i < t.start + s.length; i++) mask[i] = true;
    }
  }
  return mask;
}

function tokenize(text: string, mask: boolean[]): Tok[] {
  const out: Tok[] = [];
  // marks (\p{M}) belong to the word they sit on: Arabic harakat, Devanagari vowel signs
  const re = /[\p{L}\p{N}@][\p{L}\p{M}\p{N}@._'’&-]*/gu;
  let seg = 0;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    let start = m.index, end = m.index + m[0].length;
    let masked = false;
    for (let i = start; i < end; i++) if (mask[i]) { masked = true; break; }
    // #deals, @priya, /path: a channel, a handle or a path, never a sentence word
    if (start > 0 && /[#@/\\]/.test(text[start - 1]!)) masked = true;
    const gap = text.slice(last, start);
    // anything but spaces between two words (a comma, a question mark, a filter) ends a run
    // (invisible format marks, like a right-to-left mark or a zero-width space, count as space)
    if (masked || /[^\s]/.test(gap.replace(/[\s\p{Cf}]/gu, ""))) seg++;
    last = end;
    if (masked) continue;
    let raw = text.slice(start, end);
    let poss = false;
    const p = /['’]s$/i.exec(raw);
    if (p && raw.length > 2) { poss = true; raw = raw.slice(0, -2); }
    const trail = /[._'’&-]+$/.exec(raw);
    if (trail && !raw.includes("@")) { raw = raw.slice(0, trail.index); }
    else if (trail && raw.includes("@")) raw = raw.replace(/[.]+$/, "");
    if (!raw) continue;
    out.push({ text: raw, norm: fold(raw), start, end: start + raw.length + (poss ? 2 : 0), seg, poss, used: false, neg: false, cue: false });
    // a trailing comma or question mark stays in the next gap
    end = start + raw.length + (poss ? 2 : 0);
    last = end;
  }
  // negation: a cue ("not", "except", "isn't", "other than") turns the rest of its run around,
  // so nothing after it is ever applied as the positive filter
  for (let i = 0; i < out.length; i++) {
    const t = out[i]!;
    const pair = i + 1 < out.length && out[i + 1]!.seg === t.seg && NEG_PAIRS.some(([a, b]) => t.norm === a && out[i + 1]!.norm === b);
    if (!(NEG_WORDS.has(t.norm) || NEG_RE.test(t.norm) || pair)) continue;
    const cueEnd = pair ? i + 1 : i;
    for (let k = i; k <= cueEnd; k++) out[k]!.cue = true;
    for (let k = i; k < out.length && out[k]!.seg === t.seg; k++) out[k]!.neg = true;
  }
  return out;
}

/** Not a lowercase letter first: "Priya", "PRIYA", and scripts with no case ("أحمد", "陈伟"). */
const capitalized = (t: { text: string }) => !/^\p{Ll}/u.test(t.text);

// ---------- the reader ----------

export interface UnderstandOptions {
  now?: Date; tz?: string | null;
  /** People and companies found in the database for this sentence, beyond the in-memory list (exact name or address). */
  extra?: VocabEntity[];
}

type UBase = Omit<Understood, "phrase" | "start" | "end">;
/** What a connector's target reads as: applied, offered, or nothing (the words stay). */
type Res = { t: "apply"; end: number; u: UBase } | { t: "offer"; end: number; why: UnderstandSuggestion["why"]; choices: UnderstandChoice[] };

/**
 * Reads plain phrases out of `text` against `vocab`. Pure and fast (no I/O):
 * the server runs it on every search, and it is safe in the browser.
 */
export function understandQuery(text: string, vocab: Vocab, opts: UnderstandOptions = {}): Understanding {
  const now = opts.now ?? new Date();
  const ix = indexOf(vocab);
  const ex = opts.extra?.length ? indexEntities(opts.extra, []) : null;
  const look = (m: "full" | "first" | "last", k: string): VocabEntity[] => {
    const a = ix[m].get(k) ?? [];
    const b = ex?.[m].get(k) ?? [];
    return b.length ? dedupe([...a, ...b]) : a;
  };
  const byEmail = (k: string) => ix.email.get(k) ?? ex?.email.get(k);
  const byDomain = (k: string) => ix.domain.get(k) ?? ex?.domain.get(k);
  const mask = maskOf(text);
  const toks = tokenize(text, mask);
  const understood: Understood[] = [];
  const suggestions: UnderstandSuggestion[] = [];
  /** Starts of type words dropped because a tool already implies them. */
  const implied = new Set<number>();

  // typed filters win: their keys are never inferred
  const typed = new Set<OperatorKey>();
  for (const c of parseQuery(text, now, opts.tz).clauses) if (c.kind === "op") typed.add(c.key);
  const datesTyped = ["before", "after", "on", "during", "updated"].some((k) => typed.has(k as OperatorKey));

  // while reading what a negation cue points at, negated words may be looked at (never applied)
  let readingNeg = false;
  const span = (a: number, b: number) => ({ start: toks[a]!.start, end: toks[b]!.end, phrase: text.slice(toks[a]!.start, toks[b]!.end) });
  const free = (a: number, n: number) => {
    if (a < 0 || a + n > toks.length) return false;
    for (let i = a; i < a + n; i++) {
      const t = toks[i]!;
      if (t.used || t.seg !== toks[a]!.seg || t.cue || (t.neg && !readingNeg)) return false;
    }
    return true;
  };
  const use = (a: number, b: number) => { for (let i = a; i <= b; i++) toks[i]!.used = true; };
  const add = (a: number, b: number, u: UBase) => {
    // the same filter twice ("priya's priya's") is one chip; the repeat stays as words
    if (understood.some((x) => x.filter === u.filter)) return;
    use(a, b); understood.push({ ...span(a, b), ...u });
  };
  const suggest = (a: number, b: number, why: UnderstandSuggestion["why"], choices: UnderstandChoice[]) => {
    use(a, b);
    if (suggestions.some((s) => s.choices.length === choices.length && s.choices.every((c, i) => c.filter === choices[i]!.filter))) return;
    suggestions.push({ ...span(a, b), why, choices });
  };
  const words = (a: number, n: number) => toks.slice(a, a + n).map((t) => t.norm);
  const seq = (a: number, w: string[]) => free(a, w.length) && words(a, w.length).every((x, i) => x === w[i]) && !toks[a + w.length - 1]!.poss;
  /** What comes after token `b` leaves a name or tool on its own: nothing, a new run, a phrase already read, or a linking word. */
  const clearAfter = (b: number) => {
    const n = toks[b + 1];
    return !n || n.seg !== toks[b]!.seg || n.used || n.cue || FOLLOWERS.has(n.norm) || !!TYPE_WORDS[n.norm];
  };

  // where dates sit, so a negation never swallows one ("not from Priya last week")
  const dateSpans = datesTyped ? [] : findDates(text, now, opts.tz, (i) => mask[i] === true);
  const inDate = (t: Tok) => dateSpans.some((d) => t.start >= d.start && t.start < d.end);

  // 0. states that hold a negation ("emails I haven't replied to"), read whole before step 3 turns them around
  if (!typed.has("lane")) {
    for (let i = 0; i < toks.length; i++) {
      for (const [w, filter, label] of NEG_STATES) {
        if (i + w.length > toks.length) continue;
        const run = toks.slice(i, i + w.length);
        if (run.some((t) => t.used || t.seg !== toks[i]!.seg || t.poss) || !run.every((t, k) => t.norm.replace(/’/g, "'") === w[k])) continue;
        // the cue was this state's own; what follows it in the run is not negated by it
        for (let k = i + w.length; k < toks.length && toks[k]!.seg === toks[i]!.seg; k++) { if (toks[k]!.cue) break; toks[k]!.neg = false; }
        for (const t of run) { t.cue = false; t.neg = false; }
        add(i, i + w.length - 1, { filter, keys: ["lane"], label, kind: "state" });
        break;
      }
    }
  }

  // 3 (read before dates). negation: "not from Priya", "except in Slack", "without Lena" are offered as the
  // opposite filter, never applied; anything else after a cue stays as words
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (!t.cue || t.used) continue;
    let c = i;
    while (c + 1 < toks.length && toks[c + 1]!.cue && toks[c + 1]!.seg === t.seg) c++;
    const j = c + 1;
    if (j >= toks.length || toks[j]!.seg !== t.seg || toks[j]!.used) continue;
    readingNeg = true;
    let r: Res | null = null;
    for (const [w, role] of CONNECTORS) {
      if (!seq(j, w) || !free(j + w.length, 1)) continue;
      r = resolveTarget(j + w.length, role);
      if (r) break;
    }
    // "without Lena", "except Globex", "no Slack": the cue itself is the connector
    if (!r && ["without", "except", "excluding", "exclude", "excludes", "minus", "no", "than", "not"].includes(toks[c]!.norm)) r = resolveTarget(j, "with") ?? resolveTarget(j, "source");
    readingNeg = false;
    const not = (l: string) => `Not ${l.charAt(0).toLowerCase()}${l.slice(1)}`;
    // the negation governs its target only: "not from Priya last week" still reads last week
    const release = (end: number) => { for (let x = end + 1; x < toks.length && toks[x]!.seg === t.seg && !toks[x]!.cue; x++) toks[x]!.neg = false; };
    if (r && r.t === "apply" && !joinAt(r.end)) {
      const u = r.u;
      if (u.keys.some((k) => typed.has(k))) continue;
      suggest(i, r.end, "negated", [{ label: not(u.label), filter: `-${u.filter}`, detail: null, kind: u.kind }]);
      release(r.end);
      continue;
    }
    if (r && r.t === "offer" && !joinAt(r.end)) {
      // "not from Priya" where two Priyas exist: each one, as its exclusion
      suggest(i, r.end, "negated", r.choices.map((ch) => ({ ...ch, label: not(ch.label), filter: `-${ch.filter}` })));
      release(r.end);
      continue;
    }
    // "except emails", "not meetings", "no attachments": a type, as its exclusion
    let k = j;
    while (k < toks.length && toks[k]!.seg === t.seg && (["about", "mentioning", "regarding", "any", "the", "a", "an", "of", "on"].includes(toks[k]!.norm) || toks[k]!.cue)) k++;
    const tk = toks[k];
    if (tk && tk.seg === t.seg && !tk.used) {
      const tw = TYPE_WORDS[tk.norm];
      const last = toks[k + 1]?.seg === t.seg ? k + 1 : k;
      if (ATTACH_WORDS.has(tk.norm) && !typed.has("has")) { suggest(i, k, "negated", [{ label: "Without an attachment", filter: "-has:attachment", detail: null, kind: "state" }]); release(k); continue; }
      if (tw && !typed.has("type") && (k === last || inDate(toks[k + 1]!))) { suggest(i, k, "negated", [{ label: not(tw.label), filter: `-type:${tw.value}`, detail: null, kind: "type" }]); release(k); continue; }
    }
    // any other words ("except pricing", "not about the renewal"): never searched for; their exclusion is offered
    let e = k;
    while (e + 1 < toks.length && toks[e + 1]!.seg === t.seg && !toks[e + 1]!.used && !toks[e + 1]!.cue && !inDate(toks[e + 1]!)) e++;
    if (k < toks.length && inDate(toks[k]!)) continue; // "not in October": dropped, never read as the date
    release(e);
    const run = toks.slice(k, e + 1);
    // a run with a connector, a type, a state or a name in it ("not emails from Priya") is only dropped: its
    // exclusion as plain words would not say what was meant
    const plain = run.every((x) => !TYPE_WORDS[x.norm] && !CONNECTORS.some(([w]) => w[0] === x.norm) && !STATES.some(([w]) => w.length === 1 && w[0] === x.norm) && !look("first", x.norm).length && !look("full", x.norm).length);
    const kept = run.filter((x) => !x.used && !STOP.has(x.norm) && !FILLER.has(x.norm)).map((x) => x.text);
    if (!plain || !kept.length || kept.length > 4) continue;
    const w = kept.length === 1 && /^[\p{L}\p{N}]+$/u.test(kept[0]!) ? kept[0]! : `"${kept.join(" ").replace(/"/g, "")}"`;
    suggest(i, e, "negated", [{ label: `Not mentioning ${kept.join(" ")}`, filter: `-${w}`, detail: null, kind: "state" }]);
  }

  const chanDrop: { start: number; end: number; filter: string }[] = [];
  // 0b. a channel: "in #deals", "#deals", "in the deals channel" (container:, the same filter MCP and in:#deals use)
  if (!typed.has("container") && vocab.channels?.length) {
    const chans = new Set(vocab.channels);
    const re = /(?:\b(?:in|on|from)\s+(?:the\s+)?)?#([\p{L}\p{N}_-]+)(?:\s+channel\b)?|\b(?:in|on|from)\s+(?:the\s+)?([\p{L}\p{N}_-]+)\s+channel\b/giu;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const name = fold(m[1] ?? m[2] ?? "");
      const a = m.index, b = m.index + m[0].length;
      if (!chans.has(name) || mask.slice(a, b).some(Boolean)) continue;
      const inside = toks.filter((t) => t.start >= a && t.end <= b);
      if (inside.some((t) => t.used)) continue;
      // "not in #deals": offered as the exclusion, and never searched for
      const prevTok = [...toks].reverse().find((t) => t.end <= a);
      if (inside.some((t) => t.neg || t.cue) || (prevTok && (prevTok.neg || prevTok.cue) && !/[,;?]/.test(text.slice(prevTok.end, a)))) {
        for (const t of inside) t.used = true;
        suggestions.push({ phrase: m[0], start: a, end: b, why: "negated", choices: [{ label: `Not in #${name}`, filter: `-container:${name}`, detail: null, kind: "source" }] });
        chanDrop.push({ start: a, end: b, filter: "" });
        continue;
      }
      for (const t of inside) t.used = true;
      understood.push({ phrase: m[0], start: a, end: b, filter: `container:${name}`, keys: ["container"], label: `In #${name}`, kind: "source" });
    }
  }

  // 1. dates
  if (!datesTyped) {
    for (const d of dateSpans) {
      const a = toks.findIndex((t) => t.start >= d.start && t.start < d.end);
      let b = a;
      while (b + 1 < toks.length && toks[b + 1]!.start < d.end) b++;
      if (a < 0 || !free(a, b - a + 1)) continue;
      const dateChoice: UnderstandChoice = { label: d.label, filter: d.insert, detail: null, kind: "date" };
      const altChoice: UnderstandChoice[] = d.alt ? [{ label: d.alt.label, filter: d.alt.insert, detail: null, kind: "date" }] : [];
      // "from May": a month, or May the person
      if (d.month && toks[a]!.norm === "from" && !typed.has("from")) {
        const people = look("first", fold(d.month)).filter((e) => !e.isSelf);
        if (people.length) {
          suggest(a, b, "name_or_date", [dateChoice, ...altChoice, ...people.slice(0, 3).map((e) => entityChoice(e, "from"))]);
          continue;
        }
      }
      // a month still ahead this year: last year's, or this year's
      if (altChoice.length) { suggest(a, b, "which_year", [dateChoice, ...altChoice]); continue; }
      // "closing this quarter", "due next week": the date a thing ends or is due, not when it was made
      // "edited this week": when it last changed, not when it was made
      const edited = a > 0 && toks[a - 1]!.seg === toks[a]!.seg && !toks[a - 1]!.used && EDIT_WORDS.has(toks[a - 1]!.norm) && !typed.has("updated") ? updatedOf(d) : null;
      if (edited) { add(a - 1, b, { filter: edited, keys: ["updated"], label: `Changed ${d.label.charAt(0).toLowerCase()}${d.label.slice(1)}`, kind: "date" }); continue; }
      const due = a > 0 && toks[a - 1]!.seg === toks[a]!.seg && !toks[a - 1]!.used && DUE_WORDS.has(toks[a - 1]!.norm) ? duringOf(d) : null;
      if (due) { add(a - 1, b, { filter: due, keys: ["during"], label: `${DUE_LABEL[toks[a - 1]!.norm] ?? "Ending"} ${d.label.charAt(0).toLowerCase()}${d.label.slice(1)}`, kind: "date" }); continue; }
      add(a, b, { filter: d.insert, keys: d.insert.split(" ").map((x) => x.split(":")[0] as OperatorKey), label: d.label, kind: "date" });
    }
  }

  // 2. plain states
  for (let i = 0; i < toks.length; i++) {
    for (const [w, filter, label] of STATES) {
      const key = filter.split(":")[0] as OperatorKey;
      if (typed.has(key) || !seq(i, w)) continue;
      add(i, i + w.length - 1, { filter, keys: [key], label, kind: "state" });
      break;
    }
  }

  // 4. connector + a person, a company or a tool (one, or a list joined by and, or, commas)
  for (let i = 0; i < toks.length; i++) {
    for (const [w, role] of CONNECTORS) {
      if (!seq(i, w)) continue;
      const j = i + w.length;
      if (!free(j, 1) || toks[j]!.seg !== toks[i]!.seg) continue;
      const r = resolveTarget(j, role);
      if (r === null) continue;
      const l = withList(r, role);
      if (l === "leave") break;
      if (l.t === "apply") { if (!l.u.keys.some((k) => typed.has(k))) add(i, l.end, l.u); }
      else suggest(i, l.end, l.why, l.choices);
      break;
    }
  }

  // 5. possessives: "Priya's emails"
  for (let i = 0; i < toks.length; i++) {
    if (!toks[i]!.poss || toks[i]!.used || toks[i]!.neg || typed.has("from")) continue;
    for (const n of [3, 2, 1]) {
      const a = i - n + 1;
      if (!free(a, n)) continue;
      const key = words(a, n).join(" ");
      if (n === 1 && STOP.has(key)) continue;
      const full = look("full", key);
      const first = n === 1 ? look("first", key) : [];
      let hits = sameHumans(dedupe([...full, ...first]));
      const lastOnly = !hits.length && n === 1;
      if (lastOnly) hits = sameHumans(look("last", key));
      if (!hits.length) continue;
      // "Priya's emails" are from her; "Priya's multi-year discount" is about her, wherever it sits
      const nx = toks[i + 1];
      const typeNext = !!nx && nx.seg === toks[i]!.seg && (!!TYPE_WORDS[nx.norm] || ATTACH_WORDS.has(nx.norm) || (nx.norm === "meeting" && toks[i + 2]?.norm === "notes"));
      const k = (e: VocabEntity): OperatorKey => (e.type === "company" || !typeNext ? "with" : "from");
      const loose = lastOnly || (n === 1 && !full.length && COMMON_WORDS.has(key) && !capitalized(toks[a]!));
      if (hits.length === 1 && !loose) add(a, i, entityUnderstood(hits[0]!, k(hits[0]!)));
      else suggest(a, i, lastOnly ? "last_name" : loose ? "common_word" : "same_name", hits.slice(0, 4).map((e) => entityChoice(e, k(e))));
      break;
    }
  }

  // 5b. "the contract Marco sent", "the questionnaire Globex sent": a name right before sent or wrote
  if (!typed.has("from")) {
    for (let i = 1; i < toks.length; i++) {
      if (!["sent", "wrote", "shared", "forwarded", "emailed"].includes(toks[i]!.norm) || toks[i]!.used || toks[i]!.neg) continue;
      for (const n of [3, 2, 1]) {
        const a = i - n;
        if (a < 0 || !free(a, n) || toks[i]!.seg !== toks[a]!.seg || toks[i - 1]!.poss) continue;
        const key = words(a, n).join(" ");
        if (n === 1 && (STOP.has(key) || FILLER.has(key))) continue;
        const full = look("full", key);
        const hits = sameHumans(dedupe([...full, ...(n === 1 ? look("first", key) : [])]));
        if (!hits.length) continue;
        const word = n === 1 && !full.length && COMMON_WORDS.has(key) && !capitalized(toks[a]!);
        if (hits.length === 1 && !word && !hits[0]!.isSelf) {
          const e = hits[0]!;
          add(a, i, entityUnderstood(e, e.type === "company" ? "with" : "from"));
        } else if (hits.length > 1) suggest(a, a + n - 1, "same_name", hits.slice(0, 4).map((e) => entityChoice(e, e.type === "company" ? "with" : "from")));
        break;
      }
    }
  }

  // 6. "slack messages", "Linear issues": a connected tool right before a type word
  if (!typed.has("source")) {
    for (let i = 0; i < toks.length; i++) {
      for (const n of [2, 1]) {
        if (!free(i, n + 1)) continue;
        const slugs = ix.platforms.get(words(i, n).join(" "));
        const tw = TYPE_WORDS[toks[i + n]!.norm];
        if (!slugs || !tw) continue;
        add(i, i + n - 1, sourceUnderstood(slugs));
        break;
      }
    }
  }

  // 6b. "who works at Northwind", "people who work at Globex": the people there
  if (!typed.has("type")) {
    for (let i = 0; i < toks.length; i++) {
      for (const w of [["who", "works", "at"], ["who", "work", "at"], ["works", "at"], ["working", "at"], ["employees", "at"]]) {
        if (!seq(i, w.slice(0, -1)) || !toks[i + w.length - 1]?.used || toks[i + w.length - 1]!.norm !== "at") continue;
        if (!understood.some((u) => u.kind === "company" && u.start === toks[i + w.length - 1]!.start)) continue;
        add(i, i + w.length - 2, { filter: "type:person", keys: ["type"], label: "People", kind: "type" });
        break;
      }
    }
  }

  // 7. type words, with "open", "past", "my" or "all" in front of them; "attachments" reads the same way
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (t.used || t.poss || t.neg) continue;
    const attach = ATTACH_WORDS.has(t.norm);
    if (typed.has(attach ? "has" : "type")) continue;
    const compound = !attach && (seq(i, ["meeting", "notes"]) || seq(i, ["call", "notes"]));
    const calendarEvents = !attach && !compound && (seq(i, ["calendar", "events"]) || seq(i, ["calendar", "event"]) || seq(i, ["calendar", "invites"]));
    const tw: TypeWord | undefined = attach ? { value: "", label: "With an attachment", strict: t.norm === "attachment" } : compound ? { value: "meeting_note", label: "Meeting notes" } : calendarEvents ? { value: "event", label: "Calendar events" } : TYPE_WORDS[t.norm];
    if (!tw) continue;
    const last = compound || calendarEvents ? i + 1 : i;
    const prev = i > 0 && toks[i - 1]!.seg === t.seg ? toks[i - 1]! : null;
    const next = last + 1 < toks.length && toks[last + 1]!.seg === t.seg ? toks[last + 1]! : null;
    const mod = prev && !prev.used && !prev.neg && !attach ? modifierOf(prev.norm, tw.value) : null;
    const afterRead = !!prev && prev.used;
    const andType = !!prev && !prev.used && (prev.norm === "and" || prev.norm === "or") && i >= 2 && understood.some((u) => u.kind === "type" && u.end === toks[i - 2]!.end);
    // a plural opens a sentence before any linking word ("emails about pricing"); a singular
    // ("deal", "email") only before a phrase that was read ("meeting with Lena", not "deal with it")
    const nextOk = !next || next.used || (!tw.strict && (FOLLOWERS.has(next.norm) || next.cue));
    if (!(mod || afterRead || andType || (!prev && nextOk))) continue;
    if (attach) { add(i, i, { filter: "has:attachment", keys: ["has"], label: tw.label, kind: "state" }); continue; }
    let a = i;
    if (mod === "open" && !typed.has("is")) add(i - 1, i - 1, { filter: "is:open", keys: ["is"], label: "Open", kind: "state" });
    else if (mod === "past" && !typed.has("is")) add(i - 1, i - 1, { filter: "is:past", keys: ["is"], label: "Past", kind: "state" });
    else if (mod === "mine" && !typed.has("is")) add(i - 1, i - 1, { filter: "is:mine", keys: ["is"], label: "Yours", kind: "state" });
    else if (mod || andType) a = i - 1; // "all emails", "and messages": the word goes with the type
    add(a, last, { filter: `type:${tw.value}`, keys: ["type"], label: tw.label, kind: "type" });
  }

  // 7b. "issues in review", "tickets in progress": a state an issue can be in, right after an issue type
  if (!typed.has("status") && understood.some((u) => u.kind === "type" && u.filter === "type:issue")) {
    for (let i = 0; i < toks.length; i++) {
      for (const [w, value, label] of ISSUE_STATES) {
        if (!seq(i, w)) continue;
        add(i, i + w.length - 1, { filter: `status:${quoteValue(value)}`, keys: ["status"], label, kind: "state" });
        break;
      }
    }
  }

  // 8. "emails I sent"
  if (!typed.has("from")) {
    for (let i = 0; i < toks.length; i++) {
      if (seq(i, ["i", "sent"]) || seq(i, ["i", "wrote"])) add(i, i + 1, { filter: "from:me", keys: ["from"], label: "From you", kind: "person" });
      // "emails I sent to Owen": "sent to Owen" was read as To, and the I still means from you
      else if (free(i, 1) && toks[i]!.norm === "i" && toks[i + 1]?.used && toks[i + 1]!.seg === toks[i]!.seg && toks[i + 1]!.norm === "sent") add(i, i, { filter: "from:me", keys: ["from"], label: "From you", kind: "person" });
    }
  }

  // 9. "what's on my calendar tomorrow": with a date read, the calendar word means calendar events
  if (!typed.has("type") && !typed.has("source") && understood.some((u) => u.kind === "date") && !understood.some((u) => u.kind === "type" || u.kind === "source")) {
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i]!;
      if (t.neg || t.cue || !["calendar", "schedule", "agenda"].includes(t.norm)) continue;
      // "on my calendar": an offered tool for the same words gives way to the plain reading
      const k = suggestions.findIndex((s) => s.why === "maybe_tool" && s.start <= t.start && s.end >= t.end);
      if (t.used && k < 0) continue;
      let a = i;
      if (k >= 0) { a = toks.findIndex((x) => x.start === suggestions[k]!.start); suggestions.splice(k, 1); for (let x = a; x <= i; x++) toks[x]!.used = false; }
      if (a < 0) a = i;
      add(a, i, { filter: "type:event", keys: ["type"], label: "Calendar events", kind: "type" });
      break;
    }
  }

  // 9b. "anything from Owen", "everything from Globex": with no kind of item named, "from" means anything
  // they are part of (the board-prep meeting Owen attends), not only what they sent
  if (!understood.some((u) => u.kind === "type") && !typed.has("with")) {
    for (const u of understood) {
      if (!u.filter.startsWith("from:") || u.filter === "from:me" || (u.kind !== "person" && u.kind !== "company")) continue;
      const at = toks.findIndex((t) => t.start === u.start);
      const prev = at > 0 ? toks[at - 1]! : null;
      if (!prev || prev.seg !== toks[at]!.seg || !["anything", "everything", "something", "stuff", "all"].includes(prev.norm)) continue;
      if (understood.some((x) => x.filter.startsWith("with:"))) continue;
      u.filter = `with:${u.filter.slice(5)}`; u.keys = ["with"]; u.label = `With ${u.label.replace(/^From /, "")}`;
    }
  }

  // 10. a type word a tool already implies is not a second chip ("slack messages" is In Slack)
  dropImpliedTypes();

  understood.sort((a, b) => a.start - b.start);
  suggestions.sort((a, b) => a.start - b.start);
  // once a filter was read, question and filler words are not searched for, nor words that only
  // restate it ("people at Initech", "issues assigned to Mia", a type word said twice)
  const readTypes = new Set(understood.filter((u) => u.kind === "type").map((u) => u.filter.slice(5)));
  const restates = (t: Tok) => RESTATE.has(t.norm) || (!!TYPE_WORDS[t.norm] && readTypes.has(TYPE_WORDS[t.norm]!.value)) || (ix.platforms.has(t.norm) && understood.some((u) => u.kind === "source"));
  const inRead = (t: Tok) => understood.some((u) => t.start >= u.start && t.end <= u.end);
  const negated = toks.filter((t) => (t.neg || t.cue) && !inRead(t));
  const dropped = understood.length || negated.length
    ? toks.filter((t) => !inRead(t) && !t.neg && (!t.poss || CONTRACTED.has(t.norm)) && ((!t.used && FILLER.has(t.norm)) || restates(t))).map((t) => ({ start: t.start, end: t.end, filter: "" }))
    : [];
  // a negation and everything it governs is never searched for: "emails without Priya" must not find Priya
  // by her name either (its exclusion is offered as a suggestion)
  for (const t of negated) dropped.push({ start: t.start, end: t.end, filter: "" });
  dropped.push(...chanDrop);
  for (const t of toks) if (implied.has(t.start)) dropped.push({ start: t.start, end: t.end, filter: "" });
  return { understood, suggestions, query: applyUnderstood(text, [...understood, ...dropped]) };

  // ----- helpers that read toks -----

  /** Removes a type chip whose kinds a source chip already holds all of; its words stay out of the search. */
  function dropImpliedTypes() {
    const kinds = vocab.kinds;
    if (!kinds) return;
    const src = understood.find((u) => u.kind === "source");
    if (!src) return;
    const slugs = src.filter.slice(3).split(",");
    const held = new Set(slugs.flatMap((p) => (kinds[p] ?? []).filter((k) => k !== "person" && k !== "company")));
    if (!held.size || slugs.some((p) => !kinds[p])) return;
    for (let k = understood.length - 1; k >= 0; k--) {
      const u = understood[k]!;
      if (u.kind !== "type") continue;
      const want = u.filter.slice(5).split(",").flatMap((v) => TYPE_KINDS[v] ?? [v]);
      if (![...held].every((h) => want.includes(h))) continue;
      understood.splice(k, 1);
      for (const t of toks) if (t.start >= u.start && t.end <= u.end && !FILLER.has(t.norm)) implied.add(t.start);
    }
  }

  /** "and", "or" or a comma right after token `b`, and where the next name starts. */
  function joinAt(b: number): { next: number; word: "and" | "or" | "," } | null {
    const k = b + 1;
    const n = toks[k];
    if (!n || n.used) return null;
    const gap = text.slice(toks[b]!.end, n.start);
    if (/^\s*,\s*$/.test(gap)) {
      if ((n.norm === "and" || n.norm === "or") && toks[k + 1] && toks[k + 1]!.seg === n.seg) return { next: k + 1, word: n.norm };
      return { next: k, word: "," };
    }
    if (/^\s+$/.test(gap) && n.seg === toks[b]!.seg && (n.norm === "and" || n.norm === "or") && toks[k + 1] && toks[k + 1]!.seg === n.seg) return { next: k + 1, word: n.norm };
    return null;
  }

  /**
   * "from Priya and Marco", "with Initech, Umbrella", "to Lena or Sam". Several values of one
   * key match any of them, so a list is applied when that is what it means: "from" (one item
   * has one sender) or a list joined by "or". "with A and B" or "to A, B" could mean both at
   * once, which a filter cannot say, so it is offered. A list with a word that is not a clear
   * name in it is left as words.
   */
  function withList(first: Res, role: Role): Res | "leave" {
    const jn0 = joinAt(first.end);
    if (!jn0) return first;
    const resolved = (r: Res | null) => (r && r.t === "apply" && (r.u.kind === "person" || r.u.kind === "company") ? r : null);
    const head = resolved(first);
    const next0 = resolveTarget(jn0.next, role === "source" ? "any" : role);
    // "from Priya and the team", "from Priya, last week": not a list. A name-like word that
    // matches nobody ("from Hannah, Felix") could still be one: then nothing is applied.
    const nt = toks[jn0.next]!;
    if (!next0 && capitalized(nt) && !STOP.has(nt.norm) && !TYPE_WORDS[nt.norm] && /\p{L}/u.test(nt.text)) return "leave";
    if (!next0 || (next0.t === "apply" && next0.u.kind !== "person" && next0.u.kind !== "company")) return first;
    if (!head) return "leave";
    const parts: (Res & { t: "apply" })[] = [head];
    const joins: string[] = [];
    let jn: ReturnType<typeof joinAt> = jn0;
    let r: Res | null = next0;
    while (jn && parts.length < 6) {
      const ok = resolved(r);
      if (!ok || ok.u.keys[0] !== head.u.keys[0]) return "leave";
      parts.push(ok);
      joins.push(jn.word);
      jn = joinAt(ok.end);
      r = jn ? resolveTarget(jn.next, role === "source" ? "any" : role) : null;
      if (jn && (!r || (r.t === "apply" && r.u.kind !== "person" && r.u.kind !== "company"))) break;
    }
    const key = head.u.keys[0]!;
    const values = parts.map((p) => p.u.filter.slice(key.length + 1));
    const names = parts.map((p) => p.u.label.replace(/^(From|To|With) /, ""));
    const listed = names.length === 2 ? names.join(" or ") : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
    const u: UBase = { filter: `${key}:${values.join(",")}`, keys: [key], label: `${verb(key)} ${listed}`, kind: parts.every((p) => p.u.kind === "company") ? "company" : "person" };
    const end = parts[parts.length - 1]!.end;
    if (role === "from" || role === "any" || joins.every((w) => w === "or")) return { t: "apply", end, u };
    return { t: "offer", end, why: "list", choices: [{ label: u.label, filter: u.filter, detail: null, kind: u.kind }] };
  }

  function resolveTarget(j: number, role: Role): Res | null {
    const keyFor = (e: VocabEntity): OperatorKey => (e.type === "company" ? "with" : role === "to" ? "to" : role === "with" ? "with" : "from");
    const end = (n: number) => j + n - 1;
    const first = toks[j]!;
    if (!free(j, 1)) return null;
    // me
    if (first.norm === "me" || first.norm === "myself") {
      if (role === "from" || role === "any") return typed.has("from") ? null : { t: "apply", end: j, u: { filter: "from:me", keys: ["from"], label: "From you", kind: "person" } };
      if (role === "to") return typed.has("to") ? null : { t: "apply", end: j, u: { filter: "to:me", keys: ["to"], label: "To you", kind: "person" } };
      return null;
    }
    // an address or a domain as written
    if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(first.text) && role !== "source" && role !== "at") {
      const k: OperatorKey = role === "to" ? "to" : role === "with" ? "with" : "from";
      if (typed.has(k)) return null;
      const e = byEmail(first.norm);
      return { t: "apply", end: j, u: { filter: `${k}:${first.norm}`, keys: [k], label: `${verb(k)} ${e?.name ?? first.text}`, kind: "person" } };
    }
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(first.text) && byDomain(first.norm) && role !== "source") {
      if (typed.has("with")) return null;
      return { t: "apply", end: j, u: { filter: `with:${first.norm}`, keys: ["with"], label: `With ${byDomain(first.norm)!.name}`, kind: "company" } };
    }
    // the longest name or tool that follows
    let ents: VocabEntity[] = [], entN = 0, exact = false, lastOnly = false;
    for (const n of [3, 2, 1]) {
      if (!free(j, n)) continue;
      const key = words(j, n).join(" ");
      if (n === 1 && (STOP.has(key) || TYPE_WORDS[key])) break;
      const full = look("full", key);
      const loose = n === 1 ? look("first", key) : [];
      const hits = dedupe([...full, ...loose]);
      // "from Lena Vogt's team": the possessive reads it, once
      if (hits.length && toks[end(n)]!.poss) return null;
      if (hits.length) { ents = hits; entN = n; exact = full.length > 0; break; }
      if (n === 1) {
        const last = look("last", key);
        if (last.length) { if (toks[end(n)]!.poss) return null; ents = last; entN = 1; lastOnly = true; }
      }
    }
    let slugs: string[] = [], platN = 0;
    if (role === "source" || role === "any") {
      for (const n of [2, 1]) {
        if (!free(j, n)) continue;
        const s = ix.platforms.get(words(j, n).join(" "));
        if (s) { slugs = s; platN = n; break; }
      }
    }
    const tool = (): Res | null => {
      if (typed.has("source")) return null;
      const u = sourceUnderstood(slugs);
      const name = words(j, platN).join(" ");
      const prevType = j - 2 >= 0 && !!TYPE_WORDS[toks[j - 2]!.norm];
      // a tool reads as one right after its connector, with nothing after it that makes
      // it an everyday phrase ("notes on linear algebra", "slack time")
      const clear = clearAfter(end(platN)) && (!ORDINARY_TOOLS.has(name) || capitalized(toks[j]!) || prevType);
      if (clear) return { t: "apply", end: end(platN), u };
      return { t: "offer", end: end(platN), why: "maybe_tool", choices: [{ label: u.label, filter: u.filter, detail: null, kind: "source" }] };
    };
    if (role === "source") return slugs.length ? tool() : null;
    if (role === "at") ents = ents.filter((e) => e.type === "company");
    if (role === "to") ents = ents.filter((e) => e.type === "person");
    ents = sameHumans(ents);
    if (!ents.length && !slugs.length) return null;
    // a tool and a name of the same length: ask
    if (slugs.length && ents.length && platN === entN) {
      if (typed.has("source") && typed.has("from") && typed.has("with")) return null;
      return { t: "offer", end: end(entN), why: "name_or_tool", choices: [
        { label: `In ${slugs.map(platformName).join(" or ")}`, filter: `in:${slugs.join(",")}`, detail: null, kind: "source" },
        ...ents.slice(0, 3).map((e) => entityChoice(e, keyFor(e))),
      ] };
    }
    if (slugs.length && platN > entN) return tool();
    // names: one clear person is applied, anything less clear is offered
    const exactOnes = exact ? ents.filter((e) => nameWords(e.name).join(" ") === words(j, entN).join(" ")) : [];
    const pick = exactOnes.length === 1 ? exactOnes : ents;
    if (pick.some((e) => typed.has(keyFor(e)))) return null;
    const choices = () => pick.slice(0, 4).map((e) => entityChoice(e, keyFor(e)));
    // a last name alone ("from Shah") is offered, and only when it reads as a name
    if (lastOnly) return capitalized(first) || clearAfter(end(entN)) ? { t: "offer", end: end(entN), why: "last_name", choices: choices() } : null;
    // a first name that is also a word ("mark", "grace", "will"): a capital and nothing after it
    const word = entN === 1 && !exact && COMMON_WORDS.has(first.norm);
    if (pick.length === 1 && (!word || (capitalized(first) && clearAfter(end(entN))))) {
      return { t: "apply", end: end(entN), u: entityUnderstood(pick[0]!, keyFor(pick[0]!)) };
    }
    return { t: "offer", end: end(entN), why: pick.length > 1 ? "same_name" : "common_word", choices: choices() };
  }
}

/** The item kinds a type value stands for (parse.ts TYPE_ALIASES, kept here so this file stays browser-safe and small). */
const TYPE_KINDS: Record<string, string[]> = {
  mail: ["email_thread"], meeting: ["meeting_note", "event"], event: ["event"], meeting_note: ["meeting_note"], deal: ["deal"], doc: ["doc"],
  note: ["note"], issue: ["task"], message: ["message"], person: ["person"], company: ["company"],
};

const shiftDay = (ymd: string, n: number) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
/** A date read from words as `updated:`, for "edited this week". */
function updatedOf(d: { insert: string }): string | null {
  const after = /after:(\S+)/.exec(d.insert)?.[1], before = /before:(\S+)/.exec(d.insert)?.[1], on = /^on:(\S+)$/.exec(d.insert)?.[1];
  if (on) return `updated:${on}`;
  if (after && before) return `updated:${after}..${shiftDay(before, -1)}`;
  if (after) return `updated:>=${after}`;
  return null;
}

/** A date read from words as `during:`, for a thing that ends or is due then ("closing this quarter"). */
function duringOf(d: { insert: string; until?: string }): string | null {
  const after = /after:(\S+)/.exec(d.insert)?.[1], before = /before:(\S+)/.exec(d.insert)?.[1], on = /^on:(\S+)$/.exec(d.insert)?.[1];
  if (on) return `during:${on}`;
  if (after && before) return `during:${after}..${shiftDay(before, -1)}`;
  if (after && d.until) return `during:${after}..${d.until}`;
  return null;
}

/**
 * Records that are one human: the same name where at most one address is known among
 * them (a chat account and a mail contact). Two addresses under one name are two
 * people, and then a record with no address could be either, so nothing collapses.
 */
function sameHumans(es: VocabEntity[]): VocabEntity[] {
  const groups = new Map<string, VocabEntity[]>();
  // "Ravi M." (a chat account) is the same name as "Ravi Menon" when only one Ravi M... is around
  const full = es.filter((e) => e.type === "person").map((e) => nameWords(e.name)).filter((w) => w.length === 2 && w[1]!.replace(/\.$/, "").length > 1);
  const nameKey = (e: VocabEntity) => {
    const w = nameWords(e.name);
    if (e.type === "person" && w.length === 2 && /^\p{L}\.?$/u.test(w[1]!)) {
      const m = full.filter((f) => f[0] === w[0] && f[1]!.startsWith(w[1]!.charAt(0)));
      if (new Set(m.map((f) => f.join(" "))).size === 1) return m[0]!.join(" ");
    }
    return w.join(" ");
  };
  for (const e of es) {
    const k = `${e.type}\u0000${nameKey(e)}`;
    const g = groups.get(k);
    if (g) g.push(e); else groups.set(k, [e]);
  }
  const out: VocabEntity[] = [];
  for (const g of groups.values()) {
    const addr = new Set(g.map((e) => (e.type === "person" ? e.email : e.domain)).filter((x): x is string => !!x).map(fold));
    if (g.length === 1 || addr.size > 1) { out.push(...g); continue; }
    // keep the one with the address (and the most items); the filter names them all
    const keep = g.find((e) => e.email || e.domain) ?? g[0]!;
    out.push({ ...keep, itemCount: g.reduce((n, e) => n + (e.itemCount ?? 0), 0), twins: g.filter((e) => e !== keep).map((e) => e.id) });
  }
  return out.sort((a, b) => (b.itemCount ?? 0) - (a.itemCount ?? 0));
}

function dedupe(es: VocabEntity[]): VocabEntity[] {
  const seen = new Set<string>();
  return es.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true))).sort((a, b) => (b.itemCount ?? 0) - (a.itemCount ?? 0));
}

function quoteValue(v: string): string { return /[\s,]/.test(v) ? `"${v.replace(/"/g, "")}"` : v; }

/** The filter value for an entity: me, the address, the domain, else the quoted name. */
export function entityValue(e: VocabEntity): string {
  if (e.isSelf && e.type === "person") return "me";
  if (e.twins?.length) return quoteValue(e.name);
  if (e.type === "person" && e.email) return e.email.toLowerCase();
  if (e.type === "company" && e.domain) return e.domain.toLowerCase();
  return quoteValue(e.name);
}

const verb = (k: OperatorKey) => (k === "to" ? "To" : k === "with" ? "With" : "From");

function entityUnderstood(e: VocabEntity, k: OperatorKey): Omit<Understood, "phrase" | "start" | "end"> {
  return { filter: `${k}:${entityValue(e)}`, keys: [k], label: `${verb(k)} ${e.isSelf && e.type === "person" ? "you" : e.name}`, kind: e.type === "company" ? "company" : "person" };
}
function entityChoice(e: VocabEntity, k: OperatorKey): UnderstandChoice {
  return { label: `${verb(k)} ${e.name}`, filter: `${k}:${entityValue(e)}`, detail: e.type === "person" ? e.email ?? null : e.domain ?? null, kind: e.type === "company" ? "company" : "person" };
}
function sourceUnderstood(slugs: string[]): Omit<Understood, "phrase" | "start" | "end"> {
  return { filter: `in:${slugs.join(",")}`, keys: ["source"], label: `In ${slugs.map(platformName).join(" or ")}`, kind: "source" };
}

/**
 * The words of a question without its question and filler words ("who is Priya Shah" ->
 * "Priya Shah"), for looking up a person or company the sentence names. The text itself
 * when nothing would be left.
 */
export function withoutFiller(text: string): string {
  const kept = text.split(/\s+/).filter((w) => w && !FILLER.has(fold(w).replace(/[?.!,;:]+$/g, "").replace(/’/g, "'")));
  return kept.length ? kept.join(" ").replace(/[?.!]+$/, "") : text;
}

// ---------- rewriting ----------

/** The text with each understood phrase taken out and its filter added at the end. */
export function applyUnderstood(text: string, understood: Pick<Understood, "start" | "end" | "filter">[]): string {
  let out = "";
  let at = 0;
  for (const u of [...understood].sort((a, b) => a.start - b.start)) {
    out += `${text.slice(at, u.start)} `;
    at = u.end;
  }
  out += text.slice(at);
  const words = out.replace(/\p{Cf}/gu, "").replace(/\s+([,?.!;:])/g, "$1").replace(/[,;:]+(?=[?.!,;:])/g, "").replace(/(^|\s)[,;:.]+(?=\s|$)/g, " ").replace(/\s+/g, " ").trim();
  return [words, ...understood.map((u) => u.filter)].filter(Boolean).join(" ").trim();
}

/** Where a phrase sits in text: at its own offsets when they still match, else its first appearance. */
function locate(text: string, s: { phrase: string; start: number; end: number }): [number, number] | null {
  if (text.slice(s.start, s.end) === s.phrase) return [s.start, s.end];
  const i = text.indexOf(s.phrase);
  return i >= 0 ? [i, i + s.phrase.length] : null;
}

/**
 * Keeps phrases as plain words (a removed chip, or "search the exact words"):
 * each one goes in quotes, and quoted text is never read as a filter.
 */
export function keepWords(text: string, spans: { phrase: string; start: number; end: number }[]): string {
  let out = text;
  for (const s of [...spans].sort((a, b) => b.start - a.start)) {
    const at = locate(out, s);
    if (!at) continue;
    out = `${out.slice(0, at[0])}"${out.slice(at[0], at[1]).replace(/"/g, "")}"${out.slice(at[1])}`;
  }
  return out;
}

/** Takes one choice of a suggestion: the phrase becomes that filter in the box. */
export function takeChoice(text: string, s: { phrase: string; start: number; end: number }, filter: string): string {
  const at = locate(text, s);
  if (!at) return `${text} ${filter}`.trim();
  return `${text.slice(0, at[0])}${filter}${text.slice(at[1])}`.replace(/\s+/g, " ").trim();
}

/** Turns understood phrases into the filters they stand for, in the box (a chip was edited by hand). */
export function writeUnderstood(text: string, understood: Understood[], keys?: OperatorKey[]): string {
  const pick = keys ? understood.filter((u) => u.keys.some((k) => keys.includes(k))) : understood;
  let out = text;
  for (const u of [...pick].sort((a, b) => b.start - a.start)) {
    const at = locate(out, u);
    if (!at) continue;
    out = `${out.slice(0, at[0])}${u.filter}${out.slice(at[1])}`;
  }
  return out.replace(/\s+/g, " ").trim();
}
