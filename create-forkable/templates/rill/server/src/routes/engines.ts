import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { one, schema, writer, type EngineOption, type EnginesResponse } from "@rill/core";
import { buildCtx } from "../ctx.js";
import type { AppEnv, Deps } from "../deps.js";
import { currentUser } from "../session.js";

export const engineRoutes = new Hono<AppEnv>();

// Probing installed CLIs costs a few hundred ms; cache per process for a minute.
let cache: { at: number; options: EngineOption[]; granted: string } | null = null;
export async function detectedEngines(deps: Pick<Deps, "env" | "oneConnect">, userId: string | null, force = false): Promise<EngineOption[]> {
  const granted = userId ? [...(await one.grantedConnections(deps.oneConnect, userId)).keys()] : [];
  const key = granted.sort().join(",");
  if (!force && cache && cache.granted === key && Date.now() - cache.at < 60_000) return cache.options;
  const options = await writer.detectEngines(deps.env, granted);
  cache = { at: Date.now(), options, granted: key };
  return options;
}

engineRoutes.get("/engines", async (c) => {
  const deps = c.get("deps");
  const user = await currentUser(c, { create: false });
  const options = await detectedEngines(deps, user?.id ?? null, c.req.query("refresh") === "1");
  let current: EnginesResponse["current"] = null;
  if (user) {
    const [mailbox] = await deps.db.select().from(schema.mailboxes).where(eq(schema.mailboxes.userId, user.id)).orderBy(schema.mailboxes.createdAt).limit(1);
    if (mailbox) {
      const ctx = await buildCtx(deps, mailbox, user);
      if (ctx.settings.writerEngine && ctx.settings.writerProvider) {
        current = { engine: ctx.settings.writerEngine, provider: ctx.settings.writerProvider, model: ctx.settings.writerModel ?? "" };
      } else {
        const w = await writer.pickWriter(ctx, options).catch(() => null);
        current = w ? { engine: w.engine, provider: w.provider, model: w.model } : null;
      }
    }
  }
  const body: EnginesResponse = { options, current, local: deps.env.LOCAL };
  return c.json(body);
});
