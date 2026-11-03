// The catalog: find, load, platforms. Read-only. Through the One
// CLI on this machine (actions find, actions load, platforms), or the stub
// over fixtures on the sample source. Knowledge is cached on disk for 24 h
// (BUILDER_HOME/cache/catalog); on the sample source nothing is cached.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileForAction, type KnowledgeRow } from "../fixtures.js";
import type { Home } from "../home.js";
import { OneCliError } from "../onecli.js";
import type { OneSource } from "../onesource.js";
import type { CatalogPlatform, GrantConnection } from "../types.js";
import { digest, section } from "./codegen.js";
import { levelFor, nameFromSlug } from "./naming.js";

const TTL = 24 * 60 * 60 * 1000;

export class CatalogUnavailable extends Error {
  constructor(
    message: string,
    readonly code: "no_cli" | "needs_connection" | "not_found" | "failed",
    readonly platform?: string,
  ) {
    super(message);
  }
}

export interface FindResult {
  platform: string;
  intent: string;
  picks: { actionId: string; title: string; method: string; path: string; level: string }[];
  markdown: string;
  needsConnection?: string;
}

const NO_CLI = "One's catalog comes from the One CLI on the builder's computer, and it is not installed or not signed in. Build this without platform calls for now and say so in your reply; the builder can set up the One CLI in Settings.";

const unavailable = (err: unknown, what: string): CatalogUnavailable => {
  if (err instanceof CatalogUnavailable) return err;
  if (err instanceof OneCliError) {
    if (err.code === "not_installed" || err.code === "signed_out") return new CatalogUnavailable(NO_CLI, "no_cli");
    if (err.code === "not_found") return new CatalogUnavailable(err.message, "not_found");
  }
  return new CatalogUnavailable(`One's ${what} did not answer (${(err as Error).message}). Try again in a moment.`, "failed");
};

export class CatalogService {
  private platformCache: { at: number; list: CatalogPlatform[] } | null = null;
  /** The platform each find answered for, so a load knows it before the CLI's cache does. */
  private platformOf = new Map<string, string>();

  constructor(private o: { home: Home; source: OneSource; log?: (line: string) => void }) {}

  get source(): OneSource {
    return this.o.source;
  }

  private cachePath(actionId: string) {
    return join(this.o.home.cacheCatalog, fileForAction(actionId));
  }

  /** From the disk cache (or the stub), without a network call. */
  cached(actionId: string): KnowledgeRow | null {
    const stub = this.o.source.stub;
    if (stub) return stub.knowledge.get(actionId) ?? null;
    const p = this.cachePath(actionId);
    if (!existsSync(p)) return null;
    try {
      return (JSON.parse(readFileSync(p, "utf8")) as { row: KnowledgeRow }).row;
    } catch {
      return null;
    }
  }

  private fresh(actionId: string): KnowledgeRow | null {
    const p = this.cachePath(actionId);
    if (!existsSync(p)) return null;
    try {
      const c = JSON.parse(readFileSync(p, "utf8")) as { at: number; row: KnowledgeRow };
      return Date.now() - c.at < TTL ? c.row : null;
    } catch {
      return null;
    }
  }

  /** An action's KnowledgeView (with ioSchema when One has one), cache first. */
  async knowledge(actionId: string): Promise<KnowledgeRow> {
    if (this.o.source.stub) {
      try {
        return await this.o.source.knowledge(actionId);
      } catch (err) {
        throw unavailable(err, "catalog");
      }
    }
    const hit = this.fresh(actionId);
    if (hit) return hit;
    try {
      const row = await this.o.source.knowledge(actionId, this.platformOf.get(actionId));
      mkdirSync(this.o.home.cacheCatalog, { recursive: true });
      writeFileSync(this.cachePath(actionId), JSON.stringify({ at: Date.now(), row }));
      return row;
    } catch (err) {
      const stale = this.cached(actionId);
      if (stale) return stale;
      throw unavailable(err, "catalog");
    }
  }

