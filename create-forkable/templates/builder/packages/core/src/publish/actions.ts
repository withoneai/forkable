// The catalog actions publish runs, from `one --agent actions find/load`.
// Method,
// path and the headers each schema pins come from the action's own docs
// (fixtures/knowledge holds the same public entries), so runAction never
// has to look them up.

export interface PublishAction {
  platform: "github" | "vercel";
  actionId: string;
  title: string;
  method: "GET" | "POST" | "PATCH";
  path: string;
  /** Headers the action's ioSchema pins with `const`. */
  headers: Record<string, string>;
}

const JSON_IO = { Accept: "application/json", "Content-Type": "application/json" };
const JSON_ACCEPT = { Accept: "application/json" };
const JSON_CT = { "Content-Type": "application/json" };

export const GITHUB_CONN_DEF = "conn_def::3DDQ4";
export const VERCEL_CONN_DEF = "conn_def::4AKH4A";

export const GITHUB = {
  createRepo: { platform: "github", actionId: "conn_mod_def::GJ3Z4tE4G5A::lTHBrlzlSouqu-x8AHeT3Q", title: "Create a Repository for the Authenticated User", method: "POST", path: "/user/repos", headers: JSON_IO },
  createBlob: { platform: "github", actionId: "conn_mod_def::GJ3ZJkM0oow::6pCvkMJYSue8xhH4Bvy6eQ", title: "Create a Repository Blob", method: "POST", path: "/repos/{{owner}}/{{repo}}/git/blobs", headers: JSON_IO },
  createTree: { platform: "github", actionId: "conn_mod_def::GJ3ZKCHKkUA::xHBDE-LtSkWfVdTQxLIp3g", title: "Create a Repository Git Tree", method: "POST", path: "/repos/{{owner}}/{{repo}}/git/trees", headers: JSON_IO },
  createCommit: { platform: "github", actionId: "conn_mod_def::GJ3ZJrwmLbo::Rp9vt2o3RBqDxBLQ1sRRng", title: "Create a Commit in a Repository", method: "POST", path: "/repos/{{owner}}/{{repo}}/git/commits", headers: JSON_IO },
  getRef: { platform: "github", actionId: "conn_mod_def::GJ3ZKe5vDKs::xb13z7ZBRnOWekJ-N_TG3w", title: "Get a Repository Git Reference", method: "GET", path: "/repos/{{owner}}/{{repo}}/git/ref/{{ref}}", headers: JSON_ACCEPT },
  createRef: { platform: "github", actionId: "conn_mod_def::GJ3ZJzQSbw4::FMDSgh1WS5mvn2imiAkk2w", title: "Create a Repository Git Reference", method: "POST", path: "/repos/{{owner}}/{{repo}}/git/refs", headers: JSON_IO },
  updateRef: { platform: "github", actionId: "conn_mod_def::GJ3ZK-BoUAw::f8MXbEVgQJ2sEdoPzO3NPA", title: "Update a Repository Git Reference", method: "PATCH", path: "/repos/{{owner}}/{{repo}}/git/refs/{{ref}}", headers: JSON_IO },
} as const satisfies Record<string, PublishAction>;

export const VERCEL = {
  createProject: { platform: "vercel", actionId: "conn_mod_def::GIi2endVvxY::4QRYvqrsShinBQfxYdpIMA", title: "Create a New Project", method: "POST", path: "/v11/projects", headers: JSON_CT },
  createEnv: { platform: "vercel", actionId: "conn_mod_def::GIi2iy8hP4o::Bn9C2U8RREySIMiqwHKn2w", title: "Create One or More Project Environment Variables", method: "POST", path: "/v10/projects/{{IDORNAME}}/env", headers: JSON_CT },
  createDeployment: { platform: "vercel", actionId: "conn_mod_def::GIi152aO03U::KTvTF_0ZTaS3tObzavwy0g", title: "Create a New Deployment", method: "POST", path: "/v13/deployments", headers: JSON_CT },
  /** Found with `actions find vercel "get a deployment"`. */
  getDeployment: { platform: "vercel", actionId: "conn_mod_def::GIi15DgMrtk::4sacesKzT3abQ63_h7ZSfw", title: "Get a Deployment by ID or URL", method: "GET", path: "/v13/deployments/{{idOrUrl}}", headers: JSON_CT },
  /** Not called in v1 (a production-target deployment needs no promote, custom domains are later). */
  promote: { platform: "vercel", actionId: "conn_mod_def::GIi2lFp8GxQ::mVT_rCp8R8iVzg6Dg91e1w", title: "Promote a Project Deployment to Production", method: "POST", path: "/v10/projects/{{PROJECTID}}/promote/{{DEPLOYMENTID}}", headers: JSON_CT },
  addDomain: { platform: "vercel", actionId: "conn_mod_def::GIi2hGo8nDk::75BzicVrSwqGaf8elHBP_g", title: "Add a Domain to a Project", method: "POST", path: "/v10/projects/{{idOrName}}/domains", headers: JSON_CT },
} as const satisfies Record<string, PublishAction>;

/**
 * Path parameters keyed the way the action's path spells them. The catalog
 * paths mix cases (`{{IDORNAME}}`, `{{idOrUrl}}`) and @withone/connect fills
 * `{{name}}` by exact key, so a logical name is matched case-insensitively.
 */
export function pathParams(a: PublishAction, values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const lower = new Map(Object.entries(values).map(([k, v]) => [k.toLowerCase(), v]));
  for (const m of a.path.matchAll(/\{\{([^}]+)\}\}/g)) {
    const key = m[1]!.trim();
    const v = lower.get(key.toLowerCase());
    if (v !== undefined) out[key] = v;
  }
  return out;
}
