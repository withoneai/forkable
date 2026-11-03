// Environment variables, the rules both sides share (browser-safe).
//
// Two kinds of values pass through the secure input:
//   - a project's Connect app (ONE_CLIENT_ID and friends, per-project
//     Connect): the app's own Sign in with One in preview and published.
//     Kept per Connect setup, which one project owns or several link to;
//   - app values one project needs (a database token for publish,
//     APP_OWNER_EMAIL, any process.env.X / c.env.X its code reads).
//
// Values are write-only: they go from the browser to the local server once
// and no API sends them back. Nothing in this file ever puts a value in a
// message, so a validation result is safe to log or return.

import { BRAND } from "./brand.js";

export type EnvLevel = "ok" | "warn" | "error";
export interface EnvCheck {
  level: EnvLevel;
  message: string;
}

export interface ConnectVarSpec {
  name: string;
  label: string;
  secret: boolean;
  required: boolean;
  /** Where the value is in the One dashboard. */
  where: string;
  placeholder: string;
}

export const CONNECT_VAR_SPECS: ConnectVarSpec[] = [
  { name: "ONE_CLIENT_ID", label: "Client ID", secret: false, required: true, where: "On the app's page, Credentials, Client ID. Copy it with the chip next to it.", placeholder: "Paste the client ID" },
  { name: "ONE_CLIENT_SECRET", label: "Client secret", secret: true, required: true, where: "Credentials, Client secret. Shown once, right after you create the app. Regenerate makes a new one.", placeholder: "one_secret_..." },
  { name: "ONE_CONNECT_KEY", label: "Connect key", secret: true, required: true, where: "Credentials, Connect keys, Create key, with the dashboard on Production. Shown once.", placeholder: "sk_live_..." },
  { name: "ONE_PERMISSION_SET", label: "Ask id", secret: false, required: false, where: "Optional. What it asks for, Ask id. Apps in Everything mode have none; leave it empty.", placeholder: "Leave empty for an Everything app" },
];

export const CONNECT_VAR_NAMES = CONNECT_VAR_SPECS.map((s) => s.name);
/** Set by the platform for each place the app runs (the shared preview callback, the production URL), never stored. */
export const REDIRECT_VAR = "ONE_REDIRECT_URI";
export const ONE_DASHBOARD_URL = "https://app.withone.ai";

const NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

/** One parsed `NAME=value` line from a paste. */
export interface ParsedEntry {
  name: string;
  value: string;
}

export interface ParsedPaste {
  entries: ParsedEntry[];
  /** Lines that were not blank, not comments and not NAME=value. */
  skipped: number;
}

/**
 * A pasted block of `NAME=value` lines (a .env file, the dashboard's copy,
 * `export NAME="value"`, `NAME: value`) split into entries. Comments and
 * blank lines are ignored; a trailing ` # comment` after an unquoted value
 * is dropped. The last line for a name wins.
 */
export function parseEnvBlock(text: string): ParsedPaste {
  const byName = new Map<string, string>();
  let skipped = 0;
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:=|:)\s*(.*)$/.exec(line);
    if (!m || !NAME.test(m[1]!)) {
      skipped++;
      continue;
    }
    let v = m[2]!.trim();
    const q = v[0];
    if ((q === '"' || q === "'" || q === "`") && v.length >= 2) {
      const end = v.indexOf(q, 1);
      v = end > 0 ? v.slice(1, end) : v.slice(1);
      if (q === '"') v = v.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    } else {
      v = v.replace(/\s+#.*$/, "").replace(/[,;]$/, "").trim();
    }
    byName.set(m[1]!, v);
  }
  return { entries: [...byName].map(([name, value]) => ({ name, value })), skipped };
}

/** True when a paste is a block of lines to split, not one value for one field. */
export function looksLikeBlock(text: string): boolean {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim());
  if (!lines.length) return false;
  const kv = lines.filter((l) => /^\s*(?:export\s+)?[A-Z][A-Z0-9_]*\s*=/.test(l)).length;
  return kv >= 2 || (kv === 1 && lines.length === 1 && /^\s*(?:export\s+)?[A-Z][A-Z0-9_]*\s*=/.test(lines[0]!));
}

/** Which Connect field a bare value belongs in, by its shape. */
export function guessConnectName(value: string): string | null {
  const v = value.trim();
  if (/^one_secret_/.test(v)) return "ONE_CLIENT_SECRET";
  if (/^sk_(live|test)_/.test(v)) return "ONE_CONNECT_KEY";
  if (/^https?:\/\/[^\s]+\/api\/one\/callback\/?$/.test(v)) return REDIRECT_VAR;
  return null;
}

