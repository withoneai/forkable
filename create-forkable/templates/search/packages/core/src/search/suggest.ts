// GET /suggest (CONTRACT 6.2): completions for the operator under the cursor
// (people and companies for from/to/with/about, platforms for in/source, fixed
// vocabularies for type/is/lane/has and dates), entity chips for a plain word,
// and the user's recent searches.

import { sql } from "drizzle-orm";
import type { EntityChip, SuggestResponse } from "../api-types.js";
import type { EngineCtx } from "../ctx.js";
import { logoUrl, platformName } from "../platforms.js";
import { entityChips } from "./hybrid.js";

const TYPES = ["mail", "event", "meeting", "person", "company", "doc", "issue", "message", "deal", "note"];
const IS = ["unread", "vip", "needs-you", "waiting", "mine", "open", "upcoming", "past"];
const LANES = ["vip", "needs-you", "waiting", "fyi", "low"];
const HAS = ["attachment", "link", "joinurl", "transcript"];
const DATES = ["today", "yesterday", "7d", "30d", "this-week", "last-week", "this-month", "last-month"];
const OPS = ["from", "to", "with", "about", "in", "type", "is", "lane", "after", "before", "on", "updated", "has", "status", "stage", "label", "container", "amount", "id"];

async function rows<T>(ctx: EngineCtx, q: ReturnType<typeof sql>): Promise<T[]> {
  return (await ctx.db.execute(q)).rows as T[];
}

async function entityHits(ctx: EngineCtx, userId: string, part: string, people: boolean, limit: number) {
  const like = `${part.toLowerCase()}%`;
  return rows<{ id: string; type: "person" | "company"; name: string; primary_email: string | null; domain: string | null; is_self: boolean }>(ctx, sql`
    select id, type, name, primary_email, domain, is_self from entities
    where user_id = ${userId} and merged_into_id is null and (item_count > 0 or is_self)
      ${people ? sql`and type = 'person'` : sql``}
      and (${part === ""} or lower(name) like ${like} or lower(name) like ${`% ${part.toLowerCase()}%`} or lower(coalesce(primary_email, '')) like ${like} or lower(coalesce(domain, '')) like ${like})
    order by is_self desc, item_count desc limit ${limit}`);
}

export async function suggest(ctx: EngineCtx, userId: string, prefix: string): Promise<SuggestResponse> {
  const operators: SuggestResponse["operators"] = [];
  let entities: EntityChip[] = [];
  const m = /(-?)([a-z]+):("?[^\s"]*)$/i.exec(prefix);
  if (m) {
    const neg = m[1] ?? "";
    const key = m[2]!.toLowerCase();
    const part = m[3]!.replace(/^"/, "").toLowerCase();
    const add = (insert: string, label: string, extra: { logoUrl?: string; avatarUrl?: string } = {}) => operators.push({ insert: `${neg}${insert}`, label, ...extra });
    if (["from", "to", "with", "about"].includes(key)) {
      for (const e of await entityHits(ctx, userId, part, key !== "with" && key !== "about", 5)) {
        const v = e.is_self ? "me" : e.type === "company" ? e.domain ?? e.name : (e.name.includes(" ") ? `"${e.name}"` : e.name.toLowerCase());
        add(`${key}:${v}`, `${key}: ${e.name}${e.is_self ? " (you)" : ""}`);
      }
    } else if (key === "in" || key === "source") {
      const ps = await rows<{ platform: string }>(ctx, sql`select distinct platform from sources where user_id = ${userId} order by platform`);
      for (const p of ps.map((x) => x.platform).filter((p) => p.startsWith(part) || platformName(p).toLowerCase().startsWith(part)).slice(0, 5)) add(`${key}:${p}`, `${key}: ${platformName(p)}`, { logoUrl: logoUrl(p) });
    } else if (key === "type") for (const t of TYPES.filter((x) => x.startsWith(part))) add(`type:${t}`, `type: ${t}`);
    else if (key === "is") for (const t of IS.filter((x) => x.startsWith(part))) add(`is:${t}`, `is: ${t}`);
    else if (key === "lane") for (const t of LANES.filter((x) => x.startsWith(part))) add(`lane:${t}`, `lane: ${t}`);
    else if (key === "has") for (const t of HAS.filter((x) => x.startsWith(part))) add(`has:${t}`, `has: ${t}`);
    else if (["after", "before", "on", "updated", "during"].includes(key)) for (const t of DATES.filter((x) => x.startsWith(part))) add(`${key}:${t}`, `${key}: ${t}`);
  } else {
    const w = prefix.trim().split(/\s+/).pop()?.toLowerCase() ?? "";
    if (w.length >= 1 && /^[a-z]+$/.test(w)) for (const k of OPS.filter((o) => o.startsWith(w) && o !== w).slice(0, 3)) operators.push({ insert: `${k}:`, label: `${k}:` });
    if (w.length >= 2) {
      const hits = (await entityHits(ctx, userId, w, false, 4)).filter((e) => !e.is_self).slice(0, 3);
      entities = await entityChips(ctx, hits.map((h) => h.id));
    }
  }
  const p = prefix.trim().toLowerCase();
  const recent = await rows<{ query: string }>(ctx, sql`
    select query from (select query, max(at) as at from recent_searches where user_id = ${userId} group by query) r
    where ${p === ""} or lower(query) like ${`${p}%`} or lower(query) like ${`% ${p}%`} order by at desc limit 5`);
  return { operators: operators.slice(0, 5), entities, recent: recent.map((r) => r.query) };
}
