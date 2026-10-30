import { toast } from "./toast";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type {
  AllInboxResponse, ApiDraft, ApiGoal, ApiSettings, ApiVip, ComposeInput, CreateEventInput, EventPatchInput, GoalInput, InboxResponse, InboxRow, OfferTimesInput, RsvpAction, ThreadAction, ThreadResponse, VipInput,
} from "@rill/core/api-types";
import type { Lane } from "@rill/core/types";
import { LANES } from "@rill/core/types";
import { api } from "./api";

export const keys = {
  me: ["me"] as const,
  engines: ["engines"] as const,
  inbox: (id: string, lane: Lane) => ["mailbox", id, "inbox", lane] as const,
  inboxAll: (id: string) => ["mailbox", id, "inbox"] as const,
  /** All inboxes: one lane across every live mailbox. Not under "mailbox", so each mailbox's own invalidations also refresh it below. */
  allInbox: (lane: Lane) => ["all-inbox", lane] as const,
  allInboxes: ["all-inbox"] as const,
  thread: (id: string, threadId: string) => ["mailbox", id, "thread", threadId] as const,
  threads: (id: string) => ["mailbox", id, "thread"] as const,
  goals: (id: string) => ["mailbox", id, "goals"] as const,
  vips: (id: string) => ["mailbox", id, "vips"] as const,
  brief: (id: string, date?: string) => ["mailbox", id, "brief", date ?? "today"] as const,
  access: (id: string) => ["mailbox", id, "access"] as const,
  ledger: (id: string) => ["mailbox", id, "ledger"] as const,
  settings: (id: string) => ["mailbox", id, "settings"] as const,
  suggestions: (id: string) => ["mailbox", id, "suggestions"] as const,
  palette: (id: string, q: string) => ["mailbox", id, "palette", q] as const,
  chats: (id: string) => ["mailbox", id, "chats"] as const,
  chat: (id: string, chatId: string) => ["mailbox", id, "chats", chatId] as const,
  calendar: (id: string, from: string, to: string) => ["mailbox", id, "calendar", from, to] as const,
  event: (id: string, eventId: string) => ["mailbox", id, "event", eventId] as const,
};

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: api.me, staleTime: 30_000 });
export const useEngines = () => useQuery({ queryKey: keys.engines, queryFn: api.engines, staleTime: 60_000 });

export const useInbox = (id: string, lane: Lane, enabled = true) =>
  useQuery({ queryKey: keys.inbox(id, lane), queryFn: () => api.inbox(id, lane), enabled, staleTime: 5_000, placeholderData: (prev) => prev });

/** All inboxes. No live stream spans mailboxes, so it polls while open. */
export const useAllInbox = (lane: Lane, enabled = true) =>
  useQuery({ queryKey: keys.allInbox(lane), queryFn: () => api.allInbox(lane), enabled, staleTime: 5_000, refetchInterval: 20_000, placeholderData: (prev) => prev });

/** Sync every live mailbox at once, for the All inboxes refresh button. */
export function useSyncAll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map((id) => api.sync(id))),
    onSettled: (_d, _e, ids) => { for (const id of ids ?? []) invalidateMailbox(qc, id); },
  });
}

export const useThread = (id: string, threadId: string | null) =>
  useQuery({ queryKey: keys.thread(id, threadId ?? ""), queryFn: () => api.thread(id, threadId!), enabled: !!threadId, staleTime: 10_000 });

export const useThreadHtml = (id: string, threadId: string | null) =>
  useQuery({ queryKey: [...keys.thread(id, threadId ?? ""), "html"] as const, queryFn: () => api.threadHtml(id, threadId!), enabled: !!threadId, staleTime: 5 * 60_000 });

