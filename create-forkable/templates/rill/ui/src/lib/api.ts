// Typed fetch wrapper over docs/CONTRACT.md "Server API".
import type {
  AccessResponse, AllInboxResponse, ApiCalendar, ApiChat, ApiChatMessage, ApiDraft, ApiEvent, ApiGoal, ApiMailbox, ApiSettings, ApiVip, AskResponse, BriefResponse,
  CalendarPatchInput, CalendarResponse, ComposeInput, ComposeResponse, ConferencingResponse, ContactsResponse, EventPatchInput, CreateEventInput, CreateEventResponse, EnginesResponse, EventResponse, FreeBusyResponse, GoalInput, InboxResponse,
  InboxRow, LedgerRow, MeetingPrep, MeResponse, OfferTimesInput, OfferTimesResponse, OnboardingSuggestions,
  PaletteResponse, ProposeTimeResponse, RsvpAction, SyncResponse, ThreadAction, ThreadHtmlResponse, ThreadResponse, VipInput, VipSuggestion,
} from "@rill/core/api-types";
import type { ConnectFieldName, ConnectSetupInput, ConnectSetupResponse } from "@rill/core/connect-setup";
import type { Lane } from "@rill/core/types";

export const API_BASE = "/api/v1";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** The whole error body, for routes that say more (per-field messages). */
  readonly data: unknown;
  constructor(status: number, code: string, message: string, data: unknown = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? `http_${res.status}`, err?.message ?? res.statusText ?? "Request failed", data);
  }
  return data as T;
}

const q = (params: Record<string, string | number | boolean | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : "";
};