  async find(platform: string, intent: string): Promise<FindResult> {
    let found;
    try {
      found = await this.o.source.find(platform, intent, 6);
    } catch (err) {
      throw unavailable(err, "catalog search");
    }
    for (const a of found) this.platformOf.set(a.actionId, platform);
    const picks = found.map((a) => ({ actionId: a.actionId, title: a.title, method: a.method, path: a.path, level: levelFor({ method: a.method, title: a.title, tags: a.tags }) }));
    const name = await this.platformName(platform);
    if (!picks.length) {
      return { platform, intent, picks, markdown: `No ${name} action matches "${intent}". Try other words, or one_platforms to check the platform slug.` };
    }
    const top = picks[0]!;
    let topDocs = found[0]?.knowledge ? digest(found[0].knowledge, 2500) : "";
    if (!topDocs) {
      try {
        const k = await this.knowledge(top.actionId);
        topDocs = digest(k.knowledge, 2500);
      } catch {
        /* the list alone still helps */
      }
    }
    const md = [
      `${name} actions for "${intent}", best first:`,
      "",
      ...picks.map((p, i) => `${i + 1}. ${p.title}  \`${p.actionId}\`  ${p.method} ${p.path}  (${p.level})`),
      "",
      `Next: one_add_action ${top.actionId} (or another id above). It writes the typed wrapper and returns the full docs.`,
      ...(topDocs ? ["", `## Digest of ${top.title}`, "", topDocs] : []),
    ].join("\n");
    return { platform, intent, picks, markdown: md };
  }

  async load(actionId: string, sectionName?: string): Promise<{ markdown: string; row: KnowledgeRow }> {
    const row = await this.knowledge(actionId);
    const level = levelFor({ method: row.method, title: row.title, tags: row.tags });
    const head = [`# ${row.title}`, "", `\`${row._id}\`  ${row.method} ${row.path}  platform ${row.connectionPlatform}, level ${level}${row.ioSchema ? "" : ", no schema (types will be loose)"}`, ""].join("\n");
    if (sectionName) {
      const s = section(row.knowledge, sectionName);
      return { row, markdown: head + (s ?? `No section called "${sectionName}". Sections: ${headings(row.knowledge).join(", ")}`) };
    }
    return { row, markdown: head + digest(row.knowledge, 9000) };
  }

  /** Catalog platforms with conn_def ids and logos, cached 24 h. */
  async platforms(query?: string): Promise<CatalogPlatform[]> {
    let list = this.platformCache && Date.now() - this.platformCache.at < TTL ? this.platformCache.list : null;
    if (!list) {
      if (this.o.source.stub) list = await this.o.source.platforms();
      else {
        const diskPath = join(this.o.home.cacheCatalog, "_platforms.json");
        if (existsSync(diskPath)) {
          try {
            const c = JSON.parse(readFileSync(diskPath, "utf8")) as { at: number; list: CatalogPlatform[] };
            if (Date.now() - c.at < TTL) list = c.list;
          } catch {
            /* refetch */
          }
        }
        if (!list) {
          list = await this.o.source.platforms().catch(() => []);
          if (list.length) {
            mkdirSync(this.o.home.cacheCatalog, { recursive: true });
            writeFileSync(diskPath, JSON.stringify({ at: Date.now(), list }));
          }
        }
      }
      if (list.length || this.o.source.stub) this.platformCache = { at: Date.now(), list };
    }
    if (!query) return list;
    const q = query.toLowerCase();
    return list.filter((p) => p.platform.includes(q) || p.name.toLowerCase().includes(q) || (p.category ?? "").toLowerCase().includes(q));
  }

  async platformInfo(slug: string): Promise<CatalogPlatform> {
    const list = await this.platforms().catch(() => []);
    return list.find((p) => p.platform === slug) ?? { platform: slug, name: nameFromSlug(slug), connDefId: null, image: `https://assets.withone.ai/connectors/${slug}.svg` };
  }

  async platformName(slug: string): Promise<string> {
    return (await this.platformInfo(slug)).name;
  }

  /** The builder's own One connections, through the One CLI (publish targets). No keys. */
  async granted(): Promise<GrantConnection[]> {
    const list = await this.o.source.connections();
    const out: GrantConnection[] = [];
    for (const c of list) {
      const info = await this.platformInfo(c.platform);
      out.push({ platform: c.platform, name: info.name, image: c.image ?? info.image, title: c.title, access: c.access, ...(c.methods ? { methods: c.methods } : {}) });
    }
    return out;
  }

  /** DELETE actions on a platform, for the Access tab's refusal test. */
  async deletes(platform: string): Promise<{ actionId: string; title: string; method: string; path: string }[]> {
    const stub = this.o.source.stub;
    if (stub) return [...stub.knowledge.values()].filter((r) => r.connectionPlatform === platform && r.method.toUpperCase() === "DELETE").map((r) => ({ actionId: r._id, title: r.title, method: "DELETE", path: r.path }));
    const found = await this.o.source.find(platform, "delete a message or record", 10).catch(() => []);
    return found.filter((a) => a.method === "DELETE").map((a) => ({ actionId: a.actionId, title: a.title, method: "DELETE", path: a.path }));
  }
}

function headings(md: string): string[] {
  return md
    .split("\n")
    .filter((l) => /^#{2,3}\s/.test(l))
    .map((l) => l.replace(/^#+\s*/, ""))
    .slice(0, 20);
}
