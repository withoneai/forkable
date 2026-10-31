// Response builders shared by the routes: ApiSource, SourcesResponse, ApiProfile,
// ItemDetail, EntityDetail, AccessResponse.

import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import {
  dbSchema, entityChips, fetchIsStale, logoUrl, platformName, profileActionIds, semanticStatus, settingsFor, sourceHealth, toResultRows, AI_PLATFORMS, RECEIPT_ACTION,
  type AccessResponse, type ApiProfile, type ApiSource, type EntityDetail, type ItemDetail, type ItemFacets, type ResultRow, type SearchProfile, type SourcesResponse,
} from "@search/core";
import { connectionsFor } from "@search/core";
import type { Deps, UserRow } from "./deps.js";
import { notFound } from "./errors.js";

const { sources, profiles, profileVersions, items, rawItems, classifications, entities, entityKeys, entityLinks, entityMatches, chunks } = dbSchema;

export function fmtEvery(ms: number): string {
  if (ms % 86_400_000 === 0) return `${ms / 86_400_000}d`;
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  return `${Math.round(ms / 1000)}s`;
}

type SourceRow = typeof sources.$inferSelect;

type ManifestEntry = { platform: string; actionId: string; access: string; usedBy?: string; reason?: string; grant?: boolean; title?: string; method?: string; path?: string };
let manifestCache: { file: string; mtimeMs: number; actions: ManifestEntry[] } | null = null;
/** connect.manifest.json's actions, reread when the file changes. */
export async function manifestActions(root: string): Promise<ManifestEntry[]> {
  const { readFileSync, statSync, existsSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const file = resolve(root, "connect.manifest.json");
  if (!existsSync(file)) return [];
  const mtimeMs = statSync(file).mtimeMs;
  if (manifestCache?.file === file && manifestCache.mtimeMs === mtimeMs) return manifestCache.actions;
  const actions = (JSON.parse(readFileSync(file, "utf8")) as { actions: ManifestEntry[] }).actions;
  manifestCache = { file, mtimeMs, actions };
  return actions;
}

export async function apiSource(deps: Deps, s: SourceRow): Promise<ApiSource> {
  const [row] = await deps.db.select({ p: profiles, v: profileVersions }).from(profiles).innerJoin(profileVersions, eq(profileVersions.id, s.profileVersionId)).where(eq(profiles.id, s.profileId));
  const [cur] = row?.p.currentVersionId ? await deps.db.select({ version: profileVersions.version }).from(profileVersions).where(eq(profileVersions.id, row.p.currentVersionId)) : [];
  const json = row?.v.json as SearchProfile | undefined;
  let health = await sourceHealth(deps.db, s.id);
  const p = deps.scheduler.progress(s.id);
  if (p) health = { ...health, status: "syncing", progress: p };
  else if (health.status === "new") health = { ...health, progress: { done: 0, estimate: null } };
  const manifest = json ? await manifestActions(deps.env.ROOT) : [];
  const actions = json ? profileActionIds(json).map((actionId) => { const m = manifest.find((a) => a.actionId === actionId); return { actionId, method: m?.method ?? null, path: m?.path ?? null }; }) : [];
  return {
    id: s.id, platform: s.platform, name: platformName(s.platform), logoUrl: logoUrl(s.platform), connectionLabel: s.connectionLabel, mode: s.mode,
    profile: {
      id: s.profileId, slug: row?.p.slug ?? "", title: json?.title ?? "", kind: json?.kind ?? "record", version: row?.v.version ?? 1,
      origin: row?.p.origin ?? "builtin", verified: json?.verified ?? "none", updateAvailable: !!row && row.p.currentVersionId !== s.profileVersionId && (cur?.version ?? 0) > row.v.version,
    },
    health, scheduleEvery: fmtEvery(s.scheduleEvery),
    settings: json ? settingsFor(json, s.settings) : s.settings, settingsSpec: json?.settings ?? {}, actions,
    refetchPending: !!json && !!row && fetchIsStale(s.fetchHash, row.v.fetchHash, json, settingsFor(json, s.settings)),
  };
}

export async function sourceFor(deps: Deps, userId: string, id: string): Promise<SourceRow> {
  const [s] = await deps.db.select().from(sources).where(and(eq(sources.id, id), eq(sources.userId, userId)));
  if (!s) throw notFound("Source");
  return s;
}

export async function sourcesResponse(deps: Deps, user: UserRow): Promise<SourcesResponse> {
  const rows = await deps.db.select().from(sources).where(eq(sources.userId, user.id)).orderBy(sources.platform, sources.createdAt);
  const list = await Promise.all(rows.map((s) => apiSource(deps, s)));
  const conns = await connectionsFor(deps.ctx, user.id).catch(() => []);
  const builtin = await deps.db.select({ platform: profiles.platform, slug: profiles.slug }).from(profiles).where(isNull(profiles.userId));
  const have = new Set(rows.map((r) => r.connectionKey));
  const available = conns
    .filter((c) => !AI_PLATFORMS.has(c.platform) && !have.has(c.key))
    .map((c) => ({ platform: c.platform, name: platformName(c.platform), logoUrl: logoUrl(c.platform), connectionKey: c.key, connectionLabel: c.title ?? c.name ?? platformName(c.platform), builtinProfiles: builtin.filter((b) => b.platform === c.platform).map((b) => b.slug) }));
  const inGrant = new Set(conns.map((c) => c.platform));
  const notInApp = [...new Set(builtin.map((b) => b.platform))].filter((p) => !inGrant.has(p)).map((p) => ({ platform: p, name: platformName(p), logoUrl: logoUrl(p) }));
  const worst = list.find((s) => s.health.status === "auth_needed") ?? list.find((s) => s.health.status === "grant_blocked") ?? list.find((s) => s.health.status === "rate_limited") ?? list.find((s) => s.health.status === "error");
  let banner: SourcesResponse["banner"] = null;
  // the embedder is not a source, but search quietly losing its semantic arm is worth the same banner (D41)
  const semantic = await semanticStatus(deps.ctx, user.id);
  if (worst) {
    const st = worst.health.status;
    const at = worst.health.retryAt ? new Date(worst.health.retryAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : null;
    banner = st === "auth_needed" ? { level: "error", text: `${worst.name} needs you to sign in again.`, sourceId: worst.id, action: "reconnect" }
      : st === "grant_blocked" ? { level: "error", text: `Search was not granted ${worst.health.lastError?.actionId ? "an action it needs" : "access"} on ${worst.name}.`, sourceId: worst.id, action: "manage_in_one" }
      : st === "rate_limited" ? { level: "warn", text: `${worst.name} is rate limiting Search.${at ? ` Trying again at ${at}.` : ""}`, sourceId: worst.id, action: "retry" }
      : { level: "warn", text: `${worst.name} has failed ${worst.health.consecutiveFailures} runs in a row.`, sourceId: worst.id, action: "retry" };
  } else if (!semantic.semantic && (semantic.reason === "not_in_grant" || semantic.reason === "error")) {
    banner = { level: semantic.reason === "not_in_grant" ? "error" : "warn", text: semanticOffText(semantic), sourceId: null, action: "manage_in_one" };
  }
  return { semantic, sources: list, available, notInApp, banner };
}

/** "Semantic search is off. OpenAI is not in your grant." */
export function semanticOffText(s: { reason: string | null; message: string | null }): string {
  return `Semantic search is off.${s.message ? ` ${s.message}` : ""}${s.reason === "error" ? " Results are keyword matches until it answers." : ""}`;
}

export async function apiProfile(deps: Deps, profileId: string, userId: string): Promise<ApiProfile> {
  const [r] = await deps.db.select({ p: profiles, v: profileVersions }).from(profiles).innerJoin(profileVersions, eq(profileVersions.id, profiles.currentVersionId))
    .where(and(eq(profiles.id, profileId), or(isNull(profiles.userId), eq(profiles.userId, userId))));
  if (!r) throw notFound("Profile");
  return { id: r.p.id, slug: r.p.slug, platform: r.p.platform, model: r.p.model, title: r.v.json.title, origin: r.p.origin, currentVersion: r.v.version, profileHash: r.v.profileHash, verified: r.v.json.verified ?? "none", json: r.v.json };
}

type ItemRow = typeof items.$inferSelect;

export async function rowsFor(deps: Deps, list: ItemRow[]): Promise<ResultRow[]> {
  return toResultRows(deps.ctx, list.map((r) => ({ id: r.id, kind: r.kind, platform: r.platform, source_id: r.sourceId, title: r.title, snippet: r.snippet, body: r.body, url: r.url, container: r.container, group_key: r.groupKey, status: r.status, facets: r.facets, occurred_at: r.occurredAt, updated_at: r.updatedAt, lane: r.lane, importance: r.importance })), new Map(), []);
}

const money = (n: unknown, cur?: unknown) => (typeof n === "number" || (typeof n === "string" && n !== "") ? new Intl.NumberFormat("en-US", { style: "currency", currency: typeof cur === "string" && /^[A-Z]{3}$/.test(cur) ? cur : "USD", maximumFractionDigits: 0 }).format(Number(n)) : "");
const day = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "");

function properties(f: ItemFacets, status: string | null): { label: string; value: string }[] {
  const x = f as Record<string, unknown>;
  const s = (v: unknown) => (v === undefined || v === null ? "" : Array.isArray(v) ? v.map(String).join(", ") : String(v));
  const out: { label: string; value: string }[] = [];
  switch (f.kind) {
    case "deal": out.push({ label: "Amount", value: money(x.amount, x.currency) }, { label: "Stage", value: s(x.stage) }, { label: "Close date", value: day(x.closeDate) }, { label: "Owner", value: s(x.owner) }, { label: "Company", value: s(x.companyName) }); break;
    case "task": out.push({ label: "Key", value: s(x.key) }, { label: "Status", value: s(x.state) }, { label: "Assignee", value: s(x.assignee) }, { label: "Priority", value: ["No priority", "Urgent", "High", "Medium", "Low"][Number(x.priority ?? 0)] ?? "" }, { label: "Project", value: s(x.project) }, { label: "Due", value: day(x.due) }); break;
    case "person": out.push({ label: "Email", value: s(x.email) }, { label: "Title", value: s(x.jobTitle) }, { label: "Company", value: s(x.companyName) }, { label: "Phone", value: s(x.phone) }, { label: "Lifecycle", value: s(x.lifecycle) }, { label: "Owner", value: s(x.owner) }); break;
    case "company": out.push({ label: "Domain", value: s(x.domain) }, { label: "Industry", value: s(x.industry) }, { label: "Size", value: s(x.size) }, { label: "Location", value: s(x.location) }); break;
    case "event": out.push({ label: "Starts", value: s(x.start) }, { label: "Ends", value: s(x.end) }, { label: "Location", value: s(x.location) }, { label: "Calendar", value: s(x.calendar) }); break;
    case "doc": out.push({ label: "In", value: s(x.parentTitle) }, { label: "Edited by", value: s(x.editedBy) }, { label: "Words", value: s(x.wordCount) }); break;
    case "note": out.push({ label: "On", value: s(x.parentTitle) }); break;
    case "message": out.push({ label: "Channel", value: s(x.channel) }, { label: "Replies", value: s(x.replyCount) }); break;
    default: if (status) out.push({ label: "Status", value: status });
      for (const [k, v] of Object.entries(x)) if (k.startsWith("x_") && (typeof v === "string" || typeof v === "number")) out.push({ label: k.slice(2).replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), value: String(v) });
  }
  return out.filter((p) => p.value);
}

