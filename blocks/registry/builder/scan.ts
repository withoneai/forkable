import type { Manifest, ManifestAction, ScanIssue, SourceFile } from "./types.js";

// The scope manifest, derived from code, after Builder (builder/packages/core/src/scopes/extract.ts
// and publish/scan.ts). Builder walks the TypeScript AST with ts-morph; this
// is a dependency-free pass over the text: every object literal that names a
// One action id, with its platform, method and access, becomes a manifest
// entry. Provider SDKs and hosts that go around the grant (BLD004) and known
// secret shapes are reported by line, never by value.

const ID = /conn_mod_def::[A-Za-z0-9_-]+::[A-Za-z0-9_-]+/g;
const PROVIDER_SDKS = /^(googleapis|@googleapis\/.*|stripe|@stripe\/stripe-node|@slack\/.*|octokit|@octokit\/.*|@notionhq\/client|openai|@anthropic-ai\/sdk|@google\/genai|@google\/generative-ai|@hubspot\/.*|twilio|@sendgrid\/.*|resend|@linear\/sdk|@microsoft\/microsoft-graph-client|airtable|shopify-api-node|@shopify\/.*)$/;
const PROVIDER_HOSTS = /\b(api\.withone\.ai|[a-z0-9.-]*googleapis\.com|api\.stripe\.com|slack\.com\/api|api\.github\.com|graph\.microsoft\.com|api\.openai\.com|api\.anthropic\.com|api\.notion\.com|api\.hubapi\.com|api\.linear\.app|api\.airtable\.com|api\.twilio\.com|api\.sendgrid\.com)\b/i;
const SECRETS: { re: RegExp; label: string }[] = [
  { re: /\bsk_live_[A-Za-z0-9]{8,}/, label: "a Stripe live secret key (sk_live_)" },
  { re: /\bsk_test_[A-Za-z0-9]{8,}/, label: "a Stripe test secret key (sk_test_)" },
  { re: /\bone_secret_[A-Za-z0-9_-]{8,}/, label: "a One secret (one_secret_)" },
  { re: /\bghp_[A-Za-z0-9]{20,}/, label: "a GitHub token (ghp_)" },
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,}/, label: "a GitHub token (github_pat_)" },
  { re: /\bAKIA[0-9A-Z]{16}\b/, label: "an AWS access key (AKIA)" },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: "a private key block" },
  { re: /\bxox[bp]-[A-Za-z0-9-]{10,}/, label: "a Slack token (xoxb- or xoxp-)" },
];
const ENV_SECRET = /process\.env\.([A-Z0-9_]*(?:SECRET|_KEY|TOKEN|PASSWORD)[A-Z0-9_]*)/;

const lineAt = (text: string, i: number) => text.slice(0, i).split("\n").length;

/** The object literal around position i: from the nearest unmatched "{" before to its "}". */
function enclosing(text: string, i: number): string {
  let depth = 0;
  let start = i;
  for (; start >= 0; start--) {
    if (text[start] === "}") depth++;
    else if (text[start] === "{") {
      if (depth === 0) break;
      depth--;
    }
  }
  let end = i;
  depth = 0;
  for (; end < text.length; end++) {
    if (text[end] === "{") depth++;
    else if (text[end] === "}") {
      if (depth === 0) break;
      depth--;
    }
  }
  return start >= 0 ? text.slice(start, end + 1) : "";
}
const field = (obj: string, k: string) => obj.match(new RegExp(`\\b${k}\\s*:\\s*["'\`]([^"'\`]+)["'\`]`))?.[1] ?? null;

export function scanManifest(files: SourceFile[]): { manifest: Manifest; issues: ScanIssue[] } {
  const byId = new Map<string, ManifestAction>();
  const issues: ScanIssue[] = [];
  for (const f of files) {
    if (!/\.(m?[jt]sx?)$/.test(f.path)) continue;
    const text = f.content;
    for (const m of text.matchAll(ID)) {
      const obj = enclosing(text, m.index!);
      const platform = field(obj, "platform");
      if (!platform || !obj.includes("actionId")) {
        issues.push({ code: "BLD003", severity: "error", file: f.path, line: lineAt(text, m.index!), message: "An action id outside an action definition. Give it a platform and an access so it can go in the manifest." });
        continue;
      }
      const method = field(obj, "method");
      const access = (field(obj, "access") ?? (method && method.toUpperCase() !== "GET" ? "write" : "read")) as "read" | "write";
      const cur = byId.get(m[0]) ?? { platform, actionId: m[0], title: field(obj, "title"), method, access, usedBy: [] };
      if (!cur.usedBy.includes(f.path)) cur.usedBy.push(f.path);
      byId.set(m[0], cur);
    }
    text.split("\n").forEach((line, n) => {
      const imp = line.match(/(?:from\s+|require\(\s*|import\(\s*)["']([^"']+)["']/);
      if (imp && PROVIDER_SDKS.test(imp[1]!)) issues.push({ code: "BLD004", severity: "error", file: f.path, line: n + 1, message: `Imports ${imp[1]}, which calls the provider around the user's grant. Use a One action instead.` });
      const host = line.match(PROVIDER_HOSTS);
      if (host) issues.push({ code: "BLD004", severity: "error", file: f.path, line: n + 1, message: `Calls ${host[1]} directly, around the user's grant.` });
      for (const s of SECRETS) if (s.re.test(line)) issues.push({ code: "SECRET", severity: "error", file: f.path, line: n + 1, message: `Holds ${s.label}. Remove it; the grant replaces it.` });
      const env = line.match(ENV_SECRET);
      if (env) issues.push({ code: "SECRET", severity: "warning", file: f.path, line: n + 1, message: `Reads ${env[1]} from the environment. A provider secret should not be needed with Connect.` });
    });
  }
  const actions = [...byId.values()].sort((a, b) => a.platform.localeCompare(b.platform) || a.actionId.localeCompare(b.actionId));
  return { manifest: { $schema: "https://forkable.dev/schema/connect.manifest.v1.json", actions }, issues };
}
