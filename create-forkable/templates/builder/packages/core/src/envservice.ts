// Environment values on the platform (Node only): each Connect app's values
// (per-project Connect, scope connect:<setupId>) and each project's app
// values. Status goes out by name; values go to three readers only (a
// project's dev server, publish, the sample stub One checking its own fake
// credentials), never to a route, a log, an event, a harness, a prompt or a
// project file.

import { randomBytes } from "node:crypto";
import { PREVIEW_CALLBACK } from "./brand.js";
import { scanEnvRefs, type EnvRef } from "./envscan.js";
import { EnvStore, type EnvScope, type EnvStoreOptions } from "./envstore.js";
import {
  CONNECT_VAR_NAMES,
  CONNECT_VAR_SPECS,
  KNOWN_APP_VARS,
  isSecretName,
  lastFour,
  targetOf,
  validateAppValue,
  validateConnectVar,
  whereLabel,
  type EnvWhere,
} from "./envvars.js";
import type { ConnectCheckResponse, EnvCheckItem, EnvStoreInfo, EnvVarStatus, ProjectEnvVar } from "./api-types.js";
import type { Home } from "./home.js";
import type { Manifest } from "./types.js";

/** The preview redirect URI every Connect app registers once (the proxy's shared callback). */
export const CONNECT_REDIRECT_URI = PREVIEW_CALLBACK;

/** A refusal whose message names fields, never values. */
export class EnvInvalid extends Error {
  constructor(
    message: string,
    readonly fields: Record<string, string>,
  ) {
    super(message);
  }
}

/** Asks One whether it knows this client id and secret (no user, nothing executed). Injected so tests stay offline. */
export type ConnectProbe = (clientId: string, clientSecret: string, redirectUri: string) => Promise<{ online: ConnectCheckResponse["online"]; message: string }>;

/**
 * The token endpoint with a code that cannot exist: `invalid_grant` means
 * One accepted the client id and secret and only refused the code;
 * `invalid_client` or 401 means it did not. Nothing is created or run.
 */
