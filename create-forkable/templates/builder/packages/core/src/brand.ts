// The only place the product name lives.
// Everything else derives from it. Strings that cannot import it are listed
// in docs/RENAME.md.

export const BRAND = {
  name: "Builder", // UI copy, CLI banner, commit trailers
  slug: "builder", // dirs, MCP server name, data attributes, routes
  envPrefix: "BUILDER_", // env vars the platform sets or reads
  homeDir: ".builder", // under the user's home; BUILDER_HOME overrides
  projectDir: ".builder", // inside each generated project
} as const;

export const VERSION = "0.1.0";

export const env = (name: string): string => `${BRAND.envPrefix}${name}`;

/** `data-builder-loc` */
export const LOC_ATTR = `data-${BRAND.slug}-loc`;
/** `/__builder` */
export const PREVIEW_ROUTE = `/__${BRAND.slug}`;
/** `Builder-Turn` and friends */
export const trailer = (key: "Turn" | "Harness" | "Session" | "Kind"): string => `${BRAND.name}-${key}`;

/** A port from the environment (a scratch run beside a running server), else the pinned default. */
const portFrom = (name: string, def: number): number => {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const v = Number(proc?.env?.[env(name)]);
  return Number.isInteger(v) && v > 1024 && v < 65536 ? v : def;
};

export const PORTS = {
  /** Pinned. BUILDER_SERVER_PORT only for scratch runs. */
  server: portFrom("SERVER_PORT", 51989),
  /** Pinned: the shared preview callback every project's Connect app registers lives here. */
  proxy: portFrom("PROXY_PORT", 51990),
  uiDev: 5380,
  devMin: 52000,
  devMax: 52999,
  /** Embedded Postgres starts probing here. */
  pg: 51995,
} as const;

export const SERVER_ORIGIN = `http://127.0.0.1:${PORTS.server}`;
export const previewUrl = (slug: string, path = "/"): string =>
  `http://${slug}.localhost:${PORTS.proxy}${path.startsWith("/") ? path : `/${path}`}`;

/**
 * The one preview redirect URI a Connect app needs, for every project.
 * The proxy answers it and sends
 * the browser on to the project that started the sign-in, by the state it
 * registered. Its path mirrors the app's own /api/one/callback, so the
 * package's PKCE cookie (scoped to the callback's directory) reaches the app.
 */
export const PREVIEW_CALLBACK = `http://127.0.0.1:${PORTS.proxy}/api/one/callback`;
/** A preview app's own callback, the address the shared one forwards to. */
export const projectCallback = (label: string): string => `http://${label}.localhost:${PORTS.proxy}/api/one/callback`;
