// Manifest -> Connect permission set ("ask"), and manifest diffs.
// Browser-safe.

import type { PermissionSetAsk } from "../api-types.js";
import { verbFor } from "../catalog/naming.js";
import type { ActionLevel, Manifest, ManifestAction, ManifestDiff } from "../types.js";

export const EMPTY_MANIFEST: Manifest = { version: 1, actions: [], unused: [] };

/** One rule per connector, keyed by conn_def id; connectors without one are reported, not guessed. */
export function toAsk(manifest: Manifest, projectName: string): { ask: PermissionSetAsk; missing: string[] } {
  const by = new Map<string, ManifestAction[]>();
  const missing = new Set<string>();
  for (const a of manifest.actions) {
    if (!a.connDefId) {
      missing.add(a.platform);
      continue;
    }
    by.set(a.connDefId, [...(by.get(a.connDefId) ?? []), a]);
  }
  const connectorRules = [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([connectionDefinitionId, list]) => ({
      type: "connectionDefinition" as const,
      connectionDefinitionId,
      methods: [...new Set(list.map((a) => a.method.toUpperCase()))].sort(),
      actionIds: [...new Set(list.map((a) => a.actionId))].sort(),
    }));
  return { ask: { name: `${projectName} ask`, connectorRules }, missing: [...missing].sort() };
}

const RANK: Record<ActionLevel, number> = { read: 0, write: 1, delete: 2 };

/** "Gmail · send (write)" */
export function manifestLine(a: Pick<ManifestAction, "method" | "level"> & { path?: string; title: string; platform: string }, platformName: string): string {
  const verb = a.path ? verbFor({ method: a.method, path: a.path, platform: a.platform }) : a.title;
  return `${platformName} · ${verb} (${a.level})`;
}

export function diffManifests(before: Manifest | null, after: Manifest, describe: (a: ManifestAction) => string): ManifestDiff {
  const prev = new Map((before?.actions ?? []).map((a) => [a.actionId, a]));
  const next = new Map(after.actions.map((a) => [a.actionId, a]));
  const added = after.actions.filter((a) => !prev.has(a.actionId));
  const removed = (before?.actions ?? []).filter((a) => !next.has(a.actionId));
  const raised = after.actions
    .filter((a) => prev.has(a.actionId) && RANK[a.level] > RANK[prev.get(a.actionId)!.level])
    .map((a) => ({ action: a, from: prev.get(a.actionId)!.level }));
  return { added, removed, raised, widened: added.length > 0 || raised.length > 0, lines: [...added, ...raised.map((r) => r.action)].map(describe) };
}

/** Stable JSON for `.builder/scopes.json`: fixed key order, no line numbers. */
export function serializeManifest(m: Manifest): string {
  // runsAs only when a call site runs on the owner's grant, so user-only manifests keep their old bytes.
  const actions = m.actions.map((a) => ({ platform: a.platform, connDefId: a.connDefId, actionId: a.actionId, title: a.title, method: a.method, level: a.level, ...(a.runsAs?.includes("owner") ? { runsAs: [...a.runsAs] } : {}) }));
  return `${JSON.stringify({ version: 1, actions, unused: [...m.unused].sort() }, null, 2)}\n`;
}
