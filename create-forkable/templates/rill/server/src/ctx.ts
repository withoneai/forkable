import { eq } from "drizzle-orm";
import { schema, type Ctx, type MailboxRow, type SettingsRow, type UserRow } from "@rill/core";
import type { CoreDeps } from "./deps.js";

/** The settings row for a mailbox, created with defaults when missing. */
export async function loadSettings(deps: Pick<CoreDeps, "db">, mailboxId: string): Promise<SettingsRow> {
  const [row] = await deps.db.select().from(schema.settings).where(eq(schema.settings.mailboxId, mailboxId)).limit(1);
  if (row) return row;
  await deps.db.insert(schema.settings).values({ mailboxId }).onConflictDoNothing();
  const [created] = await deps.db.select().from(schema.settings).where(eq(schema.settings.mailboxId, mailboxId)).limit(1);
  if (!created) throw new Error("could not create the settings row");
  return created;
}

/** Everything core needs to act for one mailbox; `emit` fans out to the mailbox's SSE streams. */
export async function buildCtx(deps: CoreDeps, mailbox: MailboxRow, user: UserRow, settings?: SettingsRow): Promise<Ctx> {
  const s = settings ?? (await loadSettings(deps, mailbox.id));
  return {
    db: deps.db,
    mailbox,
    user,
    settings: s,
    oneConnect: deps.oneConnect,
    env: deps.env,
    emit: (event) => deps.hub.emit(mailbox.id, event),
  };
}
