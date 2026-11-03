# __PROJECT_NAME__

House rules for every coding agent working on this app. __BRAND_NAME__ runs the
preview, the installs and the commits; you write the code.

## 1. The stack and where things go

- Vite + React 19 + TypeScript + Tailwind v4. Hono API on Cloudflare Workers
  through the Cloudflare Vite plugin: one dev server, the UI and `/api` on one
  origin. D1 (SQLite) with Drizzle. TanStack Query, React Router 7, Lucide icons.
- `src/App.tsx` is the home page (`/`). Other pages go in `src/routes/`, are
  listed in the router in `src/main.tsx` and linked in `src/lib/nav.ts`.
- API routes go in `server/app.ts` (or files it imports from `server/`).
  Fetch them from the UI with `api()` from `src/lib/api.ts` inside TanStack
  Query hooks.
- Tables go in `server/db/schema.ts` (drizzle `sqlite-core`). Get the client
  with `db(c)` from `server/db/client.ts`. Only edit the schema: after your
  turn __BRAND_NAME__ generates the migration and applies it to the local
  database. Do not write migration files by hand or run `pnpm db:generate`.
- The API runs in the Workers runtime. Prefer web-standard APIs (`fetch`,
  `crypto.subtle`, `URL`). Safe libraries: hono, drizzle-orm, zod, date-fns,
  nanoid. Avoid packages that need native Node modules, the filesystem or
  child processes.
- The same app also publishes to Vercel, where `db(c)` is libSQL instead of
  D1 (same schema, same queries). So use the Drizzle query builder through
  `db(c)` only, never a driver import of your own. `api/index.ts` and
  `tools/build-vercel.mjs` are that path; leave them as they are.
- Routes that read or write a user's data start with `await requireUser(c)`.
  The publish checks warn about any route that touches `db(c)` without it.
  In preview, until One Connect is set up, `requireUser(c)` returns a local
  "You (preview)" user so the app works at once; never build a guest mode
  or skip `requireUser(c)` to get around sign-in.
- Each person's records belong to them. Give every user-owned table a
  `userId` column, set it from `requireUser(c)` on insert, and filter every
  list, read, update and delete by it, so a second person never sees or
  changes the first person's rows (a wrong id answers 404):

```ts
const user = await requireUser(c);
const rows = await db(c).select().from(notes).where(eq(notes.userId, user.id)).orderBy(desc(notes.updatedAt));
await db(c).update(notes).set(patch).where(and(eq(notes.id, id), eq(notes.userId, user.id)));
```

  Data the whole team shares on purpose (a public board, submissions an
  admin reads) is the exception; say so in a comment on the table.

## 2. Things the platform does, never you

- Never start a dev server (`pnpm dev`, `vite`, `wrangler dev`). The preview
  is already running and reloads on save.
- Never install packages by command. Add a package with
  `project_add_dependency`, or add it to `package.json` and the platform
  installs it.
- Never run wrangler, never commit, never touch git history or remotes.
  Every turn becomes a checkpoint on its own.

## 3. Calling platforms (Gmail, Slack, Stripe, ...)

This app reaches other tools through One. Users sign in with One and grant
the app scoped access to their own accounts; every call runs on that grant.
The app has its own Connect app (One Connect, in the project's Settings), so
in preview the calls run on the builder's own sign-in to this app, and One's
real `declined, 403` shows up here exactly as it will for users. The app
never holds a key.

The steps, every time:

1. `one_find_actions <platform> "<what the feature does>"`, for example
   `one_find_actions gmail "list my latest email threads"`. It answers with
   real action ids from One's catalog, best first, and a digest of the top
   pick. Never guess an id or a field name; `one_platforms` lists slugs.
2. `one_add_action <actionId>`. It writes the typed wrapper into
   `server/one/actions.gen.ts` and answers with the wrapper's name (for
   example `gmail.listAndViewEmailThreads`), its TypeScript input type and
   the action's docs. Read them: required fields, which part is `body`,
   `query` or `pathParams`, and the response shape. `one_load_action <id>
   [section]` reads more.
3. Call the wrapper from an API route with `one(c).run(...)`, after
   `requireUser(c)`:

```ts
import { one, refusedByGrant, requireUser } from "./one";
import { gmail } from "./one/actions.gen";

app.get("/api/threads", async (c) => {
  await requireUser(c);
  const r = await one(c).run(gmail.listAndViewEmailThreads, { body: { numberOfThreads: 10, label: "INBOX" } });
  if (!r.ok) return c.json(r, r.status as 403);
  return c.json({ threads: r.data.threads ?? [] });
});
```

