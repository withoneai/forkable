// Every One action a flow on /mcp calls, by its id in One's catalog. Ids,
// titles, methods and paths were checked with the One CLI
// (`one --agent actions find <platform> "<intent>"`, CLI 2.10.0) on
// 2026-10-28. A flow declares the ones it uses in flows.json, exactly as an
// agent declares them to render_ui, and the sample host refuses anything
// undeclared the way the real server does.

export type FlowAction = {
  actionId: string;
  platform: "gmail" | "google-calendar" | "stripe" | "github";
  title: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  write: boolean;
};

export const ACTIONS = {
  gmailThreads: {
    actionId: "conn_mod_def::GGSNlnppgZ0::qk3CudDWTVKPY7hpPVCqLQ",
    platform: "gmail",
    title: "List and View Email Threads",
    method: "POST",
    path: "/v1/gmail/get-threads",
    write: false,
  },
  gmailSend: {
    actionId: "conn_mod_def::GGXAjWkZO8U::uMc1LQIHTTKzeMm3rLL5gQ",
    platform: "gmail",
    title: "Send Email",
    method: "POST",
    path: "/v1/gmail/send-email",
    write: true,
  },
  gmailDraft: {
    actionId: "conn_mod_def::GGZUe0SIuk8::nhwEKp2cQ6uARsH3513VeQ",
    platform: "gmail",
    title: "Create Draft",
    method: "POST",
    path: "/v1/gmail/create-draft",
    write: true,
  },
  gmailBatchModify: {
    actionId: "conn_mod_def::GJ3ocX2edTU::mhLdczGoT2O9KVIUEjp8xw",
    platform: "gmail",
    title: "Batch Modify a User’s Gmail Messages (Labels)",
    method: "POST",
    path: "/gmail/v1/users/{{userId}}/messages/batchModify",
    write: true,
  },
  calendarEvents: {
    actionId: "conn_mod_def::GJ6RlnIYK20::YzuWSmaVQgurletRDNJavA",
    platform: "google-calendar",
    title: "List a Calendar's Events",
    method: "GET",
    path: "/calendars/{{calendarId}}/events",
    write: false,
  },
  stripeCharges: {
    actionId: "conn_mod_def::GJ7Kr4ILxto::NkTwzYCqS7a2-axG_Yro0A",
    platform: "stripe",
    title: "List Charges",
    method: "GET",
    path: "/charges",
    write: false,
  },
  stripeSubscriptions: {
    actionId: "conn_mod_def::GJ7Ku75hXu8::mfT7dYOYQQCoxlI7D5uKIw",
    platform: "stripe",
    title: "List Subscriptions",
    method: "GET",
    path: "/subscriptions",
    write: false,
  },
  stripeInvoices: {
    actionId: "conn_mod_def::GHKYu29sSoM::c1XPIp6wQHmmkmMSvSfvXQ",
    platform: "stripe",
    title: "Get Invoices",
    method: "POST",
    path: "/v1/stripe/get-invoices",
    write: false,
  },
  githubPulls: {
    actionId: "conn_mod_def::GGV5vcY-XvE::aeuFAgzYQZyfi-gMZ3_uLA",
    platform: "github",
    title: "List Pull Requests",
    method: "POST",
    path: "/v1/github/get-pull-requests",
    write: false,
  },
} as const satisfies Record<string, FlowAction>;

export type ActionKey = keyof typeof ACTIONS;

export const BY_ID: Record<string, FlowAction> = Object.fromEntries(
  Object.values(ACTIONS).map((a) => [a.actionId, a]),
);