const LABEL: Record<string, string> = { ...Object.fromEntries(CONNECT_VAR_SPECS.map((s) => [s.name, s.label])), [REDIRECT_VAR]: "Redirect URI" };

function shapeOf(v: string): string | null {
  const g = guessConnectName(v);
  return g ? LABEL[g]! : null;
}

/**
 * Format checks for one Connect value. `redirectUri` is the exact callback
 * this server answers. Messages never contain the value.
 */
export function validateConnectVar(name: string, value: string, ctx: { redirectUri: string }): EnvCheck {
  const v = value.trim();
  if (name === REDIRECT_VAR) return { level: "error", message: `${BRAND.name} sets the redirect URI for each place the app runs. Register the addresses shown above instead.` };
  const spec = CONNECT_VAR_SPECS.find((s) => s.name === name);
  if (!spec) return { level: "error", message: "Not a Connect app setting." };
  if (!v) return spec.required ? { level: "error", message: "Required." } : { level: "ok", message: "Not set. The consent page lets each person pick their connections." };
  if (/\s/.test(v)) return { level: "error", message: "Has a space or a line break in it. Copy it again with the dashboard's copy chip." };
  if (/^\*+$|^•+$|\.\.\.$/.test(v)) return { level: "error", message: "That is the masked placeholder, not the value. Copy the value itself." };
  const other = shapeOf(v);
  switch (name) {
    case "ONE_CLIENT_ID":
      if (other) return { level: "error", message: `This looks like your ${other.toLowerCase()}. It belongs in ${other}.` };
      if (v.length < 6 || v.length > 200) return { level: "error", message: "A client ID is between 6 and 200 characters." };
      if (!/^[A-Za-z0-9._:-]+$/.test(v)) return { level: "error", message: "A client ID has letters, digits, dots, dashes, underscores and colons only." };
      return { level: "ok", message: "Looks like a client ID." };
    case "ONE_CLIENT_SECRET":
      if (other && other !== LABEL.ONE_CLIENT_SECRET) return { level: "error", message: `This looks like your ${other.toLowerCase()}. It belongs in ${other}.` };
      if (!v.startsWith("one_secret_")) return { level: "error", message: "A client secret starts with one_secret_." };
      if (v.length < 20) return { level: "error", message: "Too short for a client secret. It may have been cut off." };
      return { level: "ok", message: "Looks like a client secret." };
    case "ONE_CONNECT_KEY":
      if (other && other !== LABEL.ONE_CONNECT_KEY) return { level: "error", message: `This looks like your ${other.toLowerCase()}. It belongs in ${other}.` };
      if (v.startsWith("sk_test_")) return { level: "error", message: "Connect keys work in Production only. Switch the dashboard to Production and create the key there." };
      if (!v.startsWith("sk_live_")) return { level: "error", message: "A connect key starts with sk_live_." };
      if (v.length < 16) return { level: "error", message: "Too short for a connect key. It may have been cut off." };
      return { level: "ok", message: "Looks like a connect key." };
    case "ONE_REDIRECT_URI": {
      let u: URL;
      try {
        u = new URL(v);
      } catch {
        return { level: "error", message: "Not an address. It looks like http://127.0.0.1:51989/api/one/callback." };
      }
      if (v === ctx.redirectUri) return { level: "ok", message: "Matches the address this computer answers." };
      const want = new URL(ctx.redirectUri);
      if (u.pathname.replace(/\/$/, "") !== "/api/one/callback") return { level: "error", message: "The path must be /api/one/callback." };
      if (u.port !== want.port) return { level: "error", message: `The port must be ${want.port}, the one this server is pinned to.` };
      if (u.hostname === "localhost") return { level: "warn", message: `Works only if you registered the localhost form. ${ctx.redirectUri} is the one to register.` };
      return { level: "error", message: `Use ${ctx.redirectUri}, exactly.` };
    }
    case "ONE_PERMISSION_SET":
      if (other) return { level: "error", message: `This looks like your ${other.toLowerCase()}. It belongs in ${other}.` };
      if (/secret/i.test(v)) return { level: "error", message: "An ask id is not a secret. Copy the Ask id from What it asks for." };
      if (!/^[A-Za-z0-9._:-]{4,200}$/.test(v)) return { level: "error", message: "An ask id has letters, digits, dots, dashes, underscores and colons only." };
      return { level: "ok", message: "Looks like an ask id." };
  }
  return { level: "ok", message: "" };
}

