import { createOneConnect, type OneConnectClient, type OneConnectKeyClient, type OneConnectTokens } from "@withone/connect/server";
import type { Env } from "./env.js";

// Key mode when the Worker has ONE_CONNECT_KEY: one permanent reference per
// user, nothing rotates, so no lock is needed. Kept in KV under the user's id.
//
// Token mode otherwise: One gives each user an access and a refresh token, kept here in
// KV under the user's id. No connect key, no ONE_SECRET.
// Prototype gap: no cross-isolate lock around a refresh (withLock). One
// rotates the refresh token and treats reuse as theft, so a production build
// puts the pair behind a Durable Object per user.

export function connectFor(env: Env): OneConnectClient | null {
  if (!env.ONE_CLIENT_ID || !env.ONE_CLIENT_SECRET) return null;
  const key = (userId: string) => `one:${userId}`;
  const base = {
    clientId: env.ONE_CLIENT_ID,
    clientSecret: env.ONE_CLIENT_SECRET,
    redirectUri: `${env.PUBLIC_URL}/api/one/callback`,
    permissionSet: env.ONE_PERMISSION_SET || undefined,
  };
  if (env.ONE_CONNECT_KEY) {
    return createOneConnect({
      ...base,
      mode: "key",
      connectKey: env.ONE_CONNECT_KEY,
      userStore: {
        saveUser: (userId, reference) => env.OAUTH_KV.put(key(userId), reference),
        loadUser: (userId) => env.OAUTH_KV.get(key(userId)),
        clearUser: (userId) => env.OAUTH_KV.delete(key(userId)),
      },
    });
  }
  return createOneConnect({
    ...base,
    mode: "token",
    tokenStore: {
      saveTokens: (userId, t) => env.OAUTH_KV.put(key(userId), JSON.stringify(t)),
      loadTokens: async (userId) => {
        const raw = await env.OAUTH_KV.get(key(userId));
        return raw ? (JSON.parse(raw) as OneConnectTokens) : null;
      },
      clearTokens: async (userId, failed) => {
        if (failed) {
          const raw = await env.OAUTH_KV.get(key(userId));
          if (raw && (JSON.parse(raw) as OneConnectTokens).refreshToken !== failed.refreshToken) return;
        }
        await env.OAUTH_KV.delete(key(userId));
      },
    },
  });
}

/** One's permanent id for the person (cu_...), in key mode. The same person
 *  signing in from a second chat app lands on the same user. */
export async function stableUserId(env: Env, connect: OneConnectClient, userId: string): Promise<string> {
  if (connect.mode !== "key") return userId;
  const cu = await (connect as OneConnectKeyClient).getConnectUserId(userId).catch(() => null);
  if (!cu || cu === userId) return userId;
  const ref = await env.OAUTH_KV.get(`one:${userId}`);
  if (ref) await env.OAUTH_KV.put(`one:${cu}`, ref);
  await env.OAUTH_KV.delete(`one:${userId}`);
  return cu;
}
