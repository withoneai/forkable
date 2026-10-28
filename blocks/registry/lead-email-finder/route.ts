import { Hono } from "hono";
import type { OneServer } from "../lib/one-server.js";
import { findEmail, runtimeFor, verifyEmail } from "../lead/waterfall.js";

/**
 * POST /api/lead/email  { name, domain } -> EmailFindResponse (Findymail, then Hunter)
 * POST /api/lead/verify { email }        -> VerifyResponse (Clearout, then Hunter)
 */
export function leadEmailFinderRoute(one: OneServer) {
  const r = new Hono();
  const meta = (mode: string, platform: string) => ({ mode, platform, access: "read", status: 200 });
  r.post("/api/lead/email", async (c) => {
    const { name = "", domain = "" } = (await c.req.json().catch(() => ({}))) as { name?: string; domain?: string };
    if (!name.trim() || !domain.trim()) return c.json({ error: { code: "bad_request", message: "Give a full name and a company domain." } }, 400);
    try {
      const rt = runtimeFor(one, c);
      return c.json({ data: await findEmail(rt, { name: name.trim(), domain: domain.trim().toLowerCase() }), meta: meta(rt.mode, "findymail") });
    } catch (e) {
      return one.error(c, e);
    }
  });
  r.post("/api/lead/verify", async (c) => {
    const { email = "" } = (await c.req.json().catch(() => ({}))) as { email?: string };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return c.json({ error: { code: "bad_request", message: "That is not an email address." } }, 400);
    try {
      const rt = runtimeFor(one, c);
      return c.json({ data: await verifyEmail(rt, email.trim().toLowerCase()), meta: meta(rt.mode, "clearout") });
    } catch (e) {
      return one.error(c, e);
    }
  });
  return r;
}
