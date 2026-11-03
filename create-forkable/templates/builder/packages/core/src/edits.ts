// Direct edits. The builder edits text in
// place (T) or swaps classes from the style panel in the preview; the
// platform applies the AST-safe ones itself at the tagged location, with no
// agent call, and hands the rest to the agent as one batched turn.
//
// A loc is what tools/dev-tagger.ts writes: "src/App.tsx:42:8", the 1-based
// line and column of the JSX opening element's "<".
//
// Safe text edit: the element's own children hold the old text as literal
// JSX text (one JsxText node, or all of its children being JsxText). Safe
// class edit: className is a string literal, or the first string literal of
// a cn()/clsx() call, and every class to remove is in that literal (or there
// is no className yet). Anything else (an expression, a prop, text from
// data) is deferred to the agent with the reason.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";
import { Node, Project, SyntaxKind, ts, type JsxAttribute, type JsxOpeningElement, type JsxSelfClosingElement, type SourceFile } from "ts-morph";

import type { DirectEdit } from "./types.js";
export type { DirectEdit };

export interface DeferredEdit {
  edit: DirectEdit;
  reason: string;
}

export interface EditResult {
  applied: DirectEdit[];
  deferred: DeferredEdit[];
  /** Project-relative files that changed. */
  files: string[];
}

