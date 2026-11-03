import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../env";
import { db, schema } from "../db/client";
import { clientFor } from "./client";

// The only way this app calls a platform (Gmail, Slack, Stripe, ...):
//
//   const r = await one(c).run(gmail.sendEmail, { body: { to, subject, body } });
//   if (!r.ok) return c.json(r, r.status as 403);   // r.refusal says who refused it
//
// Wrappers like gmail.sendEmail come from ./actions.gen.ts, generated from
// One's catalog. Every call runs on the signed-in person's grant to this
// app's own Connect app (One Connect, set in the project's Settings): in
// preview that is the developer's own sign-in. No keys live in this code.

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** The split every action's input keeps (ioSchema): body, query, path parameters, headers. */
export interface ActionInput {
  body?: unknown;
  query?: object;
  pathParams?: object;
  headers?: object;
}

export interface Action<In extends ActionInput = ActionInput, Out = unknown> {
  platform: string;
  actionId: string;
  method: Method;
  path: string;
  title: string;
  /** Fixed headers the action needs (from the catalog), sent by the client. */
  headers?: Record<string, string>;
  /** Type carrier only, never set at runtime. */
  readonly __types?: { input: In; output: Out };
}

export function action<In extends ActionInput = ActionInput, Out = unknown>(def: {
  platform: string;
  actionId: string;
  method: Method | string;
  path: string;
  title: string;
  headers?: Record<string, string>;
}): Action<In, Out> {
  return def as Action<In, Out>;
}

export interface Refusal {
  /**
   * "one": the user's grant does not allow it (One answered 403, the provider was never called).
   * "sample": the same, from the keyless sample grant.
   * "local": stopped before it reached One (not in this app's manifest, One Connect off, nobody signed in, nothing connected yet).
   * "held": a write paused while the app is being changed.
   */
  source: "one" | "sample" | "local" | "held";
  code: string;
  message?: string;
}

export type RunResult<Out> =
  | { ok: true; status: number; data: Out }
  | { ok: false; status: number; refusal?: Refusal; data?: unknown };

export interface OneUser {
  id: string;
  name: string | null;
  email: string | null;
}

/**
 * one(c) runs on the signed-in user's grant. one(c, { as: "owner" }) runs on
 * the app owner's grant instead, for public pages a visitor uses without
 * signing in (a contact form that files a Notion page). The owner is the
 * account named by APP_OWNER_EMAIL, once it has signed in with One and
 * granted the app; in preview it is whoever signed in to the preview first.
 *
 * Off until the builder allows it, per action: a call they have not allowed
 * returns a local refusal (code visitors_off or visitor_not_allowed) and
 * never reaches One. Only the builder can allow it, not the code.
 */
export function one(c: Context<AppEnv>, opts: { as?: "user" | "owner" } = {}) {
  const client = clientFor(c);
  return {
    run<In extends ActionInput, Out>(a: Action<In, Out>, input: In): Promise<RunResult<Out>> {
      return client.run(a, input, opts.as ?? "user") as Promise<RunResult<Out>>;
    },
  };
}

/** True when the grant refused the call (One, or the sample grant). Show <Receipt>, do not retry. */
export function refusedByGrant(r: RunResult<unknown>): boolean {
  return !r.ok && (r.refusal?.source === "one" || r.refusal?.source === "sample");
}

/** The signed-in user, or a 401. Every route that calls one(c).run starts with it. */
export async function requireUser(c: Context<AppEnv>): Promise<OneUser> {
  const user = await clientFor(c).me(c);
  if (!user) {
    throw new HTTPException(401, {
      res: Response.json({ error: { code: "signed_out", message: "Sign in with One to continue." } }, { status: 401 }),
    });
  }
  await ensureUserRow(c, user);
  return user;
}

// Sign-in writes the users row; a preview user may not have one yet,
// and a table whose userId references users(id) would refuse every insert.
const known = new Set<string>();
async function ensureUserRow(c: Context<AppEnv>, user: OneUser): Promise<void> {
  if (known.has(user.id)) return;
  try {
    await db(c).insert(schema.users).values({ id: user.id, email: user.email, name: user.name }).onConflictDoNothing();
    known.add(user.id);
  } catch {
    /* no database yet: the app has no tables of its own */
  }
}
