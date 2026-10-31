// Canonical JSON (RFC 8785 style: sorted keys, no whitespace) and the three profile hashes
// (CONTRACT 4.1). sha256 hex, first 16 chars.

import { createHash } from "node:crypto";
import type { EngineVersions, ProfileHashes, SearchProfile } from "../contract.js";
import { DECODER_VERSION } from "../decode/index.js";

// normalize 2 (D45): dates fall back to the record's own keys, never the fetch time; nothing past two years out;
// `is.allEmails`. A bump re-maps every source once from stored payloads on its next run (no API calls).
export const ENGINE_VERSIONS: EngineVersions = { decoder: DECODER_VERSION, chunker: 1, normalize: 2 };

export function canonicalJson(v: unknown): string {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") {
    if (typeof v === "number" && !Number.isFinite(v)) return "null";
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : canonicalJson(x))).join(",")}]`;
  const keys = Object.keys(v as object).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
}

export function sha16(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function hashProfile(p: SearchProfile, versions: EngineVersions = ENGINE_VERSIONS, embeddingModel = ""): ProfileHashes {
  const fetchHash = sha16(canonicalJson({ list: p.list, partitions: p.partitions, incremental: p.incremental, hydrate: p.hydrate, keep: p.keep, deletes: p.deletes, account: p.account }));
  const mapHash = sha16(canonicalJson({ kind: p.kind, fields: p.fields, entities: p.entities, chunk: p.chunk, decoder: versions.decoder, normalize: versions.normalize, chunker: versions.chunker }));
  const indexHash = sha16(canonicalJson({ classify: p.classify, embedding: embeddingModel, chunker: versions.chunker }));
  const profileHash = sha16(fetchHash + mapHash + indexHash);
  return { fetchHash, mapHash, indexHash, profileHash };
}

/** Which hydrate part changed between two profiles (fingerprints reset only then). */
export function hydrateChanged(a: SearchProfile, b: SearchProfile): boolean {
  return canonicalJson(a.hydrate) !== canonicalJson(b.hydrate);
}

/** Every action id a profile can call (account, partitions, list, hydrate, children, delta bootstrap). */
export function profileActionIds(p: SearchProfile): string[] {
  const ids: string[] = [];
  if (p.account?.request) ids.push(p.account.request.actionId);
  for (let ps: { actionId: string; next?: unknown } | undefined = p.partitions; ps; ps = ps.next as typeof ps) ids.push(ps.actionId);
  ids.push(p.list.actionId);
  if (p.hydrate) { ids.push(p.hydrate.request.actionId); for (const c of p.hydrate.children ?? []) ids.push(c.request.actionId); }
  if (p.incremental.strategy === "delta" && p.incremental.bootstrap) ids.push(p.incremental.bootstrap.actionId);
  return [...new Set(ids)];
}

const SETTING_REF = /\bsettings\.([A-Za-z_][A-Za-z0-9_]*)/g;

function settingRefs(v: unknown): string[] {
  const out = new Set<string>();
  for (const m of canonicalJson(v ?? null).matchAll(SETTING_REF)) out.add(m[1]!);
  return [...out].sort();
}

function settingsKey(names: string[], settings: Record<string, unknown>): string {
  return names.length ? sha16(canonicalJson(Object.fromEntries(names.map((n) => [n, settings[n] ?? null])))) : "";
}

/**
 * The settings a fetch reads (`settings.*` inside list, partitions, incremental, hydrate, keep,
 * deletes, account), resolved, as short keys. `fetch` covers all of them; `hydrate` only the
 * hydrate request and its children. Empty when the part reads no setting.
 */
export function fetchSettingsKeys(p: SearchProfile, settings: Record<string, unknown>): { fetch: string; hydrate: string } {
  return {
    fetch: settingsKey(settingRefs({ list: p.list, partitions: p.partitions, incremental: p.incremental, hydrate: p.hydrate, keep: p.keep, deletes: p.deletes, account: p.account }), settings),
    hydrate: settingsKey(settingRefs(p.hydrate), settings),
  };
}

/**
 * The fetch hash a source runs under: the version's fetchHash with the resolved settings the
 * fetch reads folded in, so changing such a setting (or its default in a new version) resets
 * cursors and runs a full pass, the same as editing the fetch part itself.
 */
export function effectiveFetchHash(versionFetchHash: string, p: SearchProfile, settings: Record<string, unknown>): string {
  const k = fetchSettingsKeys(p, settings).fetch;
  return k ? sha16(`${versionFetchHash}\u0000${k}`) : versionFetchHash;
}

/**
 * Whether a source's last good fetch ran under different fetch inputs than it would now.
 * A hash stored before settings were folded in (it equals the bare version hash) counts as
 * current unless the hydrate request reads a setting: those sources need one pass to
 * re-hydrate with the setting in the fingerprint.
 */
export function fetchIsStale(stored: string | null, versionFetchHash: string, p: SearchProfile, settings: Record<string, unknown>): boolean {
  if (!stored) return false;
  const eff = effectiveFetchHash(versionFetchHash, p, settings);
  if (stored === eff) return false;
  if (stored === versionFetchHash && !fetchSettingsKeys(p, settings).hydrate) return false;
  return true;
}
