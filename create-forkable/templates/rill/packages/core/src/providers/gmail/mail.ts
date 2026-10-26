import type { VipSuggestion } from "../../api-types.js";
import type { Ctx, MailProvider } from "../../contract.js";
import { fixtures } from "../../fixtures.js";
import { DELETE_ACTION_ID, one } from "../../one.js";
import type { ThreadRecord } from "../../types.js";
import { htmlOf, mailFromRaw, threadFromGetThreads, threadFromRaw, type GetThreadsResponse, type RawMessage } from "./mappers.js";

// The Gmail MailProvider: every call goes through one.call, so a sample
// mailbox replays fixtures, a Connect mailbox runs inside the grant. Action
// ids are the One catalog's (docs/CONTRACT.md, verified 2026-10-21).

export const GMAIL_ACTIONS = {
  getThreads: { id: "conn_mod_def::GGSNlnppgZ0::qk3CudDWTVKPY7hpPVCqLQ", method: "POST", path: "/v1/gmail/get-threads" },
  getThread: { id: "conn_mod_def::GJ3ok0Eq0R8::AAzgZVLqTg2iBuITKpJLZg", method: "GET", path: "/gmail/v1/users/{{userId}}/threads/{{id}}" },
  listLabels: { id: "conn_mod_def::GJ3obtut_gA::L4R17Zu8QL-awsrk5_4b8w", method: "GET", path: "/gmail/v1/users/{{userId}}/labels" },
  createLabel: { id: "conn_mod_def::GJ3obSDbZXA::SU-y_lLPQwWPvwvrPRPbEg", method: "POST", path: "/gmail/v1/users/{{userId}}/labels" },
  modifyThreadLabels: { id: "conn_mod_def::GJ3olIfJ9E0::xBAV1bF_RXG94_j4bmye2A", method: "POST", path: "/gmail/v1/users/{{userId}}/threads/{{id}}/modify" },
  createDraft: { id: "conn_mod_def::GGZUe0SIuk8::nhwEKp2cQ6uARsH3513VeQ", method: "POST", path: "/v1/gmail/create-draft" },
  sendEmail: { id: "conn_mod_def::GGXAjWkZO8U::uMc1LQIHTTKzeMm3rLL5gQ", method: "POST", path: "/v1/gmail/send-email" },
  deleteMessage: { id: DELETE_ACTION_ID, method: "DELETE", path: "/gmail/v1/users/{{userId}}/messages/{{id}}" },
  getProfile: { id: "conn_mod_def::GJ3oa8bJZNA::ZS9kXmE_Rzi4utfESor_ng", method: "GET", path: "/gmail/v1/users/{{userId}}/profile" },
  history: { id: "conn_mod_def::GJ3obKaXB1U::JWUEs9nESz2__4shMOpyIg", method: "GET", path: "/gmail/v1/users/{{userId}}/history" },
} as const;

export const LANE_LABEL_PREFIX = "Rill/";

const meOf = (ctx: Ctx) => (ctx.mailbox.address ?? "").toLowerCase();
const isSample = (ctx: Ctx) => ctx.mailbox.source === "sample";
const sampleThreads = (ctx: Ctx) => fixtures.threadRecords(fixtures.loadInbox(ctx.env.ROOT));

/** Label name -> id, per mailbox, for the life of the process. */
const labelCache = new Map<string, Map<string, string>>();
function labelsFor(mailboxId: string): Map<string, string> {
  let m = labelCache.get(mailboxId);
  if (!m) {
    m = new Map();
    labelCache.set(mailboxId, m);
  }
  return m;
}

const userId = { userId: "me" };