4. `one_scope_preview` shows what the app now asks users to grant.

When the request names a resource in the other tool (the Support database
in Notion, the #team channel in Slack), find it by that name at run time
with the platform's own search or list action, and remember what you found
in the app's database. Do not add a settings screen or ask the builder to
paste an id for it; a picker is only a fallback when the name finds nothing.

Rules:

- The first argument to `one(c).run` is always an imported wrapper (or an
  inline `{ platform: "gmail", actionId: "conn_mod_def::..." }` literal).
  Never build an action id at runtime and never pass a raw id string
  around: the manifest (what consent asks for) is read from these call
  sites, and anything dynamic is a `BLD001` to `BLD003` error.
- Never edit `actions.gen.ts`. Never call a provider SDK (`googleapis`,
  `stripe`, `@slack/web-api`, ...) or a provider URL directly (`BLD004`).
  Never put a key in code or in `.env`, and never ask anyone for one.
- Do not pass a connection key or auth headers. One adds them.
- `one(c).run` calls belong in `server/`, never in `src/` (the browser).
  The UI fetches your own API route.
- One Connect is per app and off until the builder turns it on in the
  project's Settings. While it is off the app has no One login and every
  `one(c).run` returns a local refusal with code `connect_off`. Keep
  building: when your turn ends the builder gets a card ("This app uses
  Gmail. Turn on One Connect for it?"). `one_granted` says whether it is on.
  Never ask for a client id, secret or connect key: the builder adds them in
  a secure screen, and they never reach you.
- The One CLI belongs to the builder. `one`, `curl` and `npx @withone/*` are
  refused here, and nothing you run executes a platform action. The one_*
  tools read the same catalog through the builder's CLI.

## 4. Handle the run result

`r` is `{ ok: true, status, data }` or `{ ok: false, status, refusal?, data? }`.

- `refusal.source === "one"` (or `"sample"` on the keyless sample grant):
  the user's grant does not allow this call. One answered 403 and the
  provider was never called. `refusedByGrant(r)` checks both. Show
  `<Receipt platform="Gmail" verb="send" refusal={r.refusal} />` from
  `src/components/connect/Receipt.tsx` and do not retry.
- `"local"`: stopped before it reached One. The call is not in this app's
  manifest, One Connect is off (`connect_off`), the platform is not in the
  person's grant yet, or nobody signed in. Show a short note with the next
  step.
- `"held"`: writes pause while the app is being changed. Show a short note.
- No refusal and `ok: false`: the provider's own answer (a 404, a 400).
  Handle it like any API error. Never treat a 402, 429 or 5xx as a missing
  permission.

## 5. Users, and public pages

Users sign in with One (`ConnectButton` from `src/components/connect`). Every
API route that calls `one(c).run` starts with `await requireUser(c)`.

A page anyone can use without signing in (a contact or support form, a
signup list) uses `PublicShell` and still reaches platforms, on the app owner's grant:
`one(c, { as: "owner" }).run(...)`. Do exactly what the request asks on
submit (create the Notion page, post the Slack alert); do not move it behind
a staff step. Rules for those routes:

- Only the public write itself runs as the owner. Anything that reads data
  back (an admin list, a search) is signed in: `requireUser(c)` and
  `one(c).run`.
- Validate and cap every field the visitor sends before it goes anywhere.
- Visitors on the owner's grant are off until the builder allows them, per
  action. You cannot turn it on, and you should not try: it is not in any
  file. Write the `as: "owner"` call the request needs; when your turn ends
  the builder sees a card asking them to allow that action (Allow, or Keep
  sign-in required). Until they allow it the call returns a local refusal
  with code `visitors_off` or `visitor_not_allowed`; handle it like the
  other local refusals. Always end the turn by telling the builder, in one
  or two plain sentences, which action visitors would trigger on their
  grant and why the page needs it (for example: "The public form files
  each request as a Notion page on your account, since visitors have no
  Notion of their own."). Ask for the fewest actions the page needs: a
  lookup (the Support database's id, the #support channel's id) runs on
  the owner's grant the first time a submission needs it and is cached in
  the app's database for every later one. The public page must work from
  the very first visitor: never make it wait for an admin to sign in, open
  a page or press a button first.
- If the builder chose Keep sign-in required, put that action behind
  `requireUser(c)` and `one(c).run` instead, and tell them what changed for
  visitors.
- In preview the owner is whoever signed in to the preview first (the
  builder). Published, it is the account named by `APP_OWNER_EMAIL`, once it
  has signed in with One and granted the app;
  until then the call returns a local refusal with code
  `owner_not_connected`. Show the visitor a plain "Thanks, we got it" when
  your own database saved the request, and keep the forward's outcome for
  the admin view.

## 6. Design

The app should look like a careful product team made it: calm, dense,
consistent, and never stuck. Build every screen from `src/components/ui`
and `src/components/shell`; write a new primitive only when the kit has
nothing close.

The kit: `AppShell` and `PublicShell` (page frames), `PageHeader`,
`Section`, `Toolbar`, `Card`, `List` and `ListItem`, `Table`, `Stat`,
`Badge`, `Button` (with `loading`), `Field` with `Input`, `Select`,
`Textarea` and `Label`, `Dialog`, `ConfirmDialog`, `Dropdown`, `Tabs`,
`EmptyState`, `ErrorState` and `InlineError`, `QueryState`, `Skeleton` and
`SkeletonRows`, `Spinner`, `useToast`. Signed-in only pages wrap in
`SignInGate` (`src/components/connect`). Dates, times and money go through
`src/lib/format.ts` (`formatDate`, `formatTime`, `formatRelative`,
`formatMoney`) so every page shows them the same way. Top bar links live in
`src/lib/nav.ts`.

Rules:

- Type ladder only: page titles `text-xl font-semibold` (PageHeader does
  it), section titles `text-15 font-semibold`, body and rows `text-13`,
  secondary lines `text-xs` or `text-13 text-muted-foreground`, metadata
  and hints `text-11 text-muted-foreground`, big numbers `text-28` (Stat).
  Never `text-[Npx]`, `p-[7px]` or any other bracket value.
- Spacing ladder: `gap-1.5` icon to text, `gap-2` between controls, `p-4`
  inside cards, `gap-3` between cards, `space-y-6` between sections.
  A row's title and its detail sit closer than the row sits to the next.
- Colours only from the tokens (`bg-background`, `bg-card`, `bg-muted`,
  `text-foreground`, `text-muted-foreground`, `border-border`, `text-accent`,
  `text-success-text`, `text-warning-text`, `text-destructive-text`). Never
  `bg-white`, `text-black`, `gray-*`, `slate-*` or a hex value: they break
  dark mode. One accent, used for links and the active state; status colour
  only through `Badge` tones.
- Borders separate things, not shadows. Numbers are `tnum` and right
  aligned in tables.
- Every list or page that loads data has four states: loading (`SkeletonRows`
  in the shape of the content), failed (`ErrorState` with Try again),
  empty (`EmptyState` with the one action that fills it, or Clear filters
  when a search matched nothing) and loaded. `QueryState` does all four.
- Never disable a button without saying why next to it ("Add a title to
  save", "Nothing to post yet, no threads today"). A button that runs a
  request shows `loading` and keeps its label; the result is a toast or an
  inline line, and an error says what to do next.
- Forms: one `Field` per input, label above, hint or error under it,
  `Select` for choices (never a bare `<select>`), validation errors inline
  on the field, not only in a toast. Keep what the person typed when a send
  fails. After a successful send say what happened and offer the next step.
- When a request replaces how something is entered (a Stripe customer
  picker where a typed customer name was), replace the old field and move
  its data over; never leave two fields for one thing.
- Deleting goes through `ConfirmDialog`. A send or post the request asked
  for (post the digest, email the customer, create the page) runs on the
  first click, with no confirm step; show it working (`loading`), then what
  happened ("Posted to #team at 2:05 PM") and keep that on the page. Its
  label names where it goes, platform included ("Post to #team in Slack",
  "Email a reminder from Gmail").
- Something the request asks to show (an item's history, a log, a job's
  applications) has its own way in that says its name: a link, tab or
  button labelled "History", never only inside another action's dialog.
- Pages for staff (admin lists, anything with other people's data) wrap in
  `SignInGate` and their nav item has `signedIn: true`; a public page never
  links to them in its own content. Public pages use `PublicShell`, which
  shows the `signedIn: true` links to signed-in people only, so staff who
  land on a public home page still reach their pages: every staff page
  needs its nav item.
- Every screen works in light and dark (the tokens do it; check both).
- Sample data uses Acme Inc and made-up people. Write copy as plain,
  short sentences.

Patterns (copy and adapt):

```tsx
// A list page.
<AppShell>
  <PageHeader title="Notes" description="What the team knows about each customer."
    actions={<Button onClick={() => setOpen(true)}><Plus /> New note</Button>} />
  <Toolbar className="mb-3">
    <div className="relative w-64">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input className="pl-8" placeholder="Search notes" value={q} onChange={(e) => setQ(e.target.value)} />
    </div>
  </Toolbar>
  <QueryState query={notes} isEmpty={(d) => d.notes.length === 0}
    empty={q ? <EmptyState icon={SearchX} title={`No notes match "${q}"`} action={<Button variant="outline" onClick={() => setQ("")}>Clear search</Button>} />
             : <EmptyState icon={StickyNote} title="No notes yet" description="Notes you add show up here." action={<Button onClick={() => setOpen(true)}>New note</Button>} />}>
    {(d) => (
      <List>
        {d.notes.map((n) => (
          <ListItem key={n.id} title={n.title} meta={n.customer}
            trailing={<><span className="text-11 text-muted-foreground">{formatRelative(n.updatedAt)}</span>
              <Button variant="ghost" size="icon-sm" aria-label={`Edit ${n.title}`} onClick={() => edit(n)}><Pencil /></Button></>} />
        ))}
      </List>
    )}
  </QueryState>
</AppShell>

// A form in a dialog.
<Dialog open={open} onOpenChange={setOpen}>
  <DialogContent>
    <DialogHeader><DialogTitle>New note</DialogTitle></DialogHeader>
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <Field label="Title" error={errors.title}><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="Topic"><Select value={topic} onChange={(e) => setTopic(e.target.value)}>...</Select></Field>
      {save.isError && <InlineError>{errorText(save.error)}</InlineError>}
      <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" loading={save.isPending}>Save note</Button></DialogFooter>
    </form>
  </DialogContent>
</Dialog>

// Numbers above a table.
<div className="mb-6 grid gap-3 sm:grid-cols-3">
  <Stat label="Last 7 days" value={formatMoney(week)} hint={formatCount(weekCount, "charge")} />
</div>

// A status.
const TONE = { pending: "warning", approved: "success", rejected: "danger" } as const;
<Badge tone={TONE[x.status]} dot>{x.status}</Badge>
```

## 7. Seeing errors

`project_errors` lists open errors from the build, types, the browser, the
server and the manifest (`BLD` codes). `pnpm typecheck` checks types. Fix the cause, not the symptom.

## 8. Environment variables

A value the app needs that is not a platform call (a webhook signing secret,
a third-party key One does not cover, `APP_OWNER_EMAIL`) is an environment
variable. Read it in server code as `c.env.NAME` and declare it in
`server/env.ts` `Bindings` as `NAME?: string`. Handle it missing with a
plain message, never a crash.

- You only ever see names and whether each is set (`project_env`). Values
  never reach you, your tools, the prompt or any file in this project.
- Ask for a value by name: `project_env` with `request: [{name, why}]`. The
  builder gets a card with a secure input when your turn ends. In your reply,
  say which name to set and where they get it.
- Never ask the builder to paste a value in chat, and never write one into
  code, `.env`, `.dev.vars` or `wrangler.jsonc`.
- No secrets in browser code: `import.meta.env.VITE_*` ends up in the page.

## 9. The rest of One

The builder has all of One through the One CLI on their computer. The app
itself only ever uses `one(c).run` on each person's grant (sections 3 to 5).
The rest runs on the builder's own One account, outside the app, and you
never run any of it during a build. Know it so you can say when it fits:

- **Actions catalog** (`one_find_actions`, `one_load_action`,
  `one_platforms`): every platform action and its docs. Use before any
  platform call.
- **Connect** (this app's login): Sign in with One and scoped, revocable
  grants per person. Use for anything a signed-in person does with their
  own tools.
- **Flows**: multi-step automations across platforms, file-based
  (`.one/flows/<key>/flow.json`), run with `one flow execute <key>`. Use
  when the request is a job for the builder themselves (every Monday, email
  the overdue invoices) rather than a feature for the app's users. You may
  write the flow file when asked; the builder runs it.
- **Relay webhooks**: One receives a platform's events (a new Stripe
  payment, a GitHub issue) and runs actions when they arrive (`one relay
  create`, `one relay activate`). Use when something must happen on an
  event while nobody has the app open. Say which events and actions in your
  reply; the builder sets it up.
- **Sync**: copies a platform's records to the builder's computer for fast
  local queries (`one sync`). For the builder's own analysis, not app data:
  the app reads live on each person's grant.
- **Memory**: the builder's own store of notes and records (`one mem`).
  Not app storage: the app keeps its data in its own database.