export const api = {
  health: () => fetch("/api/health").then((r) => r.json() as Promise<{ ok: boolean; version: string }>),
  me: () => request<MeResponse>("GET", "/me"),
  signout: () => request<void>("POST", "/signout"),
  disconnect: () => request<void>("POST", "/connect/disconnect"),

  connectSetup: () => request<ConnectSetupResponse>("GET", "/setup/connect"),
  saveConnectSetup: (input: ConnectSetupInput) => request<ConnectSetupResponse>("POST", "/setup/connect", input),
  removeConnectSetup: (name: ConnectFieldName) => request<ConnectSetupResponse>("DELETE", `/setup/connect/${name}`),

  createSampleMailbox: () => request<ApiMailbox>("POST", "/mailboxes/sample"),

  inbox: (id: string, lane: Lane, includeDone = false) =>
    request<InboxResponse>("GET", `/mailboxes/${id}/inbox${q({ lane, includeDone: includeDone ? 1 : 0 })}`),
  allInbox: (lane: Lane) => request<AllInboxResponse>("GET", `/inbox/all${q({ lane })}`),
  thread: (id: string, threadId: string) => request<ThreadResponse>("GET", `/mailboxes/${id}/threads/${threadId}`),
  threadHtml: (id: string, threadId: string) => request<ThreadHtmlResponse>("GET", `/mailboxes/${id}/threads/${threadId}/html`),
  threadAction: (id: string, threadId: string, action: ThreadAction) =>
    request<InboxRow>("POST", `/mailboxes/${id}/threads/${threadId}/actions`, action),
  writeDraft: (id: string, threadId: string, instructions?: string) =>
    request<ApiDraft>("POST", `/mailboxes/${id}/threads/${threadId}/draft`, instructions ? { instructions } : {}),
  updateDraft: (id: string, draftId: string, body: string) => request<ApiDraft>("PUT", `/mailboxes/${id}/drafts/${draftId}`, { body }),
  saveDraft: (id: string, draftId: string) => request<ApiDraft>("POST", `/mailboxes/${id}/drafts/${draftId}/save`),
  sendDraft: (id: string, draftId: string) => request<ApiDraft>("POST", `/mailboxes/${id}/drafts/${draftId}/send`),
  discardDraft: (id: string, draftId: string) => request<void>("POST", `/mailboxes/${id}/drafts/${draftId}/discard`),
  compose: (id: string, input: ComposeInput) => request<ComposeResponse>("POST", `/mailboxes/${id}/compose`, input),

  goals: (id: string) => request<ApiGoal[]>("GET", `/mailboxes/${id}/goals`),
  createGoal: (id: string, input: GoalInput) => request<ApiGoal>("POST", `/mailboxes/${id}/goals`, input),
  updateGoal: (id: string, goalId: string, input: Partial<GoalInput>) => request<ApiGoal>("PUT", `/mailboxes/${id}/goals/${goalId}`, input),
  deleteGoal: (id: string, goalId: string) => request<void>("DELETE", `/mailboxes/${id}/goals/${goalId}`),

  vips: (id: string) => request<ApiVip[]>("GET", `/mailboxes/${id}/vips`),
  createVip: (id: string, input: VipInput) => request<ApiVip>("POST", `/mailboxes/${id}/vips`, input),
  updateVip: (id: string, vipId: string, input: Partial<VipInput>) => request<ApiVip>("PUT", `/mailboxes/${id}/vips/${vipId}`, input),
  deleteVip: (id: string, vipId: string) => request<void>("DELETE", `/mailboxes/${id}/vips/${vipId}`),
  suggestVips: (id: string) => request<VipSuggestion[]>("POST", `/mailboxes/${id}/vips/suggest`),

  onboardingSuggestions: (id: string) => request<OnboardingSuggestions>("GET", `/mailboxes/${id}/onboarding/suggestions`),
  brief: (id: string, date?: string) => request<BriefResponse>("GET", `/mailboxes/${id}/brief${q({ date })}`),
  ask: (id: string, question: string) => request<AskResponse>("POST", `/mailboxes/${id}/ask`, { q: question }),
  access: (id: string) => request<AccessResponse>("GET", `/mailboxes/${id}/access`),
  receiptDemo: (id: string) => request<LedgerRow>("POST", `/mailboxes/${id}/access/receipt-demo`),
  calendarReceiptDemo: (id: string) => request<LedgerRow>("POST", `/mailboxes/${id}/access/calendar-receipt-demo`),
  ledger: (id: string, limit = 100) => request<LedgerRow[]>("GET", `/mailboxes/${id}/ledger${q({ limit })}`),
  sync: (id: string) => request<SyncResponse>("POST", `/mailboxes/${id}/sync`),
  palette: (id: string, query: string) => request<PaletteResponse>("GET", `/mailboxes/${id}/palette${q({ q: query })}`),
  settings: (id: string) => request<ApiSettings>("GET", `/mailboxes/${id}/settings`),
  updateSettings: (id: string, patch: Partial<ApiSettings>) => request<ApiSettings>("PUT", `/mailboxes/${id}/settings`, patch),
  engines: () => request<EnginesResponse>("GET", "/engines"),

  calendar: (id: string, from: string, to: string) => request<CalendarResponse>("GET", `/mailboxes/${id}/calendar${q({ from, to })}`),
  event: (id: string, eventId: string) => request<EventResponse>("GET", `/mailboxes/${id}/events/${eventId}`),
  eventPrep: (id: string, eventId: string) => request<MeetingPrep | null>("GET", `/mailboxes/${id}/events/${eventId}/prep`),
  patchEvent: (id: string, eventId: string, input: EventPatchInput) => request<ApiEvent>("PATCH", `/mailboxes/${id}/events/${eventId}`, input),
  rsvp: (id: string, eventId: string, action: RsvpAction) => request<ApiEvent>("POST", `/mailboxes/${id}/events/${eventId}/rsvp`, action),
  freeBusy: (id: string, from: string, to: string) => request<FreeBusyResponse>("POST", `/mailboxes/${id}/freebusy`, { from, to }),
  offerTimes: (id: string, threadId: string, input: OfferTimesInput) => request<OfferTimesResponse>("POST", `/mailboxes/${id}/threads/${threadId}/offer-times`, input),
  conferencing: (id: string) => request<ConferencingResponse>("GET", `/mailboxes/${id}/conferencing`),
  contacts: (id: string, query: string, limit = 8) => request<ContactsResponse>("GET", `/mailboxes/${id}/contacts${q({ q: query, limit: String(limit) })}`),
  createEvent: (id: string, input: CreateEventInput) => request<CreateEventResponse>("POST", `/mailboxes/${id}/events`, input),
  proposeTime: (id: string, threadId: string, slots: { start: string; end: string }[]) => request<ProposeTimeResponse>("POST", `/mailboxes/${id}/threads/${threadId}/propose-time`, { threadId, slots }),
  updateCalendar: (id: string, calendarId: string, patch: CalendarPatchInput) => request<ApiCalendar>("PUT", `/mailboxes/${id}/calendars/${calendarId}`, patch),

  chats: (id: string) => request<ApiChat[]>("GET", `/mailboxes/${id}/chats`),
  createChat: (id: string, title?: string) => request<ApiChat>("POST", `/mailboxes/${id}/chats`, title ? { title } : {}),
  chat: (id: string, chatId: string) => request<{ chat: ApiChat; messages: ApiChatMessage[] }>("GET", `/mailboxes/${id}/chats/${chatId}`),
  deleteChat: (id: string, chatId: string) => request<void>("DELETE", `/mailboxes/${id}/chats/${chatId}`),
};

export type Api = typeof api;