export const useGoals = (id: string) => useQuery({ queryKey: keys.goals(id), queryFn: () => api.goals(id) });
export const useVips = (id: string) => useQuery({ queryKey: keys.vips(id), queryFn: () => api.vips(id) });
export const useBrief = (id: string, date?: string) => useQuery({ queryKey: keys.brief(id, date), queryFn: () => api.brief(id, date), staleTime: 60_000 });
export const useAccess = (id: string) => useQuery({ queryKey: keys.access(id), queryFn: () => api.access(id), staleTime: 5_000 });
export const useSettings = (id: string) => useQuery({ queryKey: keys.settings(id), queryFn: () => api.settings(id) });
export const useSuggestions = (id: string) => useQuery({ queryKey: keys.suggestions(id), queryFn: () => api.onboardingSuggestions(id) });
export const useCompose = (id: string) => useMutation({ mutationFn: (input: ComposeInput) => api.compose(id, input) });
export const usePalette = (id: string, q: string, enabled = true) =>
  useQuery({ queryKey: keys.palette(id, q), queryFn: () => api.palette(id, q), enabled, staleTime: 10_000, placeholderData: (prev) => prev });

/** Remove a row from every cached lane and keep counts in step. */
function removeRowEverywhere(qc: QueryClient, id: string, threadId: string) {
  for (const lane of LANES) {
    qc.setQueryData<InboxResponse>(keys.inbox(id, lane), (old) => {
      if (!old) return old;
      const had = old.rows.some((r) => r.threadId === threadId);
      if (!had) return old;
      return {
        ...old,
        rows: old.rows.filter((r) => r.threadId !== threadId),
        counts: { ...old.counts, [lane]: Math.max(0, old.counts[lane] - 1) },
      };
    });
  }
}

function removeRowFromAll(qc: QueryClient, threadId: string) {
  for (const lane of LANES) {
    qc.setQueryData<AllInboxResponse>(keys.allInbox(lane), (old) => {
      if (!old || !old.rows.some((r) => r.threadId === threadId)) return old;
      return { ...old, rows: old.rows.filter((r) => r.threadId !== threadId), counts: { ...old.counts, [lane]: Math.max(0, old.counts[lane] - 1) } };
    });
  }
}

function patchRowEverywhere(qc: QueryClient, id: string, threadId: string, patch: Partial<InboxRow>) {
  for (const lane of LANES) {
    qc.setQueryData<InboxResponse>(keys.inbox(id, lane), (old) => {
      if (!old) return old;
      if (!old.rows.some((r) => r.threadId === threadId)) return old;
      return { ...old, rows: old.rows.map((r) => (r.threadId === threadId ? { ...r, ...patch } : r)) };
    });
    qc.setQueryData<AllInboxResponse>(keys.allInbox(lane), (old) => {
      if (!old || !old.rows.some((r) => r.threadId === threadId)) return old;
      return { ...old, rows: old.rows.map((r) => (r.threadId === threadId ? { ...r, ...patch } : r)) };
    });
  }
  qc.setQueryData<ThreadResponse>(keys.thread(id, threadId), (old) => (old ? { ...old, state: { ...old.state, ...patch } } : old));
}

export function invalidateMailbox(qc: QueryClient, id: string) {
  qc.invalidateQueries({ queryKey: keys.inboxAll(id) });
  qc.invalidateQueries({ queryKey: keys.allInboxes });
  qc.invalidateQueries({ queryKey: keys.threads(id) });
  qc.invalidateQueries({ queryKey: keys.me });
}

