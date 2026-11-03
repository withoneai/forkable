// Per-project One state: installed actions (.builder/actions.json), the
// generated wrappers (server/one/actions.gen.ts) and the manifest
// (.builder/scopes.json). The live manifest (what the dev check uses) is
// re-derived from the working tree whenever a source file changes.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PermissionSetAsk, ScopesResponse } from "../api-types.js";
import { BRAND } from "../brand.js";
import type { Bus } from "../bus.js";
import { describeWrapper, generateActions, type GeneratedWrapper } from "../catalog/codegen.js";
import { verbFor } from "../catalog/naming.js";
import type { CatalogService } from "../catalog/service.js";
import type { ErrorStore } from "../errors.js";
import type { KnowledgeRow } from "../fixtures.js";
import * as git from "../git.js";
import type { CatalogPlatform, InstalledAction, Manifest, ManifestAction, ManifestDiff, VisitorGrant } from "../types.js";
import { runsAsOwner, VISITORS_OFF, visitorEnvValue, visitorSplit } from "../visitors.js";
import { diffManifests, EMPTY_MANIFEST, serializeManifest, toAsk } from "./ask.js";
import { extractManifest, GEN_FILE, readInstalled, sourceFingerprint, type ExtractResult } from "./extract.js";

export interface ProjectRef {
  id: string;
  name: string;
  path: string;
  slug?: string;
}

const ACTIONS_FILE = join(BRAND.projectDir, "actions.json");
const SCOPES_FILE = join(BRAND.projectDir, "scopes.json");

export class ScopeService {
  private live = new Map<string, { fp: string; result: ExtractResult }>();
  /** Set by the publish service: scopes.json at the last successful publish. */
  lastPublishedOf: ((p: ProjectRef) => Promise<Manifest | null>) | null = null;
  /** Set by the platform: the builder's visitor setting (off when unset). */
  visitorsOf: ((p: ProjectRef) => Promise<VisitorGrant>) | null = null;

  async visitors(p: ProjectRef): Promise<VisitorGrant> {
    return (await this.visitorsOf?.(p).catch(() => VISITORS_OFF)) ?? VISITORS_OFF;
  }

  constructor(private o: { catalog: CatalogService; errors: ErrorStore; bus: Bus; log?: (line: string) => void }) {}

  installed(p: ProjectRef): InstalledAction[] {
    return readInstalled(p.path, BRAND.projectDir);
  }

