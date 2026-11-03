// The scope manifest, derived from code. A ts-morph pass over
// server/** and src/**: every `.run(arg0, ...)` on the `one(c)` client whose
// arg0 resolves to a wrapper in actions.gen.ts (a string-literal actionId),
// or is an inline `{ platform: "<literal>", actionId: "<literal>" }`.
// Anything else is an error the fix loop sees and publish blocks on:
//   BLD001 dynamic action, BLD002 actionId not in actions.json,
//   BLD003 raw action id string outside actions.gen.ts,
//   BLD004 provider URL or SDK import in app code,
//   BLD005 one(c).run in a route without requireUser(c) first (warning).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { Node, Project, SyntaxKind, type CallExpression, type Expression, type SourceFile } from "ts-morph";
import type { KnowledgeRow } from "../fixtures.js";
import type { CallSite, InstalledAction, Manifest, ManifestAction, ScopeIssue } from "../types.js";
import { levelFor } from "../catalog/naming.js";

export const GEN_FILE = "server/one/actions.gen.ts";
export const ONE_INDEX = "server/one/index.ts";

/** SDKs that call a provider directly, around the grant. */
const PROVIDER_SDKS = [
  /^googleapis$/,
  /^@googleapis\//,
  /^stripe$/,
  /^@stripe\/stripe-node$/,
  /^@slack\//,
  /^octokit$/,
  /^@octokit\//,
  /^@notionhq\/client$/,
  /^openai$/,
  /^@anthropic-ai\/sdk$/,
  /^@google\/genai$/,
  /^@google\/generative-ai$/,
  /^@hubspot\//,
  /^twilio$/,
  /^@sendgrid\//,
  /^resend$/,
  /^@linear\/sdk$/,
  /^@microsoft\/microsoft-graph-client$/,
  /^airtable$/,
  /^shopify-api-node$/,
  /^@shopify\//,
  /^@withone\/connect\/server$/,
  /^@withone\/sdk$/,
];
/** Provider and One API hosts that must not appear in app code. */
const PROVIDER_HOSTS = /\b(api\.withone\.ai|[a-z0-9.-]*googleapis\.com|api\.stripe\.com|slack\.com\/api|api\.github\.com|graph\.microsoft\.com|api\.openai\.com|api\.anthropic\.com|api\.notion\.com|api\.hubapi\.com|api\.linear\.app|api\.airtable\.com|api\.twilio\.com|api\.sendgrid\.com|myshopify\.com\/admin)\b/i;
const RAW_ID = /conn_mod_def::[A-Za-z0-9_-]+::[A-Za-z0-9_-]+/;

export interface ExtractInput {
  dir: string;
  installed: InstalledAction[];
  /** Cached catalog knowledge per action id (titles, methods, tags). */
  knowledge: (actionId: string) => KnowledgeRow | null;
  /** Catalog conn_def id per platform slug. */
  connDef: (platform: string) => string | null;
}

export interface ExtractResult {
  manifest: Manifest;
  callSites: CallSite[];
  issues: ScopeIssue[];
}

function walk(dir: string, root: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".") || name === "dist") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, root, out);
    else if (/\.(tsx?|mts|cts)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
}

/** The files the pass reads, with their mtimes (the live manifest's cache key). */
export function sourceFingerprint(dir: string): string {
  const files: string[] = [];
  walk(join(dir, "server"), dir, files);
  walk(join(dir, "src"), dir, files);
  walk(join(dir, "api"), dir, files);
  const actions = join(dir, ".builder", "actions.json");
  if (existsSync(actions)) files.push(actions);
  return files
    .sort()
    .map((f) => `${relative(dir, f)}:${statSync(f).mtimeMs}:${statSync(f).size}`)
    .join("|");
}

const strLit = (n: Node | undefined): string | null => (n && (Node.isStringLiteral(n) || Node.isNoSubstitutionTemplateLiteral(n)) ? n.getLiteralValue() : null);

function objectLiteralAction(n: Node): { platform: string | null; actionId: string | null; method: string | null; title: string | null } | null {
  if (!Node.isObjectLiteralExpression(n)) return null;
  const get = (k: string) => {
    const p = n.getProperty(k);
    return p && Node.isPropertyAssignment(p) ? strLit(p.getInitializer()) : null;
  };
  return { platform: get("platform"), actionId: get("actionId"), method: get("method"), title: get("title") };
}

