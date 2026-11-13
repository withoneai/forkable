// An agent's sign-in belongs to the account that pressed Connect (SPEC 16.5). When
// that person signs out, disconnects from One, or a different REAL account finishes
// Sign in with One on this Search, every agent sign-in of the old account ends at
// once, so an agent never keeps reading an account nobody is signed in to (the Acme
// sample after a switch to a real account, for one). The cards then ask for Connect
// again. Opening the Acme sample (in the app or on an agent's consent page) never
// ends anything: an agent connected under the real account keeps reading the real
// account's index (its token names that user), and the Agents screen, while the
// browser shows the sample, says so instead of listing it as the sample's.

import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { dbSchema, type Db } from "@search/core";
import { AGENT_IDS, clientBelongsTo } from "./agents.js";

const { oauthClients, oauthTokens } = dbSchema;

async function agentClientIds(db: Db): Promise<string[]> {
  const rows = await db.select({ id: oauthClients.clientId, name: oauthClients.clientName }).from(oauthClients);
  return rows.filter((r) => AGENT_IDS.some((a) => clientBelongsTo(a, r.name))).map((r) => r.id);
}

/** Ends the agent sign-ins of `userId` (sign-out, disconnect). */
export async function endAgentSignInsOf(db: Db, userId: string): Promise<void> {
  const ids = await agentClientIds(db);
  if (!ids.length) return;
  await db.update(oauthTokens).set({ revokedAt: new Date() }).where(and(eq(oauthTokens.userId, userId), inArray(oauthTokens.clientId, ids), isNull(oauthTokens.revokedAt)));
}

/** A real account (`userId`) just finished Sign in with One: agent sign-ins of every other account end. Called from connect.ts only, never for the sample. */
export async function endOtherAccountsAgentSignIns(db: Db, userId: string): Promise<void> {
  const ids = await agentClientIds(db);
  if (!ids.length) return;
  await db.update(oauthTokens).set({ revokedAt: new Date() }).where(and(ne(oauthTokens.userId, userId), inArray(oauthTokens.clientId, ids), isNull(oauthTokens.revokedAt)));
}

/** Remove: the agent's sign-in is gone from Signed-in apps too, not listed as signed out. */
export async function forgetAgentClients(db: Db, userId: string, clientIds: string[]): Promise<void> {
  if (!clientIds.length) return;
  await db.delete(oauthTokens).where(and(eq(oauthTokens.userId, userId), inArray(oauthTokens.clientId, clientIds)));
}