export function parseLoc(loc: string): { file: string; line: number; col: number } | null {
  const m = /^(.+):(\d+):(\d+)$/.exec(loc);
  if (!m) return null;
  return { file: m[1]!, line: Number(m[2]), col: Number(m[3]) };
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** The opening (or self-closing) element whose "<" sits at line:col. */
function elementAt(sf: SourceFile, line: number, col: number): JsxOpeningElement | JsxSelfClosingElement | null {
  let pos: number;
  try {
    pos = sf.compilerNode.getPositionOfLineAndCharacter(line - 1, col - 1);
  } catch {
    return null;
  }
  const hit = sf.getDescendants().find((n) => (Node.isJsxOpeningElement(n) || Node.isJsxSelfClosingElement(n)) && n.getStart() === pos);
  return (hit as JsxOpeningElement | JsxSelfClosingElement | undefined) ?? null;
}

/** JSX text needs escaping for braces and angle brackets; wrap it in a string expression then. */
function jsxText(s: string): string {
  return /[{}<>]/.test(s) ? `{${JSON.stringify(s)}}` : s;
}

type Patch = { start: number; end: number; text: string };

function applyText(el: JsxOpeningElement | JsxSelfClosingElement, e: Extract<DirectEdit, { kind: "text" }>, out: Patch[]): string | null {
  if (!Node.isJsxOpeningElement(el)) return "the element has no children to edit";
  const parent = el.getParentIfKind(SyntaxKind.JsxElement);
  if (!parent) return "the element has no children to edit";
  const kids = parent.getJsxChildren();
  const texts = kids.filter((k) => Node.isJsxText(k) && norm(k.getText()) !== "");
  const others = kids.filter((k) => !Node.isJsxText(k));
  const want = norm(e.before);
  // One literal child holds exactly the old text.
  const one = texts.filter((k) => norm(k.getText()) === want);
  if (one.length === 1) {
    const k = one[0]!;
    const raw = k.getFullText();
    const lead = /^\s*/.exec(raw)![0];
    const trail = /\s*$/.exec(raw)![0];
    out.push({ start: k.getPos(), end: k.getEnd(), text: `${lead}${jsxText(e.after.trim())}${trail}` });
    return null;
  }
  if (others.length === 0 && texts.length > 0 && norm(texts.map((k) => k.getText()).join(" ")) === want) {
    const first = texts[0]!;
    const last = texts[texts.length - 1]!;
    const lead = /^\s*/.exec(first.getFullText())![0];
    const trail = /\s*$/.exec(last.getFullText())![0];
    out.push({ start: first.getPos(), end: last.getEnd(), text: `${lead}${jsxText(e.after.trim())}${trail}` });
    return null;
  }
  if (others.some((k) => Node.isJsxExpression(k))) return "the text comes from code (an expression), not a literal";
  return "the old text is not a literal child of this element";
}

function classAttr(el: JsxOpeningElement | JsxSelfClosingElement): JsxAttribute | null {
  for (const a of el.getAttributes()) if (Node.isJsxAttribute(a) && a.getNameNode().getText() === "className") return a;
  return null;
}

function swap(list: string, remove: string[], add: string[]): string {
  const cur = list.split(/\s+/).filter(Boolean);
  const kept = cur.filter((c) => !remove.includes(c));
  for (const a of add) if (!kept.includes(a)) kept.push(a);
  return kept.join(" ");
}

function applyClass(el: JsxOpeningElement | JsxSelfClosingElement, e: Extract<DirectEdit, { kind: "class" }>, out: Patch[]): string | null {
  const attr = classAttr(el);
  if (!attr) {
    if (e.remove.length) return "the element has no className to change";
    const tag = el.getTagNameNode();
    out.push({ start: tag.getEnd(), end: tag.getEnd(), text: ` className=${JSON.stringify(e.add.join(" "))}` });
    return null;
  }
  const init = attr.getInitializer();
  const literal = (s: Node | undefined) => (s && (Node.isStringLiteral(s) || Node.isNoSubstitutionTemplateLiteral(s)) ? s : null);
  let target = literal(init);
  if (!target && init && Node.isJsxExpression(init)) {
    const ex = init.getExpression();
    target = literal(ex);
    if (!target && ex && Node.isCallExpression(ex) && /^(cn|clsx|classNames|twMerge)$/.test(ex.getExpression().getText())) {
      target = literal(ex.getArguments().find((a) => Node.isStringLiteral(a) || Node.isNoSubstitutionTemplateLiteral(a)));
    }
  }
  if (!target) return "className is computed in code";
  const value = target.getLiteralText();
  const have = value.split(/\s+/);
  const missing = e.remove.filter((c) => !have.includes(c));
  if (missing.length) return `${missing.join(" ")} is not in the literal className (it may come from a prop or a variant)`;
  const next = swap(value, e.remove, e.add);
  out.push({ start: target.getStart(), end: target.getEnd(), text: Node.isStringLiteral(target) && target.getText().startsWith("'") ? `'${next}'` : JSON.stringify(next) });
  return null;
}

/** Apply what is safe, defer the rest. Writes files in place; never throws on a bad edit. */
export function applyDirectEdits(projectPath: string, edits: DirectEdit[]): EditResult {
  const project = new Project({ useInMemoryFileSystem: false, skipAddingFilesFromTsConfig: true, compilerOptions: { jsx: ts.JsxEmit.Preserve, allowJs: true } });
  const applied: DirectEdit[] = [];
  const deferred: DeferredEdit[] = [];
  const touched = new Map<string, SourceFile>();
  const patches = new Map<string, Patch[]>();
  // Later edits in a file first, so earlier positions stay valid.
  const ordered = [...edits].sort((a, b) => {
    const la = parseLoc(a.loc);
    const lb = parseLoc(b.loc);
    if (!la || !lb || la.file !== lb.file) return 0;
    return lb.line - la.line || lb.col - la.col;
  });
  for (const e of ordered) {
    if (e.kind === "comment") {
      deferred.push({ edit: e, reason: "a comment is for the agent" });
      continue;
    }
    const at = parseLoc(e.loc);
    if (!at) {
      deferred.push({ edit: e, reason: "no source location" });
      continue;
    }
    const rel = normalize(at.file);
    if (isAbsolute(rel) || rel.startsWith("..") || !/\.(tsx|jsx)$/.test(rel)) {
      deferred.push({ edit: e, reason: "the location is not a component file in this project" });
      continue;
    }
    const abs = join(projectPath, rel);
    if (!existsSync(abs)) {
      deferred.push({ edit: e, reason: `${rel} does not exist` });
      continue;
    }
    let sf = touched.get(rel);
    if (!sf) {
      sf = project.createSourceFile(abs, readFileSync(abs, "utf8"), { overwrite: true });
      touched.set(rel, sf);
    }
    const el = elementAt(sf, at.line, at.col);
    if (!el) {
      deferred.push({ edit: e, reason: "the element moved since the preview loaded" });
      continue;
    }
    const list = patches.get(rel) ?? [];
    patches.set(rel, list);
    const why = e.kind === "text" ? applyText(el, e, list) : applyClass(el, e, list);
    if (why) deferred.push({ edit: e, reason: why });
    else applied.push(e);
  }
  const files: string[] = [];
  for (const [rel, sf] of touched) {
    const abs = join(projectPath, rel);
    let next = sf.getFullText();
    // Back to front, so earlier offsets stay valid; overlapping patches keep the first.
    let floor = Infinity;
    for (const pt of [...(patches.get(rel) ?? [])].sort((a, b) => b.start - a.start)) {
      if (pt.end > floor) continue;
      next = next.slice(0, pt.start) + pt.text + next.slice(pt.end);
      floor = pt.start;
    }
    if (next !== readFileSync(abs, "utf8")) {
      writeFileSync(abs, next);
      files.push(rel);
    }
  }
  return { applied, deferred, files };
}

/** The batched turn for what the platform could not apply itself. */
export function deferredPrompt(deferred: DeferredEdit[]): string {
  const lines = deferred.map(({ edit: e, reason }) => {
    if (e.kind === "text") return `- At ${e.loc}, change the text "${e.before.slice(0, 200)}" to "${e.after.slice(0, 200)}" (${reason}).`;
    if (e.kind === "class") return `- At ${e.loc}, ${e.remove.length ? `replace the classes ${e.remove.join(" ")} with` : "add the classes"} ${e.add.join(" ") || "(none)"} (${reason}).`;
    return `- At ${e.loc}${e.tag ? ` (<${e.tag}>${e.excerpt ? ` "${e.excerpt.slice(0, 80)}"` : ""})` : ""}: ${e.text}`;
  });
  const comments = deferred.filter((d) => d.edit.kind === "comment").length;
  const head = comments === deferred.length ? "The builder left comments on the preview. Address each one:" : "Make these edits from the preview. Keep everything else as it is:";
  return `${head}\n${lines.join("\n")}`;
}

/** "Edited 2 texts and 1 style" */
export function editSubject(applied: DirectEdit[]): string {
  const t = applied.filter((e) => e.kind === "text").length;
  const c = applied.filter((e) => e.kind === "class").length;
  const parts = [t ? `${t} text${t === 1 ? "" : "s"}` : null, c ? `${c} style${c === 1 ? "" : "s"}` : null].filter(Boolean);
  return `Edited ${parts.join(" and ")} in the preview`;
}
