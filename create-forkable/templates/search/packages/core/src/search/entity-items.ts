// One source of truth for "how many items" a person or company has (polish 2026-11-12): the card
// in the results strip and the page it opens both read entityItemStats, so they cannot disagree.
// The set is every item linked to the entity, and for a company to the people who work there.
// The page's timeline is a view of that set: its own records left out (Priya's contact is the
// page itself), two tools' copies of one thing shown once, the newest 50; the page says so.

import { sql } from "drizzle-orm";
import type { EngineCtx } from "../ctx.js";

export const TIMELINE_LIMIT = 50;

const linked = (ids: string[]) => sql`
  select l.entity_id as owner, l.item_id from entity_links l where l.entity_id in (${sql.join(ids.map((x) => sql`${x}`), sql`, `)})
  union
  select p.company_id as owner, l.item_id from entity_links l join entities p on p.id = l.entity_id
    where p.company_id in (${sql.join(ids.map((x) => sql`${x}`), sql`, `)}) and p.merged_into_id is null`;

/** Every item linked to the entity, and for a company to the people who work there. */
export async function entityItemIds(ctx: EngineCtx, entityId: string): Promise<string[]> {
  const r = (await ctx.db.execute(sql`select distinct item_id from (${linked([entityId])}) x where owner = ${entityId}`)).rows as { item_id: string }[];
  return r.map((x) => x.item_id);
}

/** The count and tools every card and page show for a person or company: the live items in entityItemIds. */
export async function entityItemStats(ctx: EngineCtx, ids: string[]): Promise<Map<string, { count: number; platforms: string[] }>> {
  const out = new Map<string, { count: number; platforms: string[] }>();
  if (!ids.length) return out;
  const r = (await ctx.db.execute(sql`
    select x.owner, count(distinct i.id)::int as n, array_agg(distinct i.platform) as platforms
    from (${linked(ids)}) x join items i on i.id = x.item_id
    where i.deleted_at is null group by x.owner`)).rows as { owner: string; n: number; platforms: string[] | null }[];
  for (const x of r) out.set(x.owner, { count: Number(x.n), platforms: (x.platforms ?? []).sort() });
  return out;
}