/** Follow arg0 to a wrapper `action({...})` in actions.gen.ts. */
function resolveWrapper(expr: Expression, depth = 0): { actionId: string; platform: string | null; method: string | null; title: string | null } | null {
  if (depth > 6) return null;
  if (Node.isParenthesizedExpression(expr) || Node.isAsExpression(expr) || Node.isSatisfiesExpression(expr) || Node.isNonNullExpression(expr)) return resolveWrapper(expr.getExpression(), depth + 1);
  if (!Node.isIdentifier(expr) && !Node.isPropertyAccessExpression(expr)) return null;
  let sym = expr.getSymbol();
  if (sym?.isAlias()) sym = sym.getAliasedSymbol() ?? sym;
  for (const d of sym?.getDeclarations() ?? []) {
    let init: Node | undefined;
    if (Node.isPropertyAssignment(d)) init = d.getInitializer();
    else if (Node.isVariableDeclaration(d)) init = d.getInitializer();
    else if (Node.isShorthandPropertyAssignment(d)) init = undefined;
    if (!init) continue;
    if (Node.isCallExpression(init)) {
      const callee = init.getExpression().getText();
      if (callee === "action" || callee.endsWith(".action")) {
        const o = objectLiteralAction(init.getArguments()[0] ?? init);
        if (o?.actionId) return { actionId: o.actionId, platform: o.platform, method: o.method, title: o.title };
        return null;
      }
    }
    if (Node.isIdentifier(init) || Node.isPropertyAccessExpression(init) || Node.isAsExpression(init) || Node.isParenthesizedExpression(init)) {
      const r = resolveWrapper(init as Expression, depth + 1);
      if (r) return r;
    }
  }
  return null;
}

/** True for `one(c, { as: "owner" })` (the second argument names the owner). */
function ownerOneCall(n: Node | undefined): boolean {
  return !!n && Node.isCallExpression(n) && n.getArguments().length > 1 && /\bas\s*:\s*["'`]owner["'`]/.test(n.getArguments()[1]!.getText());
}

/**
 * one(c, { as: "owner" }).run(...), or `.run` on a variable set to it: a
 * public route on the owner's grant, on purpose. Marked on the call site
 * and the manifest entry (runsAs), and allowed per action by the builder.
 */
function asOwner(call: CallExpression): boolean {
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return false;
  const recv = callee.getExpression();
  if (ownerOneCall(recv)) return true;
  if (Node.isIdentifier(recv)) {
    for (const d of recv.getSymbol()?.getDeclarations() ?? []) if (Node.isVariableDeclaration(d) && ownerOneCall(d.getInitializer())) return true;
  }
  return false;
}

/** True when the call's receiver is the client one(c) returns. */
function isOneRun(call: CallExpression): boolean {
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== "run") return false;
  const nameSym = callee.getNameNode().getSymbol();
  const decls = nameSym?.getDeclarations() ?? [];
  if (decls.some((d) => d.getSourceFile().getFilePath().endsWith(`/${ONE_INDEX}`))) return true;
  if (decls.length) return false;
  // Unresolved types (no node_modules): fall back to the shape `one(...).run` or `x.run` where x = one(...).
  const recv = callee.getExpression();
  if (Node.isCallExpression(recv) && recv.getExpression().getText() === "one") return true;
  if (Node.isIdentifier(recv)) {
    for (const d of recv.getSymbol()?.getDeclarations() ?? []) {
      if (Node.isVariableDeclaration(d)) {
        const i = d.getInitializer();
        if (i && Node.isCallExpression(i) && i.getExpression().getText() === "one") return true;
      }
    }
  }
  return false;
}

function enclosingFunction(n: Node): Node | null {
  return n.getFirstAncestor((a) => Node.isArrowFunction(a) || Node.isFunctionDeclaration(a) || Node.isFunctionExpression(a) || Node.isMethodDeclaration(a)) ?? null;
}

function hasRequireUserBefore(call: CallExpression): boolean {
  let fn = enclosingFunction(call);
  while (fn) {
    const found = fn
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .some((c) => c.getExpression().getText() === "requireUser" && c.getStart() < call.getStart());
    if (found) return true;
    fn = enclosingFunction(fn);
  }
  return false;
}

