import app from "../server/app";
import type { Bindings } from "../server/env";

// Vercel entry. `pnpm build:vercel` bundles this file into one Node.js
// Vercel Function (tools/build-vercel.mjs) and routes /api/* to it. The
// variables set on the Vercel project become the app's bindings, so server/
// reads c.env the same way on Workers and on Vercel. The database is libSQL
// there (DATABASE_URL, DATABASE_AUTH_TOKEN), see server/db/client.ts.

export default function handler(req: Request): Response | Promise<Response> {
  return app.fetch(req, process.env as unknown as Bindings);
}