export const oneTokenProbe: ConnectProbe = async (clientId, clientSecret, redirectUri) => {
  try {
    const body = new URLSearchParams({ grant_type: "authorization_code", code: `check-${randomBytes(12).toString("hex")}`, redirect_uri: redirectUri, code_verifier: randomBytes(32).toString("base64url") });
    const res = await fetch("https://api.withone.ai/oauth/token", {
      method: "POST",
      headers: { authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(8000),
    });
    let error = "";
    try {
      error = String(((await res.json()) as { error?: unknown }).error ?? "");
    } catch {
      /* not an OAuth body */
    }
    if (error === "invalid_client" || res.status === 401) return { online: "refused", message: "One did not accept this client ID and secret. Copy both again from the app's Credentials." };
    if (error === "invalid_grant" || error === "invalid_request") return { online: "accepted", message: "One knows this app: it accepted the client ID and secret." };
    return { online: "unreachable", message: `One answered HTTP ${res.status}, so the client ID and secret could not be confirmed. The first sign-in will tell.` };
  } catch {
    return { online: "unreachable", message: "Could not reach One from this computer. The format checks above still hold." };
  }
};

export interface EnvServiceOptions extends EnvStoreOptions {
  home: Home;
  /** "sample" with the stub grant: Check answers without calling One. */
  probe?: ConnectProbe | "sample" | null;
  log?: (line: string) => void;
}

export class EnvService {
  readonly store: EnvStore;
  /** Per server process. Every change carries it back in a header. */
  readonly csrf = randomBytes(24).toString("base64url");
  /** Values loaded for a running dev server, so its output can be scrubbed. */
  private loaded = new Map<string, string[]>();
  /** Secrets of every Connect app loaded in this process, scrubbed from any output. */
  private connectSecrets = new Set<string>();
  /** Connect app values read this process (the Keychain is a subprocess per value). Dropped on every change. */
  private setupCache = new Map<string, Record<string, string>>();

  constructor(private o: EnvServiceOptions) {
    this.store = new EnvStore(o.home, o);
  }

  storeInfo(scope: EnvScope): EnvStoreInfo {
    const file = this.store.displayFile(scope);
    return { preferred: this.store.preferred, label: whereLabel(this.store.preferred, file), file };
  }

  private status(scope: EnvScope, name: string, secret: boolean, required: boolean): EnvVarStatus {
    const s = this.store.status(scope).find((x) => x.name === name);
    return {
      name,
      present: Boolean(s),
      secret,
      required,
      where: s?.where ?? null,
      whereLabel: s ? whereLabel(s.where, s.where === "file" ? this.store.displayFile(scope) : undefined) : "Not set",
      updatedAt: s?.updatedAt || null,
      hint: secret ? null : (s?.hint ?? null),
      ...(s?.manual ? { manual: true } : {}),
    };
  }

  // ---- Connect apps (scope connect:<setupId>) --------------------------------

  private setupScope(setupId: string): EnvScope {
    return `connect:${setupId}`;
  }

  /** Each Connect value's status for one setup: names, where, last four of the client id. Never a value. */
  setupStatus(setupId: string): EnvVarStatus[] {
    return CONNECT_VAR_SPECS.map((spec) => this.status(this.setupScope(setupId), spec.name, spec.secret, spec.required));
  }

  /** The client id, secret and connect key are all set. */
  setupConfigured(setupId: string): boolean {
    const have = new Set(this.store.status(this.setupScope(setupId)).map((x) => x.name));
    return CONNECT_VAR_SPECS.filter((s) => s.required).every((s) => have.has(s.name));
  }

  /** A setup's values, for the dev server, publish and the sample stub One only. */
  async setupValues(setupId: string): Promise<Record<string, string>> {
    const hit = this.setupCache.get(setupId);
    if (hit) return { ...hit };
    const v = await this.store.values(this.setupScope(setupId));
    this.setupCache.set(setupId, { ...v });
    for (const spec of CONNECT_VAR_SPECS) if (spec.secret && v[spec.name] && v[spec.name]!.length >= 4) this.connectSecrets.add(v[spec.name]!);
    return v;
  }

  /** Format checks for a set of Connect values; throws EnvInvalid naming the fields that fail. */
  private validateConnect(values: Record<string, string>): void {
    const fields: Record<string, string> = {};
    for (const [name, v] of Object.entries(values)) {
      const spec = CONNECT_VAR_SPECS.find((s) => s.name === name);
      if (!spec) {
        fields[name] = validateConnectVar(name, v, { redirectUri: CONNECT_REDIRECT_URI }).message || "Not a Connect app setting.";
        continue;
      }
      if (!v.trim() && !spec.required) continue;
      const r = validateConnectVar(name, v, { redirectUri: CONNECT_REDIRECT_URI });
      if (r.level === "error") fields[name] = r.message;
    }
    const k = values.ONE_CLIENT_SECRET?.trim();
    if (k && k === values.ONE_CONNECT_KEY?.trim()) fields.ONE_CONNECT_KEY = "The same value as the client secret. The connect key is a different value, starting with sk_live_.";
    if (Object.keys(fields).length) throw new EnvInvalid(`Check ${Object.keys(fields).length === 1 ? "this field" : "these fields"}: ${Object.keys(fields).join(", ")}.`, fields);
  }

  /** Save some or all of a Connect app's values. Empty optional values are removed. */
  async saveSetup(setupId: string, values: Record<string, string>): Promise<Record<string, EnvWhere>> {
    const clean = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v ?? "").trim()]));
    this.validateConnect(clean);
    const set = Object.fromEntries(Object.entries(clean).filter(([, v]) => v));
    const drop = Object.entries(clean).filter(([, v]) => !v).map(([k]) => k);
    const hints = Object.fromEntries(
      Object.entries(set).map(([k, v]) => {
        const spec = CONNECT_VAR_SPECS.find((s) => s.name === k)!;
        return [k, spec.secret ? null : lastFour(v)];
      }),
    );
    const scope = this.setupScope(setupId);
    this.setupCache.delete(setupId);
    const where = Object.keys(set).length ? await this.store.set(scope, set, hints) : {};
    if (drop.length) await this.store.remove(scope, drop);
    for (const spec of CONNECT_VAR_SPECS) if (spec.secret && set[spec.name] && set[spec.name]!.length >= 4) this.connectSecrets.add(set[spec.name]!);
    this.o.log?.(`env: Connect app ${setupId} ${Object.keys(set).length ? `saved ${Object.keys(set).join(", ")}` : ""}${drop.length ? ` removed ${drop.join(", ")}` : ""}`.trim());
    return where;
  }

  async removeSetupVar(setupId: string, name: string): Promise<void> {
    if (!CONNECT_VAR_SPECS.some((s) => s.name === name)) throw new EnvInvalid("Not a Connect app setting.", { [name]: "Not a Connect app setting." });
    this.setupCache.delete(setupId);
    await this.store.remove(this.setupScope(setupId), [name]);
    this.o.log?.(`env: Connect app ${setupId} removed ${name}`);
  }

  /** Copy every value of one setup into another (Copy instead of link, Save as template). Values stay in this process. */
  async copySetup(fromId: string, toId: string): Promise<void> {
    const v = await this.store.values(this.setupScope(fromId));
    const set = Object.fromEntries(Object.entries(v).filter(([k]) => CONNECT_VAR_SPECS.some((s) => s.name === k)));
    if (!Object.keys(set).length) return;
    const hints = Object.fromEntries(Object.entries(set).map(([k, x]) => [k, CONNECT_VAR_SPECS.find((s) => s.name === k)!.secret ? null : lastFour(x)]));
    this.setupCache.delete(toId);
    await this.store.set(this.setupScope(toId), set, hints);
    this.o.log?.(`env: Connect app ${toId} copied from ${fromId}`);
  }

  async dropSetup(setupId: string): Promise<void> {
    this.setupCache.delete(setupId);
    await this.store.removeScope(this.setupScope(setupId));
  }

  /** Values of the retired builder-level Connect app (BUILDER_HOME/.env or the Keychain), to move into a template once. */
  async legacyBuilderValues(): Promise<Record<string, string>> {
    if (!this.store.status("builder").length) return {};
    return this.store.values("builder");
  }

  async dropLegacyBuilder(names: string[]): Promise<void> {
    if (names.length) await this.store.remove("builder", names);
  }

  /** Values one project kept under its own app values before per-project Connect (moved into its own setup once). */
  async legacyProjectConnect(projectId: string): Promise<Record<string, string>> {
    const scope = this.scope(projectId);
    const names = new Set(this.store.status(scope).map((x) => x.name));
    if (!CONNECT_VAR_SPECS.some((s) => names.has(s.name))) return {};
    const all = await this.store.values(scope);
    return Object.fromEntries(Object.entries(all).filter(([k]) => CONNECT_VAR_SPECS.some((s) => s.name === k)));
  }

  async dropLegacyProjectConnect(projectId: string, names: string[]): Promise<void> {
    if (names.length) await this.store.remove(this.scope(projectId), names);
  }

  /**
   * Check a Connect app: each value's format (typed values over stored
   * ones), that the required ones are there, then One's answer to the
   * client id and secret. Values are never in the answer.
   */
  async checkSetup(setupId: string | null, typed: Record<string, string> = {}): Promise<ConnectCheckResponse> {
    const merged: Record<string, string> = setupId ? { ...(await this.store.values(this.setupScope(setupId))) } : {};
    for (const [k, v] of Object.entries(typed)) if (typeof v === "string" && v.trim()) merged[k] = v.trim();
    const items: EnvCheckItem[] = CONNECT_VAR_SPECS.map((spec) => {
      const v = merged[spec.name] ?? "";
      const r = validateConnectVar(spec.name, v, { redirectUri: CONNECT_REDIRECT_URI });
      return { name: spec.name, level: r.level, message: r.message };
    });
    if (merged.ONE_CLIENT_SECRET && merged.ONE_CLIENT_SECRET === merged.ONE_CONNECT_KEY) {
      const i = items.find((x) => x.name === "ONE_CONNECT_KEY")!;
      i.level = "error";
      i.message = "The same value as the client secret. The connect key is a different value.";
    }
    const formatOk = items.every((i) => i.level !== "error");
    let online: ConnectCheckResponse["online"] = "skipped";
    let onlineMessage = formatOk ? "" : "Fix the fields marked above, then check again.";
    if (formatOk) {
      if (this.o.probe === "sample") {
        online = "sample";
        onlineMessage = "Sample mode: nothing is sent to One. The format checks above are real.";
      } else if (this.o.probe) {
        const r = await this.o.probe(merged.ONE_CLIENT_ID!, merged.ONE_CLIENT_SECRET!, CONNECT_REDIRECT_URI);
        online = r.online;
        onlineMessage = r.message;
      } else {
        onlineMessage = "Checked on this computer. The first sign-in confirms the rest.";
      }
    }
    const connectKey = items.find((i) => i.name === "ONE_CONNECT_KEY");
    if (connectKey && connectKey.level === "ok") connectKey.message = "Looks like a connect key. One checks it on the first sign-in.";
    return { ok: formatOk && online !== "refused", items, online, onlineMessage };
  }

  /** Remember what a project's dev server was given, so its output can be scrubbed. */
  noteLoaded(projectId: string, values: Record<string, string>): void {
    this.loaded.set(projectId, [...new Set([...(this.loaded.get(projectId) ?? []), ...Object.values(values)])].filter((v) => v.length >= 4));
  }

  // ---- project values ------------------------------------------------------

  private scope(projectId: string): EnvScope {
    return `project:${projectId}`;
  }

  /** What the code reads (file:line), what the app's setup needs, and what is stored. */
  projectStatus(project: { id: string; path: string }, manifest?: Manifest | null): { vars: ProjectEnvVar[]; missing: string[]; publishMissing: string[] } {
    const refs = new Map<string, EnvRef>(scanEnvRefs(project.path).map((r) => [r.name, r]));
    const scope = this.scope(project.id);
    const stored = new Set(this.store.status(scope).map((s) => s.name));
    const needs = new Set(refs.keys());
    // Public pages on the owner's grant need the owner's account once published.
    if (manifest?.actions.some((a) => a.runsAs?.includes("owner"))) needs.add("APP_OWNER_EMAIL");
    // The app's Connect app is not an app value: it lives in Settings, One Connect.
    for (const n of CONNECT_VAR_NAMES) {
      needs.delete(n);
      stored.delete(n);
    }
    const names = [...new Set([...needs, ...stored])].sort();
    const vars: ProjectEnvVar[] = names.map((name) => {
      const ref = refs.get(name);
      const secret = isSecretName(name);
      const target = targetOf(name);
      return {
        ...this.status(scope, name, secret, needs.has(name)),
        target,
        why: KNOWN_APP_VARS[name]?.why ?? null,
        sites: ref?.sites.slice(0, 8) ?? [],
        client: ref?.client ?? false,
        needed: needs.has(name),
      };
    });
    return {
      vars,
      missing: vars.filter((v) => v.needed && !v.present && v.target === "both").map((v) => v.name),
      publishMissing: vars.filter((v) => v.needed && !v.present).map((v) => v.name),
    };
  }

  async saveProject(projectId: string, values: Record<string, string>): Promise<Record<string, EnvWhere>> {
    const fields: Record<string, string> = {};
    const clean: Record<string, string> = {};
    for (const [name, raw] of Object.entries(values)) {
      const v = String(raw ?? "").trim();
      const r = validateAppValue(name, v);
      if (r.level === "error") fields[name] = r.message;
      else clean[name] = v;
    }
    if (Object.keys(fields).length) throw new EnvInvalid(`Check ${Object.keys(fields).join(", ")}.`, fields);
    if (!Object.keys(clean).length) throw new EnvInvalid("Nothing to save.", {});
    const hints = Object.fromEntries(Object.entries(clean).map(([k, v]) => [k, isSecretName(k) ? null : lastFour(v)]));
    const where = await this.store.set(this.scope(projectId), clean, hints);
    this.o.log?.(`env: project ${projectId} saved ${Object.keys(clean).join(", ")}`);
    return where;
  }

  async removeProject(projectId: string, name: string): Promise<void> {
    await this.store.remove(this.scope(projectId), [name]);
    this.o.log?.(`env: project ${projectId} removed ${name}`);
  }

  async dropProject(projectId: string): Promise<void> {
    this.loaded.delete(projectId);
    await this.store.removeScope(this.scope(projectId));
  }

  /**
   * A project's values for one place: "preview" (its dev server: everything
   * but the published-only names) or "publish" (all of them). Remembered for
   * scrubbing that project's output.
   */
  async projectValues(projectId: string, target: "preview" | "publish"): Promise<Record<string, string>> {
    const all = Object.fromEntries(Object.entries(await this.store.values(this.scope(projectId))).filter(([k]) => !CONNECT_VAR_NAMES.includes(k)));
    const out = target === "publish" ? all : Object.fromEntries(Object.entries(all).filter(([k]) => targetOf(k) === "both"));
    this.loaded.set(projectId, [...new Set([...(this.loaded.get(projectId) ?? []), ...Object.values(all)])].filter((v) => v.length >= 4));
    return out;
  }

  /** Replace any stored value of this project (or any Connect app's secret) in a line of output. */
  redact(projectId: string | null, text: string): string {
    const vals = [...(projectId ? (this.loaded.get(projectId) ?? []) : []), ...this.connectSecrets];
    let out = text;
    for (const v of vals.sort((a, b) => b.length - a.length)) if (out.includes(v)) out = out.split(v).join("[hidden]");
    return out;
  }

  /** The line the agent gets each turn: names and set or missing, never a value. */
  facts(project: { id: string; path: string }, manifest?: Manifest | null): string {
    const { vars } = this.projectStatus(project, manifest);
    if (!vars.length) return "";
    const list = vars.map((v) => `${v.name} ${v.present ? "set" : "missing"}${v.target === "publish" ? " (published app only)" : ""}`).join(", ");
    return `Environment (names only; values never reach you): ${list}. Missing values are set by the builder in the Environment card, never in chat.`;
  }
}