/** Thread actions with optimistic cache edits. Rows leave their lane at once. */
export function useThreadAction(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, action }: { threadId: string; action: ThreadAction }) => api.threadAction(id, threadId, action),
    onMutate: async ({ threadId, action }) => {
      await qc.cancelQueries({ queryKey: keys.inboxAll(id) });
      await qc.cancelQueries({ queryKey: keys.allInboxes });
      const snapshot = LANES.map((lane) => [lane, qc.getQueryData<InboxResponse>(keys.inbox(id, lane))] as const);
      switch (action.action) {
        case "done":
        case "snooze":
        case "screen_out":
        case "let_in":
        case "move":
          removeRowFromAll(qc, threadId);
          break;
        default:
          break;
      }
      switch (action.action) {
        case "done":
        case "snooze":
        case "screen_out":
          removeRowEverywhere(qc, id, threadId);
          if (action.action === "snooze") patchRowEverywhere(qc, id, threadId, { snoozedUntil: action.until });
          break;
        case "let_in":
          removeRowEverywhere(qc, id, threadId);
          break;
        case "reply_later":
          patchRowEverywhere(qc, id, threadId, { replyLater: true });
          break;
        case "add_vip":
          patchRowEverywhere(qc, id, threadId, { lane: "vip" });
          break;
        case "move":
          removeRowEverywhere(qc, id, threadId);
          break;
        default:
          break;
      }
      return { snapshot };
    },
    onError: (_e, _v, ctx) => {
      ctx?.snapshot.forEach(([lane, data]) => { if (data) qc.setQueryData(keys.inbox(id, lane), data); });
    },
    onSettled: (_d, _e, vars) => {
      qc.invalidateQueries({ queryKey: keys.inboxAll(id) });
      qc.invalidateQueries({ queryKey: keys.allInboxes });
      qc.invalidateQueries({ queryKey: keys.thread(id, vars.threadId) });
      qc.invalidateQueries({ queryKey: keys.me });
      if (vars.action.action === "add_vip" || vars.action.action === "let_in" || vars.action.action === "screen_out") {
        qc.invalidateQueries({ queryKey: keys.vips(id) });
      }
    },
  });
}

function setThreadDraft(qc: QueryClient, id: string, threadId: string, draft: ApiDraft | null) {
  qc.setQueryData<ThreadResponse>(keys.thread(id, threadId), (old) => (old ? { ...old, draft } : old));
  patchRowEverywhere(qc, id, threadId, { hasDraft: !!draft && draft.status !== "sent" && draft.status !== "discarded" });
}

export function useDraftMutations(id: string, threadId: string) {
  const qc = useQueryClient();
  const write = useMutation({
    mutationFn: (instructions?: string) => api.writeDraft(id, threadId, instructions),
    onSuccess: (d) => setThreadDraft(qc, id, threadId, d),
  });
  const update = useMutation({
    mutationFn: ({ draftId, body }: { draftId: string; body: string }) => api.updateDraft(id, draftId, body),
    onMutate: ({ body }) => {
      qc.setQueryData<ThreadResponse>(keys.thread(id, threadId), (old) =>
        old?.draft ? { ...old, draft: { ...old.draft, body, status: "edited" } } : old);
    },
    onSuccess: (d) => setThreadDraft(qc, id, threadId, d),
  });
  const save = useMutation({
    mutationFn: (draftId: string) => api.saveDraft(id, draftId),
    onSuccess: (d) => { setThreadDraft(qc, id, threadId, d); qc.invalidateQueries({ queryKey: keys.access(id) }); },
  });
  const send = useMutation({
    mutationFn: (draftId: string) => api.sendDraft(id, draftId),
    onSuccess: (d) => {
      setThreadDraft(qc, id, threadId, d);
      removeRowEverywhere(qc, id, threadId);
      qc.invalidateQueries({ queryKey: keys.inboxAll(id) });
      qc.invalidateQueries({ queryKey: keys.access(id) });
      qc.invalidateQueries({ queryKey: keys.me });
    },
  });
  const discard = useMutation({
    mutationFn: (draftId: string) => api.discardDraft(id, draftId),
    onMutate: () => setThreadDraft(qc, id, threadId, null),
    onError: (e) => {
      qc.invalidateQueries({ queryKey: keys.thread(id, threadId) });
      toast({ title: "Draft not discarded", detail: e.message, tone: "destructive" });
    },
  });
  return { write, update, save, send, discard };
}

