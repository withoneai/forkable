// What understanding (D48) checks words against: one user's people, companies and
// connected platforms. Kept per user for 30 seconds while the counts of entities and
// sources stay the same (one cheap count per search), dropped at once when sources,
// entities or merges change (dropVocab), and built once even when searches arrive
// together (one load in flight per user).

import { sql } from "drizzle-orm";
import type { EngineCtx } from "../ctx.js";
import type { Vocab, VocabEntity } from "../query/understand.js";

const TTL_MS = 30_000;
/** The most people and companies kept in memory, busiest first. Past it, exact names and addresses are looked up per search. */
export const VOCAB_MAX = 20_000;
const cache = new Map<string, { at: number; stamp: string; vocab: Vocab; gen: number }>();
const inflight = new Map<string, Promise<Vocab>>();
/** Bumped by dropVocab: a load that started before a drop is not kept. */
const gens = new Map<string, number>();
let globalGen = 0;
const genOf = (userId: string) => (gens.get(userId) ?? 0) + globalGen;

interface EntityRow { id: string; type: "person" | "company"; name: string; primary_email: string | null; domain: string | null; is_self: boolean; item_count: number }
const toEntity = (e: EntityRow): VocabEntity => ({ id: e.id, type: e.type, name: e.name, email: e.primary_email, domain: e.domain, isSelf: e.is_self, itemCount: e.item_count });

export async function vocabFor(ctx: EngineCtx, userId: string): Promise<Vocab> {
  const c = (await ctx.db.execute(sql`select (select count(*) from entities where user_id = ${userId} and merged_into_id is null)::int as e, (select count(*) from sources where user_id = ${userId})::int as s`)).rows[0] as { e: number; s: number };
  const stamp = `${c.e}:${c.s}`;
  const hit = cache.get(userId);
  if (hit && hit.stamp === stamp && hit.gen === genOf(userId) && Date.now() - hit.at < TTL_MS) return hit.vocab;
  const gen = genOf(userId);
  const key = `${userId}\u0000${stamp}\u0000${gen}`;
  const running = inflight.get(key);
  if (running) return running;
  const load = (async () => {
    const ents = (await ctx.db.execute(sql`
      select id, type, name, primary_email, domain, is_self, item_count from entities
      where user_id = ${userId} and merged_into_id is null and (item_count > 0 or is_self) and length(name) > 1
      order by item_count desc limit ${VOCAB_MAX + 1}`)).rows as unknown as EntityRow[];
    const plats = (await ctx.db.execute(sql`select distinct platform from sources where user_id = ${userId}`)).rows as { platform: string }[];
    // which kinds each tool holds, so "slack messages" reads as one chip (a type a tool already implies)
    const held = (await ctx.db.execute(sql`select platform, array_agg(distinct kind::text) as kinds from items where user_id = ${userId} and deleted_at is null and directory = false group by platform`)).rows as { platform: string; kinds: string[] }[];
    const chans = (await ctx.db.execute(sql`select distinct container from items where user_id = ${userId} and kind = 'message' and deleted_at is null and container like '#%'`)).rows as { container: string }[];
    const vocab: Vocab = {
      channels: chans.map((c) => c.container.slice(1).toLowerCase()).filter(Boolean),
      entities: ents.slice(0, VOCAB_MAX).map(toEntity),
      platforms: plats.map((p) => p.platform),
      kinds: Object.fromEntries(held.map((h) => [h.platform, h.kinds])),
      truncated: ents.length > VOCAB_MAX,
    };
    if (gen === genOf(userId)) {
      cache.set(userId, { at: Date.now(), stamp, vocab, gen });
      if (cache.size > 200) { const first = cache.keys().next().value; if (first) cache.delete(first); }
    }
    return vocab;
  })();
  inflight.set(key, load);
  try { return await load; } finally { inflight.delete(key); }
}

/**
 * People and companies the in-memory list left out (it keeps the busiest VOCAB_MAX):
 * an exact full name (two or three words) or an address in the sentence is looked up
 * in the database, so a quiet contact is still found by name.
 */
export async function vocabExtra(ctx: EngineCtx, userId: string, q: string, vocab: Vocab): Promise<VocabEntity[]> {
  if (!vocab.truncated) return [];
  const words = q.toLowerCase().replace(/"/g, " ").split(/[\s,;?!]+/).filter(Boolean);
  const emails = new Set(words.filter((w) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(w)).map((w) => w.replace(/[.]+$/, "")));
  const names = new Set<string>();
  const plain = words.map((w) => w.replace(/['’]s$/, "")).filter((w) => !w.includes("@") && !w.includes(":"));
  for (let i = 0; i < plain.length; i++) for (const n of [2, 3]) if (i + n <= plain.length) names.add(plain.slice(i, i + n).join(" "));
  const known = new Set(vocab.entities.map((e) => e.id));
  if (!emails.size && !names.size) return [];
  const conds = [
    ...(names.size ? [sql`lower(name) in (${sql.join([...names].slice(0, 60).map((n) => sql`${n}`), sql`, `)})`] : []),
    ...(emails.size ? [sql`lower(primary_email) in (${sql.join([...emails].map((e) => sql`${e}`), sql`, `)})`] : []),
  ];
  const rows = (await ctx.db.execute(sql`
    select id, type, name, primary_email, domain, is_self, item_count from entities
    where user_id = ${userId} and merged_into_id is null and (item_count > 0 or is_self) and (${sql.join(conds, sql` or `)})
    order by item_count desc limit 20`)).rows as unknown as EntityRow[];
  return rows.filter((r) => !known.has(r.id)).map(toEntity);
}

/** Forget a user's vocabulary (sources, entities or merges changed). */
export function dropVocab(userId?: string): void {
  if (userId) { cache.delete(userId); gens.set(userId, (gens.get(userId) ?? 0) + 1); }
  else { cache.clear(); globalGen++; }
}