/** Run the pass over a project directory. */
export function extractManifest(input: ExtractInput): ExtractResult {
  const { dir } = input;
  const files: string[] = [];
  walk(join(dir, "server"), dir, files);
  walk(join(dir, "src"), dir, files);
  walk(join(dir, "api"), dir, files);
  const project = new Project({
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { allowJs: false, jsx: 4 /* ReactJSX */, strict: false, noEmit: true, skipLibCheck: true, baseUrl: dir, paths: { "@/*": ["src/*"] }, module: 99, moduleResolution: 100 /* Bundler */, target: 99 },
  });
  for (const f of files) project.addSourceFileAtPath(f);

  const installed = new Map(input.installed.map((a) => [a.actionId, a]));
  const issues: ScopeIssue[] = [];
  const callSites: CallSite[] = [];
  const used = new Map<string, { platform: string | null; method: string | null; title: string | null; user: boolean; owner: boolean }>();
  const allowedRawIds = new Set<Node>();

  const rel = (sf: SourceFile) => relative(dir, sf.getFilePath());
  const issue = (code: ScopeIssue["code"], n: Node, message: string, severity: ScopeIssue["severity"] = "error") => {
    const sf = n.getSourceFile();
    const { line, column } = sf.getLineAndColumnAtPos(n.getStart());
    issues.push({ code, severity, file: rel(sf), line, col: column, message });
  };

  for (const sf of project.getSourceFiles()) {
    const file = rel(sf);
    const isGen = file === GEN_FILE;
    const isOneDir = file.startsWith("server/one/");
    if (isGen) continue;

    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (!isOneRun(call)) continue;
      const arg0 = call.getArguments()[0] as Expression | undefined;
      if (!arg0) continue;
      let resolved: { actionId: string; platform: string | null; method: string | null; title: string | null } | null = null;
      const inline = objectLiteralAction(arg0);
      if (inline) {
        if (inline.actionId && inline.platform) {
          resolved = { actionId: inline.actionId, platform: inline.platform, method: inline.method, title: inline.title };
          const p = (arg0 as import("ts-morph").ObjectLiteralExpression).getProperty("actionId");
          if (p && Node.isPropertyAssignment(p) && p.getInitializer()) allowedRawIds.add(p.getInitializer()!);
        }
      } else resolved = resolveWrapper(arg0);
      if (!resolved) {
        issue("BLD001", arg0, `one(c).run needs a wrapper from server/one/actions.gen.ts (or an inline literal action). "${arg0.getText().slice(0, 60)}" is decided at runtime, so the manifest cannot list it.`);
        continue;
      }
      const { line, column } = sf.getLineAndColumnAtPos(call.getStart());
      const owner = asOwner(call);
      callSites.push({ actionId: resolved.actionId, file, line, col: column, ...(owner ? { as: "owner" as const } : {}) });
      if (!installed.has(resolved.actionId)) {
        issue("BLD002", arg0, `${resolved.actionId} is not in .builder/actions.json. Add it with one_add_action ${resolved.actionId}.`);
        continue;
      }
      const seen = used.get(resolved.actionId) ?? { platform: resolved.platform, method: resolved.method, title: resolved.title, user: false, owner: false };
      if (owner) seen.owner = true;
      else seen.user = true;
      used.set(resolved.actionId, seen);
      if (file.startsWith("server/") && !isOneDir && !owner && !hasRequireUserBefore(call)) {
        issue("BLD005", call, "This route calls one(c).run without await requireUser(c) first.", "warning");
      }
    }

    for (const imp of sf.getImportDeclarations()) {
      const spec = imp.getModuleSpecifierValue();
      if (PROVIDER_SDKS.some((re) => re.test(spec)) && !(isOneDir && spec.startsWith("@withone/connect"))) {
        issue("BLD004", imp, `"${spec}" calls a provider around the grant. Use one(c).run with a wrapper from one_add_action instead.`);
      }
    }
    for (const lit of [...sf.getDescendantsOfKind(SyntaxKind.StringLiteral), ...sf.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral), ...sf.getDescendantsOfKind(SyntaxKind.TemplateHead), ...sf.getDescendantsOfKind(SyntaxKind.TemplateMiddle), ...sf.getDescendantsOfKind(SyntaxKind.TemplateTail)]) {
      const text = lit.getText();
      if (lit.getParent() && Node.isImportDeclaration(lit.getParent()!)) continue;
      if (RAW_ID.test(text) && !allowedRawIds.has(lit)) {
        issue("BLD003", lit, "A raw action id belongs in server/one/actions.gen.ts only. Import the wrapper instead.");
      }
      if (!isOneDir && PROVIDER_HOSTS.test(text)) {
        issue("BLD004", lit, `"${text.slice(1, 61)}" calls a provider URL directly. Use one(c).run with a wrapper from one_add_action instead.`);
      }
    }
  }

  const actions: ManifestAction[] = [];
  for (const [actionId, seen] of used) {
    const inst = installed.get(actionId)!;
    const k = input.knowledge(actionId);
    const method = (k?.method ?? seen.method ?? "POST").toUpperCase();
    const title = k?.title ?? seen.title ?? actionId;
    const platform = inst.platform || k?.connectionPlatform || seen.platform || "unknown";
    const runsAs: ManifestAction["runsAs"] = seen.owner ? (seen.user ? ["user", "owner"] : ["owner"]) : undefined;
    actions.push({ platform, connDefId: input.connDef(platform), actionId, title, method, level: levelFor({ method, title, tags: k?.tags }), ...(runsAs ? { runsAs } : {}) });
  }
  actions.sort((a, b) => a.platform.localeCompare(b.platform) || a.actionId.localeCompare(b.actionId));
  const unused = input.installed
    .map((a) => a.actionId)
    .filter((id) => !used.has(id))
    .sort();
  callSites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { manifest: { version: 1, actions, unused }, callSites, issues };
}

/** `.builder/actions.json`, or [] */
export function readInstalled(dir: string, projectDir: string): InstalledAction[] {
  const p = join(dir, projectDir, "actions.json");
  if (!existsSync(p)) return [];
  try {
    const v = JSON.parse(readFileSync(p, "utf8")) as unknown;
    return Array.isArray(v) ? (v as InstalledAction[]).filter((a) => a && typeof a.actionId === "string") : [];
  } catch {
    return [];
  }
}