export function useGoalMutations(id: string) {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: keys.goals(id) });
    qc.invalidateQueries({ queryKey: keys.inboxAll(id) });
    qc.invalidateQueries({ queryKey: keys.me });
  };
  const create = useMutation({ mutationFn: (input: GoalInput) => api.createGoal(id, input), onSuccess: refresh });
  const update = useMutation({
    mutationFn: ({ goalId, patch }: { goalId: string; patch: Partial<GoalInput> }) => api.updateGoal(id, goalId, patch),
    onMutate: ({ goalId, patch }) => {
      qc.setQueryData<ApiGoal[]>(keys.goals(id), (old) => old?.map((g) => (g.id === goalId ? { ...g, ...patch } : g)));
    },
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (goalId: string) => api.deleteGoal(id, goalId),
    onMutate: (goalId) => { qc.setQueryData<ApiGoal[]>(keys.goals(id), (old) => old?.filter((g) => g.id !== goalId)); },
    onSettled: refresh,
  });
  return { create, update, remove };
}

export function useVipMutations(id: string) {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: keys.vips(id) });
    qc.invalidateQueries({ queryKey: keys.inboxAll(id) });
    qc.invalidateQueries({ queryKey: keys.me });
  };
  const create = useMutation({ mutationFn: (input: VipInput) => api.createVip(id, input), onSuccess: refresh });
  const update = useMutation({
    mutationFn: ({ vipId, patch }: { vipId: string; patch: Partial<VipInput> }) => api.updateVip(id, vipId, patch),
    onMutate: ({ vipId, patch }) => {
      qc.setQueryData<ApiVip[]>(keys.vips(id), (old) => old?.map((v) => (v.id === vipId ? { ...v, ...patch } as ApiVip : v)));
    },
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (vipId: string) => api.deleteVip(id, vipId),
    onMutate: (vipId) => { qc.setQueryData<ApiVip[]>(keys.vips(id), (old) => old?.filter((v) => v.id !== vipId)); },
    onSettled: refresh,
  });
  const suggest = useMutation({ mutationFn: () => api.suggestVips(id) });
  return { create, update, remove, suggest };
}

export function useSettingsMutation(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<ApiSettings>) => api.updateSettings(id, patch),
    onMutate: (patch) => {
      qc.setQueryData<ApiSettings>(keys.settings(id), (old) => (old ? { ...old, ...patch } : old));
    },
    onSuccess: (s, patch) => {
      qc.setQueryData(keys.settings(id), s);
      qc.invalidateQueries({ queryKey: keys.engines });
      qc.invalidateQueries({ queryKey: keys.me });
      if (patch.mailCategories) qc.invalidateQueries({ queryKey: keys.inboxAll(id) });
    },
    onError: (e) => {
      qc.invalidateQueries({ queryKey: keys.settings(id) });
      toast({ title: "Setting not saved", detail: e.message, tone: "destructive" });
    },
  });
}

export function useReceiptDemo(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.receiptDemo(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: keys.access(id) }); qc.invalidateQueries({ queryKey: keys.ledger(id) }); },
  });
}

export function useCalendarReceiptDemo(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.calendarReceiptDemo(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: keys.access(id) }); qc.invalidateQueries({ queryKey: keys.ledger(id) }); },
  });
}

// ---- Calendar -------------------------------------------------------------------

export const useCalendar = (id: string, from: string, to: string) =>
  useQuery({ queryKey: keys.calendar(id, from, to), queryFn: () => api.calendar(id, from, to), staleTime: 30_000, placeholderData: (prev) => prev });

/** Meeting-link providers the grant has, and the default. */
export const useConferencing = (id: string, enabled = true) =>
  useQuery({ queryKey: ["mailbox", id, "conferencing"] as const, queryFn: () => api.conferencing(id), enabled, staleTime: 60_000 });

/** People to invite, ranked by the server from mail and recent events. Empty query = most frequent. */
export const useContacts = (id: string, q: string, enabled = true) =>
  useQuery({ queryKey: ["mailbox", id, "contacts", q] as const, queryFn: () => api.contacts(id, q), enabled, staleTime: 60_000, placeholderData: (prev) => prev });

export const useEvent = (id: string, eventId: string | null) =>
  useQuery({ queryKey: keys.event(id, eventId ?? ""), queryFn: () => api.event(id, eventId!), enabled: !!eventId, staleTime: 15_000 });

export const useEventPrep = (id: string, eventId: string | null) =>
  useQuery({ queryKey: [...keys.event(id, eventId ?? ""), "prep"] as const, queryFn: () => api.eventPrep(id, eventId!), enabled: !!eventId, staleTime: 10 * 60_000, retry: 0 });