export async function itemDetail(deps: Deps, userId: string, id: string): Promise<ItemDetail> {
  const [it] = await deps.db.select().from(items).where(and(eq(items.id, id), eq(items.userId, userId), isNull(items.deletedAt)));
  if (!it) throw notFound("Item");
  const [row] = await rowsFor(deps, [it]);
  const ch = await deps.db.select({ ord: chunks.ord, text: chunks.text }).from(chunks).where(eq(chunks.itemId, id)).orderBy(chunks.ord);
  // message-strategy chunks start with "title | sender | date"; that header names each part
  const parts: ItemDetail["parts"] = [];
  if (it.kind === "email_thread" || it.kind === "message") {
    for (const c of ch) {
      const m = /^(.*?) \| (.*?) \| (\d{4}-\d{2}-\d{2})\s*\n?([\s\S]*)$/.exec(c.text);
      if (m) parts.push({ kind: "message", title: null, author: m[2]!.trim() || null, at: m[3]!, text: m[4]!.trim() });
    }
  }
  const [cl] = await deps.db.select().from(classifications).where(eq(classifications.itemId, id)).limit(1);
  const people = row!.people.map((p) => p.entityId);
  const relatedIds = people.length
    ? (await deps.db.execute(sql`select distinct l.item_id from entity_links l join entities e on e.id = l.entity_id join items i on i.id = l.item_id
        where l.entity_id in (${sql.join(people.map((p) => sql`${p}`), sql`, `)}) and e.is_self = false and i.id <> ${id} and i.deleted_at is null and i.directory = false limit 20`)).rows.map((r) => (r as { item_id: string }).item_id)
    : [];
  const group = it.groupKey ? (await deps.db.select({ id: items.id }).from(items).where(and(eq(items.sourceId, it.sourceId), eq(items.groupKey, it.groupKey), ne(items.id, id), isNull(items.deletedAt)))).map((r) => r.id) : [];
  const relIds = [...new Set([...group, ...relatedIds])].slice(0, 5);
  const relRows = relIds.length ? await deps.db.select().from(items).where(inArray(items.id, relIds)).orderBy(desc(items.occurredAt)) : [];
  const [raw] = await deps.db.select({ id: rawItems.id }).from(rawItems).where(eq(rawItems.id, it.rawItemId));
  return {
    row: row!, body: it.body, bodyHighlights: [], parts, properties: properties(it.facets, it.status),
    classification: { lane: it.lane, importance: it.importance, kindGuess: cl?.kindGuess ?? null, needsYou: cl?.needsYou ?? null, by: cl ? (cl.model === "rules" ? "rules" : cl.model === "fixture" ? "fixture" : "jev") : null },
    related: await rowsFor(deps, relRows), rawAvailable: !!raw,
  };
}

