// Sharing profiles (SPEC 10.7): export a pack file, import one from a file, a
// paste or an https URL. An import is previewed first (validation report and a
// diff against any installed copy), then accepted. Exports never carry a user
// id, a connection or account vars.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { and, eq, isNull, or } from "drizzle-orm";
import type { ImportPreview, SearchProfile, SearchProfilePack, ValidationIssue } from "../contract.js";
import type { Db } from "../db/client.js";
import { profiles, profileVersions } from "../db/schema.js";
import { SearchError } from "../errors.js";
import { newId } from "../ids.js";
import { platformName } from "../platforms.js";
import { upsertProfileVersion } from "./builtins.js";
import { canonicalJson, hashProfile } from "./hash.js";
import { PackError, parsePack } from "./packs.js";
import { PACK_SCHEMA_ID } from "./schema.js";
import { validateProfile } from "./validate.js";

export const MAX_PACK_BYTES = 256 * 1024;
const IMPORT_TTL_MS = 30 * 60_000;

/** A profile the user may read: a built-in, or one of theirs. */
export async function readableProfile(db: Db, userId: string, profileId: string): Promise<{ row: typeof profiles.$inferSelect; json: SearchProfile; version: number } | null> {
  const [r] = await db.select({ p: profiles, v: profileVersions }).from(profiles).innerJoin(profileVersions, eq(profileVersions.id, profiles.currentVersionId))
    .where(and(eq(profiles.id, profileId), or(isNull(profiles.userId), eq(profiles.userId, userId))));
  return r ? { row: r.p, json: r.v.json, version: r.v.version } : null;
}

/** The shareable copy: author "builtin" stays, anything else becomes "community"; no proposal draft id. */
export function shareable(p: SearchProfile): SearchProfile {
  const { proposal: _p, ...rest } = p;
  return { ...rest, author: p.author === "builtin" ? "builtin" : "community" };
}

export async function exportPack(db: Db, userId: string, profileId: string): Promise<SearchProfilePack> {
  const r = await readableProfile(db, userId, profileId);
  if (!r) throw new SearchError("not_found", "No such profile.");
  return { $schema: PACK_SCHEMA_ID as SearchProfilePack["$schema"], name: platformName(r.json.platform), platform: r.json.platform, profiles: [shareable(r.json)] };
}

const imports = new Map<string, { userId: string; pack: SearchProfilePack; origin: "import" | "url"; url: string | null; at: number }>();

const SECTIONS = ["list", "partitions", "incremental", "hydrate", "deletes", "keep", "account", "kind", "fields", "entities", "chunk", "classify", "settings", "limits", "schedule"] as const;

/** Previews a pack: parse, validate every profile, diff against what the user has installed. */
export async function importPack(db: Db, userId: string, input: unknown, opts: { origin?: "import" | "url"; url?: string } = {}): Promise<ImportPreview> {
  let pack: SearchProfilePack;
  try {
    pack = parsePack(input, "import");
  } catch (e) {
    const issues: ValidationIssue[] = e instanceof PackError ? e.issues.map((m) => ({ check: "schema", level: "error", message: m })) : [{ check: "schema", level: "error", message: (e as Error).message }];
    throw new SearchError("invalid_profile", "That file is not a Search profile pack.", { report: { ok: false, issues } });
  }
  const issues: ValidationIssue[] = [];
  const diff: ImportPreview["diff"] = [];
  for (const raw of pack.profiles) {
    const p = { ...raw, author: raw.author === "builtin" ? "community" : raw.author ?? "community" };
    const rep = validateProfile(p);
    issues.push(...rep.issues.map((i) => ({ ...i, profileId: p.id })));
    if (!rep.issues.some((i) => i.level === "error")) issues.push({ check: "schema", level: "ok", message: "Matches profile-1", profileId: p.id });
    if (p.list.actionId.startsWith("sample::") || p.sampleOnly) issues.push({ check: "actions", level: "warn", message: "Sample actions: this profile runs only in the Acme sample", profileId: p.id });
    const [mine] = await db.select({ v: profileVersions }).from(profiles).innerJoin(profileVersions, eq(profileVersions.id, profiles.currentVersionId)).where(and(eq(profiles.userId, userId), eq(profiles.slug, p.id)));
    const [built] = mine ? [] : await db.select({ v: profileVersions }).from(profiles).innerJoin(profileVersions, eq(profileVersions.id, profiles.currentVersionId)).where(and(isNull(profiles.userId), eq(profiles.slug, p.id)));
    const have = mine?.v ?? built?.v;
    if (!have) { diff.push({ profileId: p.id, status: "new", changedSections: [] }); continue; }
    const changed = SECTIONS.filter((s) => canonicalJson((have.json as unknown as Record<string, unknown>)[s] ?? null) !== canonicalJson((p as unknown as Record<string, unknown>)[s] ?? null));
    diff.push({ profileId: p.id, status: hashProfile(p).profileHash === have.profileHash && !changed.length ? "same" : "changed", changedSections: [...changed] });
  }
  const importId = newId("imp");
  for (const [k, v] of imports) if (Date.now() - v.at > IMPORT_TTL_MS) imports.delete(k);
  imports.set(importId, { userId, pack, origin: opts.origin ?? "import", url: opts.url ?? null, at: Date.now() });
  return { importId, pack, report: { ok: !issues.some((i) => i.level === "error"), issues }, diff };
}

