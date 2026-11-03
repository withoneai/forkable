// Visitors on the owner's grant. Browser-safe.
//
// `one(c, { as: "owner" })` lets a visitor who is not signed in trigger an
// action on the app owner's grant (a public support form that files a
// Notion page). Whether that is allowed is the builder's call, per app and
// per action, off by default. The agent never turns it on: the setting
// lives in the platform's database, the dev check applies it in preview, and a
// published app gets it as APP_VISITOR_ACTIONS.

import type { Manifest, ManifestAction, VisitorGrant } from "./types.js";

export const VISITORS_OFF: VisitorGrant = { enabled: false, actions: [] };

/** The env var a published app reads: comma-separated action ids, or "none". */
export const VISITOR_ENV = "APP_VISITOR_ACTIONS";

const ACTION_ID = /^conn_mod_def::[A-Za-z0-9_-]+::[A-Za-z0-9_-]+$/;

/** Whatever the DB column holds, as a VisitorGrant (null and junk read as off). */
export function parseVisitors(v: unknown): VisitorGrant {
  if (!v || typeof v !== "object") return { ...VISITORS_OFF, actions: [] };
  const o = v as Record<string, unknown>;
  const actions = Array.isArray(o.actions) ? [...new Set(o.actions.filter((a): a is string => typeof a === "string" && ACTION_ID.test(a)))].sort() : [];
  return { enabled: o.enabled === true, actions };
}

/** The ids visitors may trigger now. */
export function allowedForVisitors(v: VisitorGrant): Set<string> {
  return new Set(v.enabled ? v.actions : []);
}

export const runsAsOwner = (a: Pick<ManifestAction, "runsAs">): boolean => a.runsAs?.includes("owner") === true;
export const runsAsUser = (a: Pick<ManifestAction, "runsAs">): boolean => !a.runsAs || a.runsAs.includes("user");

/** Owner-run actions in the manifest, split by whether the builder allowed them. */
export function visitorSplit(m: Manifest, v: VisitorGrant): { allowed: ManifestAction[]; notAllowed: ManifestAction[] } {
  const ok = allowedForVisitors(v);
  const owner = m.actions.filter(runsAsOwner);
  return { allowed: owner.filter((a) => ok.has(a.actionId)), notAllowed: owner.filter((a) => !ok.has(a.actionId)) };
}

/** The value a published app gets: the allowed owner-run ids of this manifest, or "none". */
export function visitorEnvValue(m: Manifest, v: VisitorGrant): string {
  const ids = visitorSplit(m, v).allowed.map((a) => a.actionId).sort();
  return ids.length ? ids.join(",") : "none";
}

export interface VisitorPatch {
  enabled?: boolean;
  /** Tick these. */
  allow?: string[];
  /** Untick these. */
  disallow?: string[];
}

/** Apply a patch (the Allow card sends enabled: true with its ids). */
export function patchVisitors(v: VisitorGrant, p: VisitorPatch): VisitorGrant {
  const set = new Set(v.actions);
  for (const id of p.allow ?? []) if (ACTION_ID.test(id)) set.add(id);
  for (const id of p.disallow ?? []) set.delete(id);
  return { enabled: p.enabled ?? v.enabled, actions: [...set].sort() };
}