  private writeInstalled(p: ProjectRef, list: InstalledAction[]): void {
    const file = join(p.path, ACTIONS_FILE);
    mkdirSync(dirname(file), { recursive: true });
    const sorted = [...list].sort((a, b) => a.platform.localeCompare(b.platform) || a.actionId.localeCompare(b.actionId));
    writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`);
  }

  /** Regenerate actions.gen.ts from actions.json. */
  async regenerate(p: ProjectRef): Promise<{ wrappers: GeneratedWrapper[]; warnings: { actionId: string; message: string }[] }> {
    const installed = this.installed(p);
    const rows = new Map<string, KnowledgeRow>();
    for (const a of installed) {
      const k = await this.o.catalog.knowledge(a.actionId).catch(() => this.o.catalog.cached(a.actionId));
      if (k) rows.set(a.actionId, k);
    }
    const r = await generateActions(installed, (id) => rows.get(id) ?? null);
    writeFileSync(join(p.path, GEN_FILE), r.code);
    return { wrappers: r.wrappers, warnings: r.warnings };
  }

  /** one_add_action: install, regenerate, describe. */
  async add(p: ProjectRef, actionId: string): Promise<{ wrapper: GeneratedWrapper; markdown: string; granted: boolean; platform: string; already: boolean }> {
    const row = await this.o.catalog.knowledge(actionId);
    const platform = row.connectionPlatform;
    const list = this.installed(p);
    const already = list.some((a) => a.actionId === actionId);
    if (!already) this.writeInstalled(p, [...list, { actionId, platform }]);
    const { wrappers } = await this.regenerate(p);
    const wrapper = wrappers.find((w) => w.actionId === actionId)!;
    // What a person grants the app is decided at their sign-in to its own Connect app, not here.
    const granted = true;
    return { wrapper, markdown: (already ? "Already installed. " : "") + describeWrapper(wrapper, row, granted), granted, platform, already };
  }

  async remove(p: ProjectRef, actionId: string): Promise<boolean> {
    const list = this.installed(p);
    if (!list.some((a) => a.actionId === actionId)) return false;
    this.writeInstalled(
      p,
      list.filter((a) => a.actionId !== actionId),
    );
    await this.regenerate(p);
    return true;
  }

  private async platformMap(actions: { platform: string }[]): Promise<Map<string, CatalogPlatform>> {
    const out = new Map<string, CatalogPlatform>();
    for (const a of actions) if (!out.has(a.platform)) out.set(a.platform, await this.o.catalog.platformInfo(a.platform));
    return out;
  }

  /** The manifest the working tree asks for now (cached until a source file changes). */
  async derive(p: ProjectRef): Promise<ExtractResult> {
    const fp = sourceFingerprint(p.path);
    const hit = this.live.get(p.id);
    if (hit && hit.fp === fp) return hit.result;
    const installed = this.installed(p);
    const platforms = await this.platformMap(installed);
    const result = extractManifest({
      dir: p.path,
      installed,
      knowledge: (id) => this.o.catalog.cached(id),
      connDef: (slug) => platforms.get(slug)?.connDefId ?? null,
    });
    this.live.set(p.id, { fp, result });
    return result;
  }

  /** "Gmail · send (write)" for a manifest action. */
  async describe(actions: ManifestAction[]): Promise<(a: ManifestAction) => string> {
    const platforms = await this.platformMap(actions);
    return (a) => {
      const k = this.o.catalog.cached(a.actionId);
      const verb = k ? verbFor({ method: a.method, path: k.path, platform: a.platform }) : a.title;
      return `${platforms.get(a.platform)?.name ?? a.platform} · ${verb} (${a.level})`;
    };
  }

  committed(p: ProjectRef): Promise<Manifest | null> {
    return git.showFile(p.path, "HEAD", SCOPES_FILE.replace(/\\/g, "/")).then((t) => (t ? (JSON.parse(t) as Manifest) : null)).catch(() => null);
  }

  /**
   * After a turn settles: re-derive, write scopes.json, replace
   * the `manifest` error rows, and say how the ask changed against HEAD.
   */
  async refresh(p: ProjectRef, turnId: string | null): Promise<{ manifest: Manifest; diff: ManifestDiff; result: ExtractResult }> {
    this.live.delete(p.id);
    // A wrapper file that lags actions.json (hand edit, restore) is regenerated first.
    const installed = this.installed(p);
    const gen = join(p.path, GEN_FILE);
    const genText = existsSync(gen) ? readFileSync(gen, "utf8") : "";
    if (installed.some((a) => !genText.includes(JSON.stringify(a.actionId))) || (installed.length === 0 && /actionId:/.test(genText))) await this.regenerate(p);
    const result = await this.derive(p);
    const file = join(p.path, SCOPES_FILE);
    const next = serializeManifest(result.manifest);
    const prevText = existsSync(file) ? readFileSync(file, "utf8") : "";
    if (prevText !== next) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, next);
    }
    await this.o.errors.replaceSource(
      p.id,
      p.path,
      "manifest",
      result.issues.map((i) => ({ source: "manifest" as const, severity: i.severity, file: i.file, line: i.line, col: i.col, message: `${i.code} ${i.message}` })),
      turnId,
    );
    const committed = await this.committed(p);
    const diff = diffManifests(committed, result.manifest, await this.describe([...result.manifest.actions, ...(committed?.actions ?? [])]));
    this.o.bus.emit(p.id, { type: "scopes.changed", manifest: result.manifest, diff });
    return { manifest: result.manifest, diff, result };
  }

  async response(p: ProjectRef): Promise<ScopesResponse> {
    const result = await this.derive(p);
    const committed = await this.committed(p);
    const lastPublished = (await this.lastPublishedOf?.(p).catch(() => null)) ?? null;
    const all = [...result.manifest.actions, ...(committed?.actions ?? []), ...(lastPublished?.actions ?? [])];
    const describe = await this.describe(all);
    const { ask, missing } = toAsk(result.manifest, p.name);
    const platforms = await this.platformMap([...all, ...this.installed(p)]);
    const warnings: ScopesResponse["warnings"] = [];
    for (const a of this.installed(p)) {
      const k = this.o.catalog.cached(a.actionId);
      if (!k) warnings.push({ actionId: a.actionId, message: "Not in the catalog cache yet; the wrapper is regenerated on the next turn." });
      else if (!k.ioSchema) warnings.push({ actionId: a.actionId, message: "No schema for this action; types are loose." });
    }
    const verbs: Record<string, string> = {};
    for (const a of [...all, ...this.installed(p).map((x) => ({ ...x, method: "" }))]) {
      const k = this.o.catalog.cached(a.actionId);
      if (k) verbs[a.actionId] = verbFor({ method: k.method, path: k.path, platform: k.connectionPlatform });
    }
    const visitors = await this.visitors(p);
    return {
      verbs,
      visitors,
      visitorEnv: visitorEnvValue(result.manifest, visitors),
      manifest: result.manifest,
      committed,
      lastPublished,
      diff: diffManifests(lastPublished ?? committed, result.manifest, describe),
      ask: ask as PermissionSetAsk,
      askMissing: missing,
      callSites: result.callSites,
      issues: result.issues,
      warnings,
      platforms: Object.fromEntries(platforms),
    };
  }

  /** A short summary for the agent's per-turn facts. */
  async summary(p: ProjectRef): Promise<string> {
    const r = await this.derive(p);
    if (!r.manifest.actions.length && !r.manifest.unused.length) return "This app calls no platform yet.";
    const describe = await this.describe(r.manifest.actions);
    const lines = r.manifest.actions.map((a) => `- ${describe(a)}${runsAsOwner(a) ? (a.runsAs!.includes("user") ? " [also runs as the owner for visitors]" : " [runs as the owner for visitors]") : ""}`);
    const v = await this.visitors(p);
    const split = visitorSplit(r.manifest, v);
    const visitorLine = !split.allowed.length && !split.notAllowed.length
      ? ""
      : [
          split.allowed.length ? `The builder allowed visitors to trigger on their grant: ${split.allowed.map(describe).join(", ")}.` : "",
          split.notAllowed.length ? `Not allowed for visitors yet (the builder decides, not you; explain why the app needs it): ${split.notAllowed.map(describe).join(", ")}.` : "",
        ]
          .filter(Boolean)
          .join(" ");
    return [
      lines.length ? `The app's manifest (what consent asks for):\n${lines.join("\n")}` : "The manifest is empty.",
      visitorLine,
      r.manifest.unused.length ? `Installed but not called: ${r.manifest.unused.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
}
