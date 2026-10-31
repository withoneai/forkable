// Item classification (SPEC 9.1): question set item-v1, batches of 8, only items from the
// last 90 days whose body_hash changed; older items and Jev-less grants get the rules classifier.

import { eq, inArray, sql } from "drizzle-orm";
import type { ItemKind, Lane } from "../contract.js";
import type { CallCtx, EngineCtx } from "../ctx.js";
import { classifications, entities, entityLinks, items, users } from "../db/schema.js";
import { HttpError, NotConnected } from "../errors.js";
import { one } from "../one.js";
import { platformName } from "../platforms.js";

export const QUESTION_SET = "item-v1";
export const JEV_ACTION = { platform: "typesafe", actionId: "conn_mod_def::GNh4bXcHPaU::V2ndvy5CQJmYHvkElwVM_w", method: "POST" as const, path: "/v1/systemone" };
export const JEV_KINDS = ["person_email", "team_chat", "customer", "vendor", "investor", "newsletter", "receipt", "notification", "calendar", "internal_doc", "task", "cold_pitch", "other"] as const;
const LOW_KINDS = new Set(["newsletter", "receipt", "notification", "cold_pitch"]);

export interface JevItemAnswers { kind: string; needsYou: number; ball: "me" | "them" | "nobody"; ballP: number; importance: number }

export interface LaneItem { lastFromSelf: boolean; personIds: string[]; namesVip?: boolean }

/**
 * VIP name pattern: a VIP's full name, or their first name as a whole capitalized word
 * ("Priya is the champion", "Call with Priya."). Links alone miss CRM notes and chat
 * that talk about a VIP without an id to link (SPEC 21, lanes).
 */
export function vipNamePattern(names: string[]): RegExp | null {
  const parts = new Set<string>();
  for (const n of names) {
    const clean = n.trim();
    if (!clean || clean.includes("@")) continue;
    parts.add(clean);
    const first = clean.split(/\s+/)[0]!;
    if (first.length >= 3) parts.add(first);
  }
  if (!parts.size) return null;
  const esc = [...parts].sort((a, b) => b.length - a.length).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(?<![\\p{L}])(?:${esc.join("|")})(?![\\p{L}])`, "u");
}

export function laneFor(a: JevItemAnswers, item: LaneItem, vips: Set<string>): Lane {
  const lowKind = LOW_KINDS.has(a.kind);
  if (!lowKind && a.kind !== "notification" && item.personIds.some((p) => vips.has(p))) return "vip";
  if (a.needsYou >= 0.6 || (a.ball === "me" && a.ballP >= 0.6)) return "needs_you";
  if (a.ball === "them" && item.lastFromSelf) return "waiting";
  // a VIP named but not linked is weaker than a link: it never outranks needs_you or waiting
  if (!lowKind && item.namesVip) return "vip";
  if (lowKind || a.importance <= 0) return "low";
  return "fyi";
}

function rulesAnswers(row: { kind: ItemKind; labels: string[]; title: string; platform: string; body: string }): JevItemAnswers {
  const l = row.labels.map((x) => x.toUpperCase());
  const t = `${row.title} ${row.body.slice(0, 400)}`.toLowerCase();
  let kind = "other";
  if (l.includes("CATEGORY_PROMOTIONS") || /unsubscribe|newsletter|digest/.test(t)) kind = "newsletter";
  else if (/receipt|invoice #|your order|payment received/.test(t)) kind = "receipt";
  else if (l.includes("CATEGORY_UPDATES") || /notification|no-reply|noreply/.test(t)) kind = "notification";
  else if (row.kind === "event") kind = "calendar";
  else if (row.kind === "task") kind = "task";
  else if (row.kind === "doc") kind = "internal_doc";
  else if (row.kind === "message") kind = "team_chat";
  return { kind, needsYou: 0, ball: "nobody", ballP: 0.5, importance: LOW_KINDS.has(kind) ? 0 : 1 };
}

function num(v: unknown, d = 0): number {
  if (typeof v === "number") return v;
  if (v && typeof v === "object") { const o = v as Record<string, unknown>; const x = o.noul ?? o.score ?? o.probability; if (typeof x === "number") return x; }
  return d;
}
function choice(v: unknown): { c: string; p: number } {
  if (typeof v === "string") return { c: v, p: 1 };
  if (v && typeof v === "object") { const o = v as Record<string, unknown>; return { c: String(o.choice ?? ""), p: typeof o.confidence === "number" ? o.confidence : 0.5 }; }
  return { c: "", p: 0 };
}

export function parseJevAnswers(raw: Record<string, unknown>, suffix = ""): JevItemAnswers {
  const k = choice(raw[`kind${suffix}`]);
  const b = choice(raw[`ball${suffix}`]);
  const ball = (["me", "them", "nobody"].includes(b.c) ? b.c : "nobody") as JevItemAnswers["ball"];
  return { kind: k.c || "other", needsYou: num(raw[`needs_you${suffix}`]), ball, ballP: b.p, importance: Math.max(0, Math.min(3, Math.round(num(raw[`importance${suffix}`], 1)))) };
}

// TypeSafe System One question shapes (docs.typesafe.ai/primitives): a choice names its
// options in `criteria` (option -> description), a noul's optional `criteria` is
// { true, false }, a score's `criteria` is its levels, low to high (answer `score` 0..n-1).
export const KIND_CRITERIA: Record<(typeof JEV_KINDS)[number], string> = {
  person_email: "A personal email from one person to the user.",
  team_chat: "A chat message or thread among teammates.",
  customer: "From or about a customer or prospect.",
  vendor: "From or about a vendor, supplier or service provider.",
  investor: "From or about an investor or the board.",
  newsletter: "A newsletter, digest or marketing email.",
  receipt: "A receipt, invoice, order or payment confirmation.",
  notification: "An automated notification from a tool or service.",
  calendar: "A calendar event, invite or scheduling message.",
  internal_doc: "An internal document, page or note.",
  task: "A task, ticket or issue to work on.",
  cold_pitch: "An unsolicited sales or outreach pitch from a stranger.",
  other: "None of the above.",
};
export const BALL_CRITERIA = {
  me: "The user is expected to act or reply next.",
  them: "The user is waiting on someone else.",
  nobody: "Nothing is pending from anyone.",
};
export const IMPORTANCE_CRITERIA = [
  "Noise: safe to ignore.",
  "Routine: worth a glance, nothing to do.",
  "Useful: the user will want to know.",
  "Important: the user needs to see or act on it.",
];

export function questions(n: number): Record<string, unknown> {
  const q: Record<string, unknown> = {};
  for (let i = 0; i < n; i++) {
    q[`kind_${i}`] = { type: "choice", instructions: `What kind of item is \`items[${i}]\`?`, criteria: { ...KIND_CRITERIA } };
    q[`needs_you_${i}`] = { type: "noul", instructions: `Does \`items[${i}]\` ask the user (\`me\`) to reply, decide or do something?`, criteria: { true: "It asks the user for something.", false: "Nothing is asked of the user." } };
    q[`ball_${i}`] = { type: "choice", instructions: `Whose move is next on \`items[${i}]\`?`, criteria: { ...BALL_CRITERIA } };
    q[`importance_${i}`] = { type: "score", instructions: `How important is \`items[${i}]\` to the user (\`me\`)?`, criteria: [...IMPORTANCE_CRITERIA] };
  }
  return q;
}

