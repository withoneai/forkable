import type { VipSuggestion } from "../../api-types.js";
import type { Ctx, MailProvider } from "../../contract.js";
import { one } from "../../one.js";
import type { ThreadRecord } from "../../types.js";
import { OUTLOOK_SYNTHETIC_LABELS, graphQuery, skipOf, threadFromGraph, threadsFromGraph, type GraphMessage, type GraphMessageList } from "./mailMappers.js";

// The Outlook Mail MailProvider (Microsoft Graph, through One's `outlook-mail`
// platform). Every action id below was read from the One catalog with
// `one --agent actions find/load outlook-mail ...` on 2026-10-23 and matches
// its documented method and path. Fixture-verified only
// (packages/core/scripts/smoke-outlook.ts); no real grant has run it yet.
//
// Where Graph differs from Gmail, on purpose:
// - A thread is a conversation: `providerThreadId` IS Graph's conversationId,
//   and there is no thread resource, so a thread is read as the messages that
//   share it.
// - No labels: lanes ride as Outlook categories, flat strings on each message.
//   ensureLabel is the identity, and a PATCH replaces the whole categories
//   array, so modifyThreadLabels reads what is there before writing.
// - The verb actions (createReply, reply, send) take PascalCase parameters
//   (`Comment`), exactly as the catalog documents them.

export const OUTLOOK_MAIL_ACTIONS = {
  getProfile: { id: "conn_mod_def::GMIYxNZ51eU::xY4rcCXiTTyrarjC9ac97w", method: "GET", path: "/v1.0/me" },
  listMessages: { id: "conn_mod_def::GMIYwcOQ0W0::zXQUrHvhTy-rXQG3h50Paw", method: "GET", path: "/v1.0/me/messages" },
  listFolderMessages: { id: "conn_mod_def::GMIYwcTo-HI::GT_NIVtaThKotZiBeiCasw", method: "GET", path: "/v1.0/me/mailFolders/{{mailFolderId}}/messages" },
  updateMessage: { id: "conn_mod_def::GMIYzPogSbc::Y193gU4vTjGvD4AHVZ1n7A", method: "PATCH", path: "/v1.0/me/messages/{{messageId}}" },
  createMessage: { id: "conn_mod_def::GMIYvMTGW44::v0l2HirsSfy0SUTNwcsCAw", method: "POST", path: "/v1.0/me/messages" },
  createReply: { id: "conn_mod_def::GMIYxdg2AH8::ZxbBRaXcQsGVvtiWQl5pFg", method: "POST", path: "/v1.0/me/messages/{{messageId}}/microsoft.graph.createReply" },
  reply: { id: "conn_mod_def::GMIYyGDPmeM::46r7Kmr7RnuPgS8FJJjqpA", method: "POST", path: "/v1.0/me/messages/{{messageId}}/microsoft.graph.reply" },
  sendDraft: { id: "conn_mod_def::GMIYyRYRR_M::DICn4DLuT_OjefG-EBoBZQ", method: "POST", path: "/v1.0/me/messages/{{messageId}}/microsoft.graph.send" },
  deleteMessage: { id: "conn_mod_def::GMIYvl8Sywk::YzE-MOO4TeeYwXkMGPVuKQ", method: "DELETE", path: "/v1.0/me/messages/{{messageId}}" },
} as const;

const A = OUTLOOK_MAIL_ACTIONS;
const meOf = (ctx: Ctx) => (ctx.mailbox.address ?? "").toLowerCase();
const recipients = (emails: string[]) => emails.map((address) => ({ emailAddress: { address } }));

/**
 * The Graph id of the message a reply answers. The caller passes it when it
 * has it; otherwise the conversation is read and the message is found by its
 * RFC Message-ID, falling back to the newest one not from you.
 */
async function replyTarget(ctx: Ctx, d: { threadId?: string; inReplyTo?: string; replyToMessageId?: string }): Promise<string | null> {
  if (d.replyToMessageId) return d.replyToMessageId;
  if (!d.threadId) return null;
  const t = await outlookMail.getThread(ctx, d.threadId);
  const msgs = t?.messages ?? [];
  return (d.inReplyTo ? msgs.find((m) => m.messageIdHeader === d.inReplyTo) : undefined)?.id
    ?? [...msgs].reverse().find((m) => !m.isFromMe)?.id
    ?? null;
}