export async function entityDetail(deps: Deps, userId: string, id: string): Promise<EntityDetail> {
  let [e] = await deps.db.select().from(entities).where(and(eq(entities.id, id), eq(entities.userId, userId)));
  if (e?.mergedIntoId) [e] = await deps.db.select().from(entities).where(eq(entities.id, e.mergedIntoId));
  if (!e) throw notFound("Person or company");
  const keys = await deps.db.select({ key: entityKeys.key }).from(entityKeys).where(eq(entityKeys.entityId, e.id));
  const emails = keys.map((k) => k.key).filter((k) => k.startsWith("email:")).map((k) => k.slice(6)).sort((a, b) => (a === e!.primaryEmail ? -1 : b === e!.primaryEmail ? 1 : a.localeCompare(b)));
  const linkIds = (await deps.db.select({ itemId: entityLinks.itemId }).from(entityLinks).where(eq(entityLinks.entityId, e.id))).map((r) => r.itemId);
  // a company's timeline also has its people's items
  const memberIds = e.type === "company" ? (await deps.db.select({ id: entities.id }).from(entities).where(and(eq(entities.companyId, e.id), isNull(entities.mergedIntoId)))).map((r) => r.id) : [];
  const memberItems = memberIds.length ? (await deps.db.select({ itemId: entityLinks.itemId }).from(entityLinks).where(inArray(entityLinks.entityId, memberIds))).map((r) => r.itemId) : [];
  const all = [...new Set([...linkIds, ...memberItems])];
  const list = all.length ? await deps.db.select().from(items).where(and(inArray(items.id, all), isNull(items.deletedAt), eq(items.directory, false))).orderBy(desc(items.occurredAt)).limit(50) : [];
  const srcs = all.length ? (await deps.db.execute(sql`select platform, count(*)::int as count, max(occurred_at) as last_at from items where id in (${sql.join(all.map((x) => sql`${x}`), sql`, `)}) and deleted_at is null group by platform order by count desc`)).rows as { platform: string; count: number; last_at: Date | string }[] : [];
  const [company] = e.companyId ? await entityChips(deps.ctx, [e.companyId]) : [];
  const pend = await deps.db.select().from(entityMatches).where(and(eq(entityMatches.userId, userId), eq(entityMatches.status, "pending"), or(eq(entityMatches.aId, e.id), eq(entityMatches.bId, e.id))));
  const others = await entityChips(deps.ctx, pend.map((m) => (m.aId === e!.id ? m.bId : m.aId)));
  // people merged into this one by a match decision (email merges in a run are not undoable rows)
  const mergedRows = await deps.db.select().from(entities).where(and(eq(entities.userId, userId), eq(entities.mergedIntoId, e.id)));
  const decided = mergedRows.length ? await deps.db.select().from(entityMatches).where(and(eq(entityMatches.userId, userId), eq(entityMatches.status, "merged"), or(eq(entityMatches.aId, e.id), eq(entityMatches.bId, e.id)))) : [];
  const srcIds = [...new Set(mergedRows.flatMap((m) => ((m.attributes as { mergedLinks?: [string, string, string][] } | null)?.mergedLinks ?? []).map((l) => l[2]).filter(Boolean)))];
  const srcPlat = srcIds.length ? new Map((await deps.db.select({ id: sources.id, platform: sources.platform }).from(sources).where(inArray(sources.id, srcIds))).map((r) => [r.id, r.platform])) : new Map<string, string>();
  const merged = mergedRows.flatMap((m) => {
    const d = decided.find((x) => x.aId === m.id || x.bId === m.id);
    if (!d) return [];
    const links = (m.attributes as { mergedLinks?: [string, string, string][] } | null)?.mergedLinks ?? [];
    return [{ id: m.id, name: m.name, email: m.primaryEmail, platforms: [...new Set(links.map((l) => srcPlat.get(l[2])).filter((x): x is string => !!x))], decidedBy: (d.decidedBy as "jev" | "user" | "fixture" | null) ?? null, probability: d.probability ?? null }];
  });
  return {
    entity: {
      id: e.id, type: e.type, name: e.name, emails, domain: e.domain, title: e.title, company: company ?? null, avatarUrl: e.avatarUrl, isSelf: e.isSelf,
      sources: srcs.map((s) => ({ platform: s.platform, count: Number(s.count), lastAt: new Date(s.last_at).toISOString() })),
    },
    timeline: await rowsFor(deps, list),
    pendingMatches: pend.map((m) => ({ matchId: m.id, other: others.find((o) => o.id === (m.aId === e!.id ? m.bId : m.aId))!, probability: m.probability ?? 0, reason: m.reason })).filter((x) => x.other),
    merged,
  };
}