export function usePatchEvent(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, input }: { eventId: string; input: EventPatchInput }) => api.patchEvent(id, eventId, input),
    onSuccess: (event) => {
      qc.setQueryData(keys.event(id, event.id), (prev: { event: unknown } | undefined) => (prev ? { ...prev, event } : prev));
      qc.invalidateQueries({ queryKey: ["mailbox", id, "calendar"] });
      qc.invalidateQueries({ queryKey: keys.event(id, event.id) });
      qc.invalidateQueries({ queryKey: keys.brief(id) });
    },
  });
}

export function useRsvp(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, action }: { eventId: string; action: RsvpAction }) => api.rsvp(id, eventId, action),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mailbox", id, "calendar"] });
      qc.invalidateQueries({ queryKey: ["mailbox", id, "event"] });
      qc.invalidateQueries({ queryKey: keys.threads(id) });
      qc.invalidateQueries({ queryKey: keys.inboxAll(id) });
      qc.invalidateQueries({ queryKey: keys.brief(id) });
    },
  });
}

export function useOfferTimes(id: string) {
  return useMutation({ mutationFn: ({ threadId, input }: { threadId: string; input: OfferTimesInput }) => api.offerTimes(id, threadId, input) });
}

export function useCreateEvent(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEventInput) => api.createEvent(id, input),
    onSuccess: (_r, vars) => {
      qc.invalidateQueries({ queryKey: ["mailbox", id, "calendar"] });
      qc.invalidateQueries({ queryKey: keys.brief(id) });
      if (vars.fromThreadId) qc.invalidateQueries({ queryKey: keys.thread(id, vars.fromThreadId) });
    },
  });
}

export function useProposeTime(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, slots }: { threadId: string; slots: { start: string; end: string }[] }) => api.proposeTime(id, threadId, slots),
    onSuccess: (_r, { threadId }) => qc.invalidateQueries({ queryKey: keys.thread(id, threadId) }),
  });
}

export function useUpdateCalendar(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ calendarId, patch }: { calendarId: string; patch: import("@rill/core/api-types").CalendarPatchInput }) => api.updateCalendar(id, calendarId, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mailbox", id, "calendar"] }),
  });
}

export function useAsk(id: string) {
  return useMutation({ mutationFn: (q: string) => api.ask(id, q) });
}

export function useSync(id: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api.sync(id), onSettled: () => invalidateMailbox(qc, id) });
}

// ---- Inbox assistant chat -----------------------------------------------------

export const useChats = (id: string) => useQuery({ queryKey: keys.chats(id), queryFn: () => api.chats(id), staleTime: 10_000 });
export const useChat = (id: string, chatId: string | null) =>
  useQuery({ queryKey: keys.chat(id, chatId ?? ""), queryFn: () => api.chat(id, chatId!), enabled: !!chatId, staleTime: 2_000 });

export function useCreateChat(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (title?: string) => api.createChat(id, title),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.chats(id) }),
  });
}

export function useDeleteChat(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (chatId: string) => api.deleteChat(id, chatId),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.chats(id) }),
  });
}

/** A "Use this draft" proposal: writes the assistant's drafted text into the thread's reply box. Creates the draft row first when the thread has none yet; never sends. */
export function useApplyDraftProposal(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ threadId, body }: { threadId: string; body: string }) => {
      const thread = await api.thread(id, threadId);
      const open = thread.draft && thread.draft.status !== "sent" && thread.draft.status !== "discarded" ? thread.draft : null;
      const draft = open ? await api.updateDraft(id, open.id, body) : await api.updateDraft(id, (await api.writeDraft(id, threadId)).id, body);
      return { draft, subject: thread.thread.subject };
    },
    onSuccess: (_r, { threadId }) => {
      qc.invalidateQueries({ queryKey: keys.thread(id, threadId) });
      qc.invalidateQueries({ queryKey: keys.inboxAll(id) });
    },
  });
}
