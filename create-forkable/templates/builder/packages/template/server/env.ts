// Bindings and vars the Worker sees. In preview, __BRAND_NAME__ writes .dev.vars
// (the dev check's address and token, never a One secret) and hands the app
// its One Connect values through the dev server's own env. Published apps
// get the same ONE_* values in their host's settings at publish.

export interface Bindings {
  /** D1 on Workers and in preview. */
  DB?: D1Database;
  /** libSQL on Vercel (the builder sets both on the Vercel project). */
  DATABASE_URL?: string;
  DATABASE_AUTH_TOKEN?: string;
  /** "connect": One Connect is on (Sign in with One on this app's own Connect app). "off": no One login, no One calls. */
  ONE_MODE?: "connect" | "off";
  // preview only (the dev check)
  "__ENV_PREFIX__DEV_URL"?: string;
  "__ENV_PREFIX__DEV_TOKEN"?: string;
  "__ENV_PREFIX__PROJECT_ID"?: string;
  /** The keyless sample's stub One (preview only, never published). */
  ONE_API_URL?: string;
  // this app's own Connect app
  ONE_CLIENT_ID?: string;
  ONE_CLIENT_SECRET?: string;
  ONE_CONNECT_KEY?: string;
  ONE_REDIRECT_URI?: string;
  ONE_PERMISSION_SET?: string;
  /** The account whose grant public pages use: one(c, { as: "owner" }). */
  APP_OWNER_EMAIL?: string;
  /**
   * Action ids visitors may trigger on the owner's grant, comma-separated,
   * or "none". The builder ticks them in Access; publish sets this. Unset is off.
   */
  APP_VISITOR_ACTIONS?: string;
}

export type AppEnv = { Bindings: Bindings };