export const outlookMail: MailProvider = {
  platform: "outlook-mail",
  verified: false,

  async address(ctx) {
    return one.call<{ mail?: string | null; userPrincipalName?: string | null }, string | null>(ctx, {
      platform: "outlook-mail",
      action: "get-profile",
      level: "read",
      actionId: A.getProfile.id,
      method: A.getProfile.method,
      path: A.getProfile.path,
      query: { $select: "id,userPrincipalName,mail,displayName" },
      summary: "Read the Outlook address",
      fixture: () => ctx.mailbox.address,
      // The catalog: prefer `mail`, fall back to `userPrincipalName` when `mail` is null.
      pick: (d) => (d?.mail ?? d?.userPrincipalName)?.trim().toLowerCase() || null,
    });
  },

  async listThreads(ctx, opts) {
    const me = meOf(ctx);
    const top = Math.max(1, Math.min(100, opts.max));
    const q = graphQuery(opts.query);
    const query: Record<string, string> = { $top: String(top) };
    if (q.filter) { query.$filter = q.filter; query.$orderby = "receivedDateTime desc"; }
    if (q.search) query.$search = q.search;
    if (opts.pageToken) query.$skip = opts.pageToken;
    return one.call<GraphMessageList, { threads: ThreadRecord[]; nextPageToken?: string }>(ctx, {
      platform: "outlook-mail",
      action: "list-messages",
      level: "read",
      actionId: A.listMessages.id,
      method: A.listMessages.method,
      path: A.listMessages.path,
      query,
      summary: `Search Outlook: ${opts.query ?? "newest"}`,
      fixture: () => ({ threads: [] }),
      pick: (d) => ({ threads: threadsFromGraph(d?.value ?? [], me), nextPageToken: skipOf(d?.["@odata.nextLink"]) }),
    });
  },

  async getThread(ctx, conversationId) {
    const me = meOf(ctx);
    return one.call<GraphMessageList, ThreadRecord | null>(ctx, {
      platform: "outlook-mail",
      action: "list-messages",
      level: "read",
      actionId: A.listMessages.id,
      method: A.listMessages.method,
      path: A.listMessages.path,
      query: { $filter: `conversationId eq '${conversationId.replace(/'/g, "''")}'`, $top: "50" },
      summary: `Read conversation ${conversationId}`,
      fixture: () => null,
      pick: (d) => threadFromGraph(d?.value ?? [], conversationId, me),
    });
  },

  async threadHtml(ctx, conversationId) {
    const thread = await outlookMail.getThread(ctx, conversationId);
    const out: Record<string, string> = {};
    for (const m of thread?.messages ?? []) if (m.rawBody && /^\s*</.test(m.rawBody)) out[m.id] = m.rawBody;
    return out;
  },

  async ensureLabel(_ctx, name) {
    return name;
  },

  async modifyThreadLabels(ctx, conversationId, add, remove) {
    const thread = await outlookMail.getThread(ctx, conversationId);
    for (const m of thread?.messages ?? []) {
      const current = m.labelIds.filter((l) => !OUTLOOK_SYNTHETIC_LABELS.has(l));
      const next = [...new Set([...current.filter((c) => !remove.includes(c)), ...add])];
      if (next.length === current.length && next.every((c) => current.includes(c))) continue;
      await one.call<unknown, void>(ctx, {
        platform: "outlook-mail",
        action: "update-message",
        level: "write",
        actionId: A.updateMessage.id,
        method: A.updateMessage.method,
        path: A.updateMessage.path,
        pathParams: { messageId: m.id },
        body: { categories: next },
        summary: `Categorize message ${m.id}: ${add.join(", ")}`,
        fixture: () => undefined,
        pick: () => undefined,
      });
    }
  },

  async createDraft(ctx, d) {
    const target = d.threadId || d.inReplyTo || d.replyToMessageId ? await replyTarget(ctx, d) : null;
    if (target) {
      return one.call<GraphMessage, { gmailDraftId: string }>(ctx, {
        platform: "outlook-mail",
        action: "create-reply",
        level: "write",
        actionId: A.createReply.id,
        method: A.createReply.method,
        path: A.createReply.path,
        pathParams: { messageId: target },
        body: { Comment: d.body },
        summary: `Save draft to ${d.to[0] ?? "recipient"}`,
        fixture: () => ({ gmailDraftId: `draft-${d.threadId ?? "new"}` }),
        pick: (r) => ({ gmailDraftId: r?.id ?? "created" }),
      });
    }
    return one.call<GraphMessage, { gmailDraftId: string }>(ctx, {
      platform: "outlook-mail",
      action: "create-message",
      level: "write",
      actionId: A.createMessage.id,
      method: A.createMessage.method,
      path: A.createMessage.path,
      body: { subject: d.subject, body: { contentType: "text", content: d.body }, toRecipients: recipients(d.to) },
      summary: `Save draft to ${d.to[0] ?? "recipient"}`,
      fixture: () => ({ gmailDraftId: "draft-new" }),
      pick: (r) => ({ gmailDraftId: r?.id ?? "created" }),
    });
  },

  async send(ctx, d) {
    const target = d.threadId || d.inReplyTo || d.replyToMessageId ? await replyTarget(ctx, d) : null;
    if (target) {
      // Graph's reply sends in one step and files it in Sent Items, the way Gmail's send-email does.
      await one.call<unknown, void>(ctx, {
        platform: "outlook-mail",
        action: "reply",
        level: "write",
        actionId: A.reply.id,
        method: A.reply.method,
        path: A.reply.path,
        pathParams: { messageId: target },
        body: { Comment: d.body },
        summary: `Send reply to ${d.to[0] ?? "recipient"}`,
        fixture: () => undefined,
        pick: () => undefined,
      });
      return { messageId: `sent-${target}` };
    }
    // A fresh message has no one-step send in the grant's action set: make the draft, then send it.
    const { gmailDraftId } = await outlookMail.createDraft(ctx, { to: d.to, subject: d.subject, body: d.body });
    await one.call<unknown, void>(ctx, {
      platform: "outlook-mail",
      action: "send-draft",
      level: "write",
      actionId: A.sendDraft.id,
      method: A.sendDraft.method,
      path: A.sendDraft.path,
      pathParams: { messageId: gmailDraftId },
      summary: `Send to ${d.to[0] ?? "recipient"}`,
      fixture: () => undefined,
      pick: () => undefined,
    });
    return { messageId: gmailDraftId };
  },

  async attemptDelete(ctx, providerMessageId, note) {
    const { row } = await one.attempt<unknown>(ctx, {
      platform: "outlook-mail",
      action: "delete-message",
      level: "write",
      actionId: A.deleteMessage.id,
      method: A.deleteMessage.method,
      path: A.deleteMessage.path,
      pathParams: { messageId: providerMessageId },
      summary: note,
      fixture: () => null,
    });
    return row;
  },

  async sentTo(ctx, max) {
    const me = meOf(ctx);
    if (ctx.mailbox.source === "sample") return [];
    const threads = await one.call<GraphMessageList, ThreadRecord[]>(ctx, {
      platform: "outlook-mail",
      action: "list-folder-messages",
      level: "read",
      actionId: A.listFolderMessages.id,
      method: A.listFolderMessages.method,
      path: A.listFolderMessages.path,
      // "sentitems" is Graph's well-known folder name, the way "inbox" is in the catalog's examples.
      pathParams: { mailFolderId: "sentitems" },
      query: { $top: String(Math.max(1, Math.min(100, max))), $orderby: "sentDateTime desc" },
      summary: "Read sent mail for VIP suggestions",
      fixture: () => [],
      pick: (d) => threadsFromGraph(d?.value ?? [], me),
    });
    const counts = new Map<string, { name: string; count: number }>();
    for (const t of threads) {
      for (const m of t.messages) {
        if (!m.isFromMe) continue;
        for (const e of [...m.to, ...m.cc]) {
          if (!e || e === me) continue;
          const cur = counts.get(e) ?? { name: t.participants.find((p) => p.email === e)?.name || e.split("@")[0]!, count: 0 };
          cur.count += 1;
          counts.set(e, cur);
        }
      }
    }
    return [...counts.entries()]
      .filter(([e]) => !/no-?reply|notifications?@/i.test(e))
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, Math.max(1, max))
      .map(([email, v]): VipSuggestion => ({ name: v.name, email, sentCount: v.count, reason: v.count === 1 ? "You wrote to them once" : `You wrote to them ${v.count} times` }));
  },
};
