#!/usr/bin/env node
// pnpm check:copy: the words a person reads in the app stay plain (AGENTS.md, "Words
// on screen"). Reads every .ts/.tsx file under ui/src with the TypeScript parser and
// collects the strings a person can see: JSX text, string props such as title, label,
// placeholder and aria-label, the strings inside JSX children, and the text fields of
// object literals (toast titles and details, option labels, hints). Each one is checked
// against the builder words (the left column of the word list) and the house copy
// rules. Fails with file:line for every hit.
//
//   node scripts/check-copy.mjs          check, exit 1 on a hit
//   node scripts/check-copy.mjs --dump   print every visible string (inventory)
//
// Builder words are allowed in three places only: the Cheatsheet (it teaches the
// typed filters, which are the real terms), inside an element marked
// data-copy="advanced" (the Advanced disclosures, where the real terms stay on
// purpose), the line right after a `// copy-ok: <why>` comment, and the files in
// ALLOW_FILES with the reason given there.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));
const ts = require("typescript");

const DUMP = process.argv.includes("--dump");
const SRC = join(root, "ui/src");

/** Builder words, each with the plain word the app uses instead. */
const BUILDER = [
  { re: /\bprofiles?\b/i, say: "source" },
  { re: /\bgrant(s|ed)?\b/i, say: "access, connected" },
  { re: /\bConnect app'?s? ask\b|\bthe ask\b/i, say: "the tools Search can ask for" },
  { re: /\boperators?\b/i, say: "filters" },
  { re: /\bsemantic(ally)?\b|\bhybrid\b|\bkeyword[- ]only\b|\bembedd(ing|ings|er|ers)\b|\bvectors?\b/i, say: "search by meaning, on or off" },
  { re: /\bsync(s|ing|ed)?\b|\bresync\b/i, say: "update, updating" },
  { re: /\bentit(y|ies)\b/i, say: "person or company" },
  // a platform's models are "what to search"; the assistant's AI model keeps its word
  // what a non-technical tester stumbled on (2026-11-12): fine in Advanced, the Cheatsheet and /setup/connect only
  { re: /\bpostgres(ql)?\b|postgres:\/\/|\bpgvector\b/i, say: "your data, on this computer" },
  { re: /\blocalhost\b|127\.0\.0\.1/i, say: "this computer" },
  { re: /\bTypeSafe\b/, say: "an AI helper (name it only in Access, Helpers)" },
  { re: /\brerank(s|ed|ing)?\b/i, say: "put the best results first" },
  { re: /\bhash-v1\b/i, say: "Sample, words only" },
  { re: /\bMarketplace\b|\bapp tier\b/i, say: "move it under Advanced" },
  { re: /\bembed\b/i, say: "reads for meaning" },
  { re: /\bReads back\b/i, say: "how far back" },
  { re: /\b(GET|POST|PUT|PATCH|DELETE) \/[\w/{}.-]+/, say: "say what it reads, put the request under Advanced" },
  { re: /\bmodels?\b/i, say: "what to search", unless: /\b(AI|Claude|Codex|chat|language|default|bundled|local)\b[^.]*\bmodels?\b|\bmodels?\b[^.]*\b(Claude|Codex|AI engine)\b/i },
];

/** House copy rules (AGENTS.md, Rules, Copy). These apply everywhere, the allowlist included. */
const HOUSE = [
  { re: /[–—]/, why: "no em or en dashes" },
  { re: /!(?!=)/, why: "no exclamation marks" },
  { re: /\b(seamless(ly)?|frictionless|cutting[- ]edge|revolutionary|AI[- ]powered|leverag(e|es|ed|ing))\b/i, why: "banned word" },
  { re: /\b\d[\d,]*\+?\s+(platforms|integrations|apps|tools|connectors)\b/i, why: "never type a platform or tool count" },
];

/** Whole files where builder words are fine, and why. House rules still apply. */
const ALLOW_FILES = {
  "ui/src/components/Cheatsheet.tsx": "teaches the typed filters (from:, in:, type:), the real terms",
  "ui/src/screens/ConnectSetup.tsx": "developer screen: the person setting up the Connect app needs the real terms",
  "ui/src/contract/api-types.ts": "types only",
};
/** Folders that are not screens: the mock server's sample world (emails, docs, meeting titles). */
const SKIP_DIRS = ["ui/src/mock"];

const TEXT_PROPS = new Set([
  "title", "label", "placeholder", "aria-label", "aria-description", "alt", "hint", "detail", "description",
  "text", "tooltip", "heading", "subtitle", "caption", "message", "empty", "emptyText", "confirmLabel",
  "confirm", "cancelLabel", "body", "sub", "lead", "action", "actionLabel", "note", "reason", "help", "children",
]);
const TEXT_KEYS = new Set([
  "title", "detail", "label", "description", "hint", "placeholder", "message", "body", "text", "sub",
  "caption", "reason", "help", "note", "confirm", "confirmLabel", "empty", "lead", "summary", "tip", "why",
]);

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const rel = relative(root, p);
    if (SKIP_DIRS.some((d) => rel === d || rel.startsWith(d + "/"))) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(f) && !f.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

/** The literal text of a string-ish node, with ${...} shown as {…}. */
function textOf(n) {
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isTemplateExpression(n)) return n.head.text + n.templateSpans.map((s) => "{…}" + s.literal.text).join("");
  return null;
}