interface Row { id: string; external_id: string; platform: string; kind: ItemKind; title: string; body: string; labels: string[]; container: string | null; occurred_at: Date; body_hash: string; facets: Record<string, unknown> }

/** Judges items that need it. Returns counts; never throws on a Jev failure (items stay unclassified). */
export async function classifyPending(ctx: EngineCtx, userId: string, limit = 400): Promise<{ judged: number; failed: number }> {
  const [u] = await ctx.db.select().from(users).where(eq(users.id, userId));
  if (!u) return { judged: 0, failed: 0 };
  const mode: "fixture" | "connect" = u.isSample ? "fixture" : "connect";
  const settings = await ctx.settingsFor(userId);
  const vips = new Set(settings.vipEntityIds);
  const rows = (await ctx.db.execute(sql`
    select i.id, i.external_id, i.platform, i.kind, i.title, left(i.body, 4000) as body, i.labels, i.container, i.occurred_at, i.body_hash, i.facets
    from items i left join classifications c on c.item_id = i.id and c.question_set = ${QUESTION_SET}
    where i.user_id = ${userId} and i.deleted_at is null and i.directory = false and (c.item_id is null or c.body_hash <> i.body_hash)
    order by i.occurred_at desc limit ${limit}`)).rows as unknown as Row[];
  if (!rows.length) return { judged: 0, failed: 0 };

  const ids = rows.map((r) => r.id);
  const links = await ctx.db.select({ itemId: entityLinks.itemId, entityId: entityLinks.entityId, role: entityLinks.role, isSelf: entities.isSelf, name: entities.name, mergedInto: entities.mergedIntoId })
    .from(entityLinks).innerJoin(entities, eq(entities.id, entityLinks.entityId)).where(inArray(entityLinks.itemId, ids));
  const byItem = new Map<string, typeof links>();
  for (const l of links) { const a = byItem.get(l.itemId) ?? []; a.push(l); byItem.set(l.itemId, a); }
  const selfName = u.name ?? "me";
  const vipRows = vips.size ? await ctx.db.select({ name: entities.name }).from(entities).where(inArray(entities.id, [...vips])) : [];
  const vipRe = vipNamePattern(vipRows.map((v) => v.name));
  const callCtx: CallCtx = { db: ctx.db, userId, actor: "classifier", mode, oneConnect: ctx.oneConnect, transport: ctx.transport };
  const cutoff = ctx.now().getTime() - 90 * 86_400_000;
  let judged = 0, failed = 0;

  const save = async (r: Row, a: JevItemAnswers, model: string, raw: Record<string, unknown>) => {
    const ls = byItem.get(r.id) ?? [];
    const froms = ls.filter((l) => l.role === "from" || l.role === "author");
    const lastFromSelf = (r.facets.lastFrom && u.email && String(r.facets.lastFrom).toLowerCase() === u.email.toLowerCase()) || (froms.length > 0 && froms[froms.length - 1]!.isSelf);
    const namesVip = !!vipRe && vipRe.test(`${r.title}\n${r.body.slice(0, 4000)}`);
    const lane = settings.lanesOn ? laneFor(a, { lastFromSelf: !!lastFromSelf, personIds: ls.map((l) => l.mergedInto ?? l.entityId), namesVip }, vips) : null;
    const importance = a.importance / 3;
    await ctx.db.insert(classifications).values({ itemId: r.id, userId, questionSet: QUESTION_SET, bodyHash: r.body_hash, model, answers: raw, kindGuess: a.kind, importance, lane, needsYou: a.needsYou, judgedAt: ctx.now() })
      .onConflictDoUpdate({ target: [classifications.itemId, classifications.questionSet], set: { bodyHash: r.body_hash, model, answers: raw, kindGuess: a.kind, importance, lane, needsYou: a.needsYou, judgedAt: ctx.now() } });
    await ctx.db.update(items).set({ lane, importance }).where(eq(items.id, r.id));
    judged++;
  };

  const recent = rows.filter((r) => new Date(r.occurred_at).getTime() >= cutoff);
  for (const r of rows.filter((x) => new Date(x.occurred_at).getTime() < cutoff)) await save(r, rulesAnswers(r), "rules", {});

  if (mode === "fixture") {
    for (const r of recent) {
      const res = await one.raw({ ...callCtx, rollup: undefined }, { ...JEV_ACTION, action: "systemone", level: "read", summary: "Classify an item for lanes", fixtureKey: `judgment:${r.platform}:${r.external_id}`, body: {} }).catch(() => null);
      if (res && res.ok && res.data && typeof res.data === "object") {
        const d = res.data as Record<string, unknown>;
        await save(r, { kind: String(d.kind ?? "other"), needsYou: num(d.needs_you), ball: (d.ball as JevItemAnswers["ball"]) ?? "nobody", ballP: num(d.ball_p, 0.5), importance: Math.round(num(d.importance, 1)) }, "fixture", d);
      } else await save(r, rulesAnswers(r), "rules", {});
    }
    return { judged, failed };
  }

  for (let i = 0; i < recent.length; i += 8) {
    const batch = recent.slice(i, i + 8);
    const state = {
      me: { name: selfName, emails: u.email ? [u.email] : [] },
      vips: [...new Set(links.filter((l) => vips.has(l.entityId)).map((l) => l.name))],
      items: batch.map((r) => ({
        kind: r.kind, source: platformName(r.platform), title: r.title, container: r.container,
        from: (byItem.get(r.id) ?? []).filter((l) => l.role === "from" || l.role === "author" || l.role === "organizer").map((l) => l.name).slice(0, 3),
        to: (byItem.get(r.id) ?? []).filter((l) => l.role === "to" || l.role === "cc" || l.role === "attendee").map((l) => l.name).slice(0, 5),
        date: new Date(r.occurred_at).toISOString(), body: r.body.slice(0, 2000),
      })),
    };
    try {
      const res = await one.call<{ answers?: Record<string, unknown>; model?: string }>(callCtx, { ...JEV_ACTION, action: "systemone", level: "read", summary: "Classify items for lanes", body: { model: settings.jevModel, state, questions: questions(batch.length) } });
      const ans = res.answers ?? {};
      for (const [j, r] of batch.entries()) await save(r, parseJevAnswers(ans, `_${j}`), res.model ?? settings.jevModel, Object.fromEntries(Object.entries(ans).filter(([k]) => k.endsWith(`_${j}`))));
    } catch (e) {
      if (e instanceof NotConnected) { for (const r of batch) await save(r, rulesAnswers(r), "rules", {}); continue; }
      failed += batch.length;
      ctx.log(`classify failed: ${(e as Error).message}`);
      if (!(e instanceof HttpError)) break;
    }
  }
  return { judged, failed };
}

/** Sample VIPs: fixtures name entity keys; settings keep entity ids. */
export async function vipIdsForKeys(ctx: EngineCtx, userId: string, keys: string[]): Promise<string[]> {
  if (!keys.length) return [];
  const r = await ctx.db.execute(sql`select distinct coalesce(e.merged_into_id, e.id) as id from entity_keys k join entities e on e.id = k.entity_id where k.user_id = ${userId} and k.key in (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})`);
  return (r.rows as { id: string }[]).map((x) => x.id);
}