// ---- app values (per project) ----------------------------------------------

/** Where a project value is used: the preview's dev server, the published app, or both. */
export type EnvTarget = "both" | "publish";

export interface KnownAppVar {
  why: string;
  target: EnvTarget;
  secret: boolean;
}

/** Names the template itself reads, with what they are for. */
export const KNOWN_APP_VARS: Record<string, KnownAppVar> = {
  DATABASE_URL: { why: "The libSQL database the published app keeps its data and sign-ins in. Preview uses its own local database.", target: "publish", secret: true },
  DATABASE_AUTH_TOKEN: { why: "The token for that libSQL database.", target: "publish", secret: true },
  APP_OWNER_EMAIL: { why: 'The One account whose grant public pages run on, for one(c, { as: "owner" }). In preview it is whoever signed in to the preview first.', target: "publish", secret: false },
};

/** Names the platform sets itself. A project cannot hold them. */
export function reservedAppVar(name: string): string | null {
  if (/^BUILDER_/.test(name) || name.startsWith("__")) return "The platform sets this one.";
  if (["ONE_MODE", "ONE_REDIRECT_URI", "ONE_API_URL", "APP_VISITOR_ACTIONS"].includes(name)) return "The platform sets this one.";
  if (CONNECT_VAR_NAMES.includes(name)) return "This is the app's Connect app. Set it in this project's Settings, One Connect.";
  if (["NODE_ENV", "PATH", "HOME", "PORT", "DB", "ASSETS", "CF_PAGES", "VERCEL", "VERCEL_ENV", "VERCEL_URL", "NODE_OPTIONS"].includes(name)) return "The host or the runtime sets this one.";
  return null;
}

/** Names that look like a credential are never shown, not even their last characters. */
export function isSecretName(name: string): boolean {
  const known = KNOWN_APP_VARS[name];
  if (known) return known.secret;
  return /SECRET|TOKEN|KEY|PASSWORD|PASSWD|PASS$|PRIVATE|CREDENTIAL|AUTH|DSN|_URL$|WEBHOOK|SIGNING|SALT|COOKIE/.test(name) || !/EMAIL|_ID$|NAME|REGION|MODE|LEVEL|HOST$|DOMAIN/.test(name);
}

export function targetOf(name: string): EnvTarget {
  return KNOWN_APP_VARS[name]?.target ?? "both";
}

export function validateAppName(name: string): EnvCheck {
  if (!NAME.test(name)) return { level: "error", message: "Use capital letters, digits and underscores, starting with a letter." };
  const r = reservedAppVar(name);
  if (r) return { level: "error", message: r };
  return { level: "ok", message: "" };
}

/** Format checks for a project value. Messages never contain the value. */
export function validateAppValue(name: string, value: string): EnvCheck {
  const v = value.trim();
  const n = validateAppName(name);
  if (n.level === "error") return n;
  if (!v) return { level: "error", message: "Empty. Remove it instead if the app should not have it." };
  if (v.length > 8192) return { level: "error", message: "Longer than 8 KB." };
  if (/[\r\n]/.test(v)) return { level: "error", message: "Has a line break in it. Values are one line." };
  if (/^\*+$|^•+$/.test(v)) return { level: "error", message: "That is a masked placeholder, not the value." };
  if (name === "APP_OWNER_EMAIL" &&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return { level: "error", message: "An email address, the one you sign in to One with." };
  if (name === "DATABASE_URL") {
    if (!/^(libsql|https?|wss?):\/\//.test(v)) return { level: "error", message: "A libSQL URL starts with libsql:// or https://." };
    if (/[?&](authToken|token)=|\/\/[^/@]+:[^/@]+@/.test(v)) return { level: "error", message: "Take the token out of the URL and set DATABASE_AUTH_TOKEN on its own." };
  }
  if (/^VITE_/.test(name) && isSecretName(name.slice(5))) return { level: "warn", message: "VITE_ values are built into the page anyone can read. Keep secrets in server code." };
  return { level: "ok", message: "" };
}

/** `…ab12`, for ids that are not secrets. Never used on a secret name. */
export function lastFour(value: string): string {
  const v = value.trim();
  return v.length <= 8 ? "…" : `…${v.slice(-4)}`;
}

/** Where a stored value lives, for the UI. */
export type EnvWhere = "keychain" | "file";

export function whereLabel(w: EnvWhere | null, file?: string): string {
  if (w === "keychain") return "macOS Keychain";
  if (w === "file") return file ? `${file} (only you can read it)` : "a file only you can read";
  return "Not set";
}