const VERBS: [RegExp, string][] = [[/^search/i, "Search"], [/^list/i, "List"], [/^get|^retrieve|^read/i, "Read"], [/delta|changes|incremental/i, "Read changes in"], [/^create/i, "Create"], [/^delete/i, "Delete"], [/^update/i, "Update"], [/^send/i, "Send"]];

/** The grant and what Search does with it: the manifest's actions grouped by platform. */
export async function accessResponse(deps: Deps, user: UserRow): Promise<AccessResponse> {
  const manifest = await manifestActions(deps.env.ROOT);
  const sample = user.isSample;
  let status: AccessResponse["status"] = sample ? "active" : "none";
  let conns: Awaited<ReturnType<typeof connectionsFor>> = [];
  try {
    conns = await connectionsFor(deps.ctx, user.id);
    if (!sample) status = deps.oneConnect && (await deps.oneConnect.isConnected(user.id)) ? "active" : "none";
  } catch (e) {
    if ((e as { code?: string }).code === "reconnect_required") status = "reconnect_required";
  }
  const byPlatform = new Map<string, AccessResponse["platforms"][number]>();
  for (const a of manifest) {
    if (a.platform === "one") continue;
    const c = conns.find((x) => x.platform === a.platform);
    if (!c && a.grant !== false && !sample) continue;
    // every account of the platform, "dana@acme.com · dana@acme.dev"
    const labels = conns.filter((x) => x.platform === a.platform).map((x) => x.title ?? x.name ?? platformName(a.platform));
    const entry = byPlatform.get(a.platform) ?? { platform: a.platform, name: platformName(a.platform), logoUrl: logoUrl(a.platform), connectionLabel: labels.join(" · "), actions: [] };
    byPlatform.set(a.platform, entry);
    const title = a.actionId === RECEIPT_ACTION.actionId ? "Delete a Gmail message" : a.title ?? a.reason ?? a.actionId;
    const verb = VERBS.find(([re]) => re.test(title))?.[1] ?? (a.access === "write" ? "Change" : "Read");
    const level = a.access === "write" ? "write" : "read";
    const granted = a.grant === false ? false : sample ? true : !!c && (c.access.policy === "full" || (c.access.policy === "methods" ? !!a.method && c.access.methods.map((m) => m.toUpperCase()).includes(a.method) : c.access.actions.some((x) => (typeof x === "string" ? x : x.actionId) === a.actionId)));
    const existing = entry.actions.find((x) => x.actionId === a.actionId);
    if (existing) { if (a.usedBy && !existing.usedBy.includes(a.usedBy)) existing.usedBy.push(a.usedBy); continue; }
    entry.actions.push({ actionId: a.actionId, title, verb, level, granted, usedBy: a.usedBy ? [a.usedBy] : [] });
  }
  if (!manifest.some((a) => a.actionId === RECEIPT_ACTION.actionId) && byPlatform.has("gmail")) {
    byPlatform.get("gmail")!.actions.push({ actionId: RECEIPT_ACTION.actionId, title: "Delete a Gmail message", verb: "Delete", level: "write", granted: false, usedBy: [] });
  }
  return {
    grantedBy: { name: user.name, email: user.email }, platforms: [...byPlatform.values()].filter((p) => p.actions.length),
    readOnly: true, manageUrl: "https://app.withone.ai/connections", status, mode: sample ? "fixture" : "connect",
  };
}
