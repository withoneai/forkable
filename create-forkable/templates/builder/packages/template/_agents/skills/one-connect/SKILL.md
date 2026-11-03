---
name: one-connect
description: How this app calls third-party platforms (Gmail, Slack, Notion, Stripe and more) through One Connect. Use before adding any feature that reads from or writes to another tool, and when handling a refused call.
---

# One Connect in this app

This app is already wired for One Connect. Users sign in with One and grant
the app scoped, revocable access to their own tools. The app never holds a
provider key: every call runs on the user's grant, and One enforces it.

One Connect is per app. The app has its own Connect app, set in the
project's Settings (a new one, a saved template, or another project's), and
it is off until the builder turns it on. In preview the calls run on the
builder's own sign-in to this app, so One's real refusals show up here.
While it is off, every call is a local refusal with code `connect_off`.

## What is already here

- `src/components/connect/ConnectButton.tsx`: the sign-in and connect button
  (wraps `ConnectButton` from `@withone/connect/react`).
- `server/one/connect.ts`: `/api/one/authorize`, `/api/one/callback`,
  `/api/one/me`, `/api/one/health`. Do not edit.
- `server/one/index.ts`: `one(c).run(action, input)` and `requireUser(c)`.
- `server/one/actions.gen.ts`: typed wrappers generated from One's catalog.
  Generated; never edit.
- `src/components/connect/Receipt.tsx`: the line to show for a refused call.

## Adding a platform call

1. Find the action: `one_find_actions gmail "list my latest emails"`.
2. Add it: `one_add_action <actionId>`. This writes the wrapper (for example
   `gmail.listAndViewEmailThreads`) and returns its TypeScript input type
   and the action's docs: required fields, the body, query and path
   parameters, the response.
3. Call it from an API route, after `requireUser(c)`:

```ts
const r = await one(c).run(gmail.listAndViewEmailThreads, { body: { numberOfThreads: 10 } });
```

Input keeps the action's split: `{ body?, query?, pathParams?, headers? }`.
Do not set auth headers; One adds them.

## Results and refusals

```ts
type RunResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; refusal?: { source: "one" | "sample" | "local" | "held"; code: string; message?: string } };
```

- `source: "one"` with status 403: outside what the user granted. Show the
  receipt (`Gmail · delete   declined, 403`) and do not retry. `"sample"` is
  the same answer from the keyless sample One (labeled Sample).
- `source: "local"`: stopped before it reached One (the call is not in this
  app's manifest, One Connect is off, the platform is not in the person's
  grant, or nobody signed in).
- `source: "held"`: writes pause while the app is being changed.
- 402 is a plan limit, 429 a rate limit, 5xx a One error: retry later. None of
  them mean a missing permission.

## The manifest

The actions this app asks users to grant are read from the code: every
literal wrapper passed to `one(c).run`. So the consent asks for exactly what
the code calls. Never build an action id at runtime, never pass a raw id
string, never call a provider URL or SDK directly. Those break the manifest
and are reported as errors.

## Rules

- No secrets in code, `.env` or prompts. Never ask the user for one.
- Never show a raw error message or URL text to users; log it.