export const gmailMail: MailProvider = {
  platform: "gmail",
  verified: true,

  async address(ctx) {
    return one.call<{ emailAddress?: string }, string | null>(ctx, {
      platform: "gmail",
      action: "get-profile",
      level: "read",
      actionId: GMAIL_ACTIONS.getProfile.id,
      method: GMAIL_ACTIONS.getProfile.method,
      path: GMAIL_ACTIONS.getProfile.path,
      pathParams: userId,
      summary: "Read the Gmail address",
      fixture: () => ctx.mailbox.address,
      pick: (d) => d?.emailAddress?.trim().toLowerCase() || null,
    });
  },

  async listThreads(ctx, opts) {
    const me = meOf(ctx);
    const max = Math.max(1, Math.min(100, opts.max));
    const body: Record<string, unknown> = { numberOfThreads: max, format: "full", maxBodyLength: 20000 };
    if (opts.label) body.label = opts.label;
    if (opts.query) body.query = opts.query;
    if (opts.pageToken) body.pageToken = opts.pageToken;
    return one.call<GetThreadsResponse, { threads: ThreadRecord[]; nextPageToken?: string }>(ctx, {
      platform: "gmail",
      action: "get-threads",
      level: "read",
      actionId: GMAIL_ACTIONS.getThreads.id,
      method: GMAIL_ACTIONS.getThreads.method,
      path: GMAIL_ACTIONS.getThreads.path,
      body,
      summary: opts.label ? `Read ${opts.label.toLowerCase()} threads` : `Search inbox: ${opts.query ?? "newest"}`,
      fixture: () => ({ threads: sampleThreads(ctx).slice(0, max) }),
      pick: (d) => ({
        threads: (d?.threads ?? []).map((t) => threadFromGetThreads(t, me)).filter((t): t is ThreadRecord => t !== null),
        nextPageToken: d?.nextPageToken,
      }),
    });
  },

  async threadHtml(ctx, gmailThreadId) {
    return one.call<{ messages?: RawMessage[] }, Record<string, string>>(ctx, {
      platform: "gmail",
      action: "get-thread",
      level: "read",
      actionId: GMAIL_ACTIONS.getThread.id,
      method: GMAIL_ACTIONS.getThread.method,
      path: GMAIL_ACTIONS.getThread.path,
      pathParams: { ...userId, id: gmailThreadId },
      query: { format: "full" },
      summary: `Read thread ${gmailThreadId} for display`,
      fixture: () => {
        const out: Record<string, string> = {};
        const t = sampleThreads(ctx).find((x) => x.id === gmailThreadId);
        for (const m of t?.messages ?? []) if (m.rawBody && /^\s*</.test(m.rawBody)) out[m.id] = m.rawBody;
        return out;
      },
      pick: (d) => {
        const out: Record<string, string> = {};
        for (const m of d?.messages ?? []) {
          const h = htmlOf(m.payload);
          if (m.id && h) out[m.id] = h;
        }
        return out;
      },
    });
  },

  async getThread(ctx, gmailThreadId) {
    const me = meOf(ctx);
    return one.call<{ id?: string; messages?: RawMessage[] }, ThreadRecord | null>(ctx, {
      platform: "gmail",
      action: "get-thread",
      level: "read",
      actionId: GMAIL_ACTIONS.getThread.id,
      method: GMAIL_ACTIONS.getThread.method,
      path: GMAIL_ACTIONS.getThread.path,
      pathParams: { ...userId, id: gmailThreadId },
      query: { format: "full" },
      summary: `Read thread ${gmailThreadId}`,
      fixture: () => sampleThreads(ctx).find((t) => t.id === gmailThreadId) ?? null,
      pick: (d) => threadFromRaw(d, me),
    });
  },

  async ensureLabel(ctx, name) {
    const cache = labelsFor(ctx.mailbox.id);
    const hit = cache.get(name);
    if (hit) return hit;
    if (cache.size === 0) {
      const existing = await one.call<{ labels?: { id?: string; name?: string }[] }, { id: string; name: string }[]>(ctx, {
        platform: "gmail",
        action: "list-labels",
        level: "read",
        actionId: GMAIL_ACTIONS.listLabels.id,
        method: GMAIL_ACTIONS.listLabels.method,
        path: GMAIL_ACTIONS.listLabels.path,
        pathParams: userId,
        summary: "List labels",
        fixture: () => [],
        pick: (d) => (d?.labels ?? []).filter((l) => l.id && l.name).map((l) => ({ id: l.id!, name: l.name! })),
      });
      for (const l of existing) cache.set(l.name, l.id);
      const found = cache.get(name);
      if (found) return found;
    }
    const id = await one.call<{ id?: string }, string>(ctx, {
      platform: "gmail",
      action: "create-label",
      level: "write",
      actionId: GMAIL_ACTIONS.createLabel.id,
      method: GMAIL_ACTIONS.createLabel.method,
      path: GMAIL_ACTIONS.createLabel.path,
      pathParams: userId,
      body: { name, labelListVisibility: "labelShow", messageListVisibility: "show" },
      summary: `Create label ${name}`,
      fixture: () => `label-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      pick: (d) => {
        if (!d?.id) throw new Error(`Gmail returned no id for label "${name}"`);
        return d.id;
      },
    });
    cache.set(name, id);
    return id;
  },

  async modifyThreadLabels(ctx, gmailThreadId, add, remove) {
    await one.call<unknown, void>(ctx, {
      platform: "gmail",
      action: "modify-thread-labels",
      level: "write",
      actionId: GMAIL_ACTIONS.modifyThreadLabels.id,
      method: GMAIL_ACTIONS.modifyThreadLabels.method,
      path: GMAIL_ACTIONS.modifyThreadLabels.path,
      pathParams: { ...userId, id: gmailThreadId },
      body: { addLabelIds: add, removeLabelIds: remove },
      summary: `Label thread ${gmailThreadId}`,
      fixture: () => undefined,
      pick: () => undefined,
    });
  },

  async createDraft(ctx, d) {
    return one.call<{ id?: string; draftId?: string; draft?: { id?: string } }, { gmailDraftId: string }>(ctx, {
      platform: "gmail",
      action: "create-draft",
      level: "write",
      actionId: GMAIL_ACTIONS.createDraft.id,
      method: GMAIL_ACTIONS.createDraft.method,
      path: GMAIL_ACTIONS.createDraft.path,
      body: {
        to: d.to.join(", "),
        subject: d.subject,
        body: d.body,
        ...(d.threadId ? { threadId: d.threadId } : {}),
        ...(d.inReplyTo ? { inReplyTo: d.inReplyTo, references: d.inReplyTo } : {}),
      },
      summary: `Save draft to ${d.to[0] ?? "recipient"}`,
      fixture: () => ({ gmailDraftId: `draft-${d.threadId ?? "new"}` }),
      pick: (r) => ({ gmailDraftId: r?.id ?? r?.draftId ?? r?.draft?.id ?? "created" }),
    });
  },

  async send(ctx, d) {
    return one.call<{ id?: string; messageId?: string; message?: { id?: string } }, { messageId: string }>(ctx, {
      platform: "gmail",
      action: "send-email",
      level: "write",
      actionId: GMAIL_ACTIONS.sendEmail.id,
      method: GMAIL_ACTIONS.sendEmail.method,
      path: GMAIL_ACTIONS.sendEmail.path,
      body: {
        to: d.to.join(", "),
        subject: d.subject,
        body: d.body,
        ...(d.threadId ? { threadId: d.threadId } : {}),
        ...(d.inReplyTo ? { inReplyTo: d.inReplyTo, references: d.inReplyTo } : {}),
      },
      summary: `Send reply to ${d.to[0] ?? "recipient"}`,
      fixture: () => ({ messageId: `sent-${d.threadId ?? "new"}` }),
      pick: (r) => ({ messageId: r?.id ?? r?.messageId ?? r?.message?.id ?? "sent" }),
    });
  },

  async attemptDelete(ctx, gmailMessageId, note) {
    const { row } = await one.attempt<unknown>(ctx, {
      platform: "gmail",
      action: "delete-message",
      level: "write",
      actionId: GMAIL_ACTIONS.deleteMessage.id,
      method: GMAIL_ACTIONS.deleteMessage.method,
      path: GMAIL_ACTIONS.deleteMessage.path,
      pathParams: { ...userId, id: gmailMessageId },
      summary: note,
      fixture: () => null,
    });
    return row;
  },

  async sentTo(ctx, max) {
    const me = meOf(ctx);
    let threads: ThreadRecord[];
    if (isSample(ctx)) {
      threads = sampleThreads(ctx).filter((t) => t.messages.some((m) => m.isFromMe));
    } else {
      const res = await one.call<GetThreadsResponse, ThreadRecord[]>(ctx, {
        platform: "gmail",
        action: "get-threads",
        level: "read",
        actionId: GMAIL_ACTIONS.getThreads.id,
        method: GMAIL_ACTIONS.getThreads.method,
        path: GMAIL_ACTIONS.getThreads.path,
        body: { label: "SENT", numberOfThreads: Math.max(1, Math.min(100, max)), format: "full", maxBodyLength: 200 },
        summary: "Read sent mail for VIP suggestions",
        fixture: () => [],
        pick: (d) => (d?.threads ?? []).map((t) => threadFromGetThreads(t, me)).filter((t): t is ThreadRecord => t !== null),
      });
      threads = res;
    }
    const counts = new Map<string, { name: string; count: number }>();
    for (const t of threads) {
      for (const m of t.messages) {
        if (!m.isFromMe) continue;
        for (const e of [...m.to, ...m.cc]) {
          if (!e || e === me) continue;
          const name = t.participants.find((p) => p.email === e)?.name || e.split("@")[0]!;
          const cur = counts.get(e) ?? { name, count: 0 };
          cur.count += 1;
          if (!cur.name && name) cur.name = name;
          counts.set(e, cur);
        }
      }
    }
    const out: VipSuggestion[] = [...counts.entries()]
      .filter(([e]) => !/no-?reply|notifications?@|calendar-notification/i.test(e))
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, Math.max(1, max))
      .map(([email, v]) => ({
        name: v.name,
        email,
        sentCount: v.count,
        reason: v.count === 1 ? "You wrote to them once" : `You wrote to them ${v.count} times`,
      }));
    return out;
  },
};
