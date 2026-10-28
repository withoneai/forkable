export interface OneAction {
  platform: string;
  actionId: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  access: "read" | "write";
}

// The Gmail actions the components call, by their One action id. Each
// component's block.json lists the ones it uses, and `forkable add` merges
// them into connect.manifest.json, which becomes the permission set users
// grant. Ids from One's catalog (`one actions find gmail ...`).
export const GMAIL = {
  getThreads: { platform: "gmail", actionId: "conn_mod_def::GGSNlnppgZ0::qk3CudDWTVKPY7hpPVCqLQ", method: "POST", path: "/v1/gmail/get-threads", access: "read" },
  getThread: { platform: "gmail", actionId: "conn_mod_def::GJ3ok0Eq0R8::AAzgZVLqTg2iBuITKpJLZg", method: "GET", path: "/gmail/v1/users/{{userId}}/threads/{{id}}", access: "read" },
  modifyThread: { platform: "gmail", actionId: "conn_mod_def::GJ3olIfJ9E0::xBAV1bF_RXG94_j4bmye2A", method: "POST", path: "/gmail/v1/users/{{userId}}/threads/{{id}}/modify", access: "write" },
  createDraft: { platform: "gmail", actionId: "conn_mod_def::GGZUe0SIuk8::nhwEKp2cQ6uARsH3513VeQ", method: "POST", path: "/v1/gmail/create-draft", access: "write" },
  sendEmail: { platform: "gmail", actionId: "conn_mod_def::GGXAjWkZO8U::uMc1LQIHTTKzeMm3rLL5gQ", method: "POST", path: "/v1/gmail/send-email", access: "write" },
} as const satisfies Record<string, OneAction>;

export const ANTHROPIC = {
  messages: { platform: "anthropic", actionId: "conn_mod_def::GJfJ6hmtpYo::zy68VQHpRFmqayjAzxkjDA", method: "POST", path: "/messages", access: "write" },
} as const satisfies Record<string, OneAction>;