/** Collect the string literals an expression can evaluate to (a ? "x" : "y", a && "x", "x" + y). */
function stringsIn(n, out) {
  if (!n) return out;
  const t = textOf(n);
  if (t !== null) { out.push([n, t]); return out; }
  if (ts.isParenthesizedExpression(n)) return stringsIn(n.expression, out);
  if (ts.isConditionalExpression(n)) { stringsIn(n.whenTrue, out); stringsIn(n.whenFalse, out); return out; }
  if (ts.isBinaryExpression(n) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.PlusToken].includes(n.operatorToken.kind)) {
    stringsIn(n.left, out); stringsIn(n.right, out); return out;
  }
  return out;
}

const looksLikeWords = (s) => /[A-Za-z]{2,}/.test(s) && !/^[a-z0-9_.:/@#-]+$/.test(s.trim()) && !/^(https?:|\/|[a-z]+:\S)/.test(s.trim());

/** A string that reads like words: has a space, or starts with a capital letter. */
const sentenceLike = (s) => /[A-Za-z]{2,}/.test(s) && (/^[A-Z][a-z]/.test(s.trim()) || /[a-z]{2,} [a-zA-Z]/.test(s)) && !isClassList(s);
/** Tailwind class lists and other code-looking strings. */
const isClassList = (s) => {
  const toks = s.trim().split(/\s+/);
  return toks.length > 1 && toks.filter((t) => /^[!a-z0-9:\[\]\/.%_()#,>&*-]+$/.test(t) && /[-:\[]/.test(t)).length >= Math.ceil(toks.length / 2);
};
const SKIP_KEYS = new Set(["className", "key", "id", "value", "testId", "path", "href", "to", "icon", "kind", "type", "status", "platform", "method", "keys", "combo", "url", "cls", "style", "role", "data-testid", "name", "accept", "lang"]);
/** True when a string is code, not words: imports, class names, comparisons, keys, test ids. */
function codeContext(n) {
  const p = n.parent;
  if (!p) return true;
  for (let a = p; a; a = a.parent) if (ts.isImportDeclaration(a) || ts.isExportDeclaration(a) || ts.isTypeNode(a)) return true;
  if (ts.isJsxAttribute(p) || (ts.isJsxExpression(p) && ts.isJsxAttribute(p.parent))) return true; // handled above when it is a text prop
  if (ts.isBinaryExpression(p) && /=/.test(ts.tokenToString(p.operatorToken.kind) ?? "")) return true;
  if (ts.isCaseClause(p) || ts.isElementAccessExpression(p)) return true;
  if (ts.isPropertyAssignment(p) && p.name === n) return true;
  if (ts.isPropertyAssignment(p) && SKIP_KEYS.has(p.name.getText().replace(/^["']|["']$/g, ""))) return true;
  if (ts.isCallExpression(p) && /^(cn|clsx|twMerge|querySelector|querySelectorAll|getElementById|matchMedia|useMedia|startsWith|endsWith|includes|split|replace|join|test|match|get|set|has|delete|setItem|getItem|removeItem|addEventListener|removeEventListener|fetch|navigate|post|put|patch|del|json)$/.test((p.expression.name ?? p.expression).getText())) return true;
  return false;
}

const hits = [];
const dump = [];
for (const file of walk(SRC)) {
  const rel = relative(root, file);
  const src = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const seen = new Set();
  const lines = src.split("\n");

  const advanced = (n) => {
    for (let p = n.parent; p; p = p.parent) {
      if (ts.isJsxElement(p)) {
        const attrs = p.openingElement.attributes.properties;
        if (attrs.some((a) => ts.isJsxAttribute(a) && a.name.getText(sf) === "data-copy" && a.initializer && textOf(a.initializer) === "advanced")) return true;
      }
    }
    return false;
  };

  const add = (node, text, where) => {
    if (seen.has(node.pos)) return;
    seen.add(node.pos);
    const s = text.replace(/\s+/g, " ").trim();
    if (!s || !looksLikeWords(s)) return;
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    dump.push(`${rel}:${line}\t${where}\t${s}`);
    for (const h of HOUSE) if (h.re.test(s)) hits.push(`${rel}:${line}  ${h.why}: "${s}"`);
    if (ALLOW_FILES[rel] || advanced(node) || /copy-ok/.test(lines[line - 2] ?? "")) return;
    for (const b of BUILDER) {
      const m = s.match(b.re);
      if (m && !(b.unless && b.unless.test(s))) hits.push(`${rel}:${line}  builder word "${m[0]}" (say: ${b.say}): "${s}"`);
    }
  };

  const visit = (n) => {
    if (ts.isJsxText(n)) add(n, n.text, "jsx");
    else if (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) {
      if (n.tagName.getText(sf) === "select") hits.push(`${rel}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}  native <select>: use components/ui/Select`);
    } else if (ts.isJsxAttribute(n)) {
      const name = n.name.getText(sf);
      if (TEXT_PROPS.has(name) && n.initializer) {
        const init = ts.isJsxExpression(n.initializer) ? n.initializer.expression : n.initializer;
        for (const [node, t] of stringsIn(init, [])) add(node, t, `prop ${name}`);
      }
    } else if (ts.isJsxExpression(n) && n.parent && (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent))) {
      for (const [node, t] of stringsIn(n.expression, [])) add(node, t, "jsx expr");
    } else if (ts.isPropertyAssignment(n)) {
      const key = n.name.getText(sf).replace(/^["']|["']$/g, "");
      if (TEXT_KEYS.has(key)) for (const [node, t] of stringsIn(n.initializer, [])) add(node, t, `key ${key}`);
    } else if (ts.isCallExpression(n) && /^(toast|setError|setMsg|setNote|notify|confirm|alert)$/.test(n.expression.getText(sf))) {
      for (const a of n.arguments) for (const [node, t] of stringsIn(a, [])) add(node, t, "call");
    } else if (ts.isNewExpression(n) && n.expression.getText(sf) === "Error") {
      for (const a of n.arguments ?? []) for (const [node, t] of stringsIn(a, [])) add(node, t, "error");
    } else if (textOf(n) !== null && sentenceLike(textOf(n)) && !codeContext(n)) {
      // any other string that reads like words (a constant, a map of reasons, a label table)
      add(n, textOf(n), "string");
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

if (DUMP) {
  // no process.exit here: it would cut a piped dump short
  console.log(dump.join("\n"));
} else if (hits.length) {
  console.error(`check:copy found ${hits.length} problem${hits.length === 1 ? "" : "s"} in visible text:\n`);
  for (const h of hits) console.error("  " + h);
  console.error("\nThe word list and the rules are in AGENTS.md, \"Words on screen\". Real terms belong in the Advanced disclosures (data-copy=\"advanced\") or the Cheatsheet.");
  process.exit(1);
} else {
  console.log(`check:copy ok, ${dump.length} visible strings in ui/src`);
}
