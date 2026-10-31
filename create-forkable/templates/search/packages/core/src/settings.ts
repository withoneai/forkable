import { eq } from "drizzle-orm";
import type { SettingsData } from "./contract.js";
import type { Db } from "./db/client.js";
import { settings, users } from "./db/schema.js";

export const DEFAULT_SETTINGS: SettingsData = {
  embedding: { provider: "openai", model: "text-embedding-3-small", dims: 1536 },
  rerank: true,
  engine: "auto",
  chatModel: "claude-sonnet-5-5",
  proposalModel: "claude-haiku-5-5",
  localChatModel: "claude-sonnet-5-5",
  localProposalModel: "claude-haiku-5-5",
  jevModel: process.env.SEARCH_JEV_MODEL || "jev-latest",
  backfillDefault: "365d",
  slackTier: "limited",
  vipEntityIds: [],
  lanesOn: true,
  paused: false,
};

export const SAMPLE_SETTINGS: SettingsData = {
  ...DEFAULT_SETTINGS,
  embedding: { provider: "local", model: "hash-v1", dims: 1536 },
};

export async function getSettings(db: Db, userId: string): Promise<SettingsData> {
  const [row] = await db.select().from(settings).where(eq(settings.userId, userId));
  if (row) return { ...DEFAULT_SETTINGS, ...row.data };
  const [u] = await db.select({ isSample: users.isSample }).from(users).where(eq(users.id, userId));
  return u?.isSample ? SAMPLE_SETTINGS : DEFAULT_SETTINGS;
}

export async function putSettings(db: Db, userId: string, patch: Partial<SettingsData>): Promise<SettingsData> {
  const cur = await getSettings(db, userId);
  const next = { ...cur, ...patch, embedding: { ...cur.embedding, ...(patch.embedding ?? {}), dims: 1536 as const } };
  await db.insert(settings).values({ userId, data: next, updatedAt: new Date() }).onConflictDoUpdate({ target: settings.userId, set: { data: next, updatedAt: new Date() } });
  return next;
}
