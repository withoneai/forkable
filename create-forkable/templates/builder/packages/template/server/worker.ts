import app from "./app";

// Cloudflare Workers entry. Requests for /api/* reach the Hono app; the
// React app is served as static assets (wrangler.jsonc).
export default { fetch: app.fetch } satisfies ExportedHandler<import("./env").Bindings>;
