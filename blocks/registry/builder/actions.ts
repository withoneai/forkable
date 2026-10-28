import type { OneAction } from "../lib/one-server.js";

// The GitHub actions Builder's export runs (builder/packages/core/src/publish/actions.ts):
// git's own data API, one blob per file, one tree, one commit, one ref. No
// git push, no remote, no token in the app. Headers are the ones each
// action's schema pins.
export const JSON_IO = { Accept: "application/json", "Content-Type": "application/json" };
export const GITHUB = {
  createRepo: { platform: "github", actionId: "conn_mod_def::GJ3Z4tE4G5A::lTHBrlzlSouqu-x8AHeT3Q", method: "POST", path: "/user/repos", access: "write" },
  createBlob: { platform: "github", actionId: "conn_mod_def::GJ3ZJkM0oow::6pCvkMJYSue8xhH4Bvy6eQ", method: "POST", path: "/repos/{{owner}}/{{repo}}/git/blobs", access: "write" },
  createTree: { platform: "github", actionId: "conn_mod_def::GJ3ZKCHKkUA::xHBDE-LtSkWfVdTQxLIp3g", method: "POST", path: "/repos/{{owner}}/{{repo}}/git/trees", access: "write" },
  createCommit: { platform: "github", actionId: "conn_mod_def::GJ3ZJrwmLbo::Rp9vt2o3RBqDxBLQ1sRRng", method: "POST", path: "/repos/{{owner}}/{{repo}}/git/commits", access: "write" },
  createRef: { platform: "github", actionId: "conn_mod_def::GJ3ZJzQSbw4::FMDSgh1WS5mvn2imiAkk2w", method: "POST", path: "/repos/{{owner}}/{{repo}}/git/refs", access: "write" },
} as const satisfies Record<string, OneAction>;