/** Installs a previewed pack as the user's own profiles (origin import or url). */
export async function acceptImport(db: Db, userId: string, importId: string): Promise<string[]> {
  const imp = imports.get(importId);
  if (!imp || imp.userId !== userId || Date.now() - imp.at > IMPORT_TTL_MS) throw new SearchError("not_found", "That import expired. Import the file again.");
  const ids: string[] = [];
  for (const raw of imp.pack.profiles) {
    const p = { ...raw, author: raw.author === "builtin" ? "community" : raw.author ?? "community" };
    if (validateProfile(p).issues.some((i) => i.level === "error")) throw new SearchError("invalid_profile", `${p.id} does not validate.`, { report: validateProfile(p) });
    const r = await upsertProfileVersion(db, userId, p, imp.origin, userId, imp.url ? `Imported from ${imp.url}` : "Imported");
    if (imp.url) await db.update(profiles).set({ originUrl: imp.url }).where(eq(profiles.id, r.profileId));
    ids.push(r.profileId);
  }
  imports.delete(importId);
  return ids;
}

function privateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const l = ip.toLowerCase();
    if (l === "::1" || l === "::" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80")) return true;
    const m = /::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(l);
    return m ? privateAddress(m[1]!) : false;
  }
  const [a, b] = ip.split(".").map(Number) as [number, number];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/** Fetches a pack by URL: https only, 256 KB cap, 5 s timeout, no redirects, no private addresses. */
export async function fetchPackUrl(url: string, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  let u: URL;
  try { u = new URL(url); } catch { throw new SearchError("bad_request", "That is not a URL."); }
  if (u.protocol !== "https:") throw new SearchError("bad_request", "Import URLs must be https.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addrs.length) throw new SearchError("bad_request", `Could not find ${host}.`);
  if (addrs.some(privateAddress)) throw new SearchError("bad_request", "Import URLs must be on the public internet.");
  const res = await fetchImpl(u, { redirect: "manual", signal: AbortSignal.timeout(5000), headers: { accept: "application/json" } }).catch((e: Error) => { throw new SearchError("upstream_error", `Could not fetch the pack: ${e.message}`); });
  if (res.status >= 300 && res.status < 400) throw new SearchError("bad_request", "The URL redirects. Use the final address.");
  if (!res.ok) throw new SearchError("upstream_error", `The URL answered ${res.status}.`, { status: res.status });
  const reader = res.body?.getReader();
  let size = 0;
  const parts: Uint8Array[] = [];
  if (reader) for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_PACK_BYTES) { await reader.cancel(); throw new SearchError("bad_request", "The pack is over 256 KB."); }
    parts.push(value);
  }
  try { return JSON.parse(Buffer.concat(parts).toString("utf8")); } catch { throw new SearchError("bad_request", "The URL did not answer JSON."); }
}
