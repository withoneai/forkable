import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface Env {
  OAUTH_KV: KVNamespace;
  DB: D1Database;
  OAUTH_PROVIDER: OAuthHelpers;
  /** "off" serves /mcp with no sign-in, on the Acme sample. */
  AUTH: string;
  PUBLIC_URL: string;
  ONE_CLIENT_ID?: string;
  ONE_CLIENT_SECRET?: string;
  ONE_PERMISSION_SET?: string;
  ONE_CONNECT_KEY?: string;
}
