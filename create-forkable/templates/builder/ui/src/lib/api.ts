// Typed fetch wrapper over docs/CONTRACT.md section 9.
import type {
  AccessTestResponse, ActivityResponse, ScopesResponse, PublishBody, PublishesResponse, PublishStartResponse, ScanResult,
  CheckpointResponse, CheckpointsResponse, CreateProjectBody, CreateProjectResponse, CreateTurnBody, CreateTurnResponse,
  DiffResponse, ErrorsResponse, FileResponse, FilesResponse, FixBody, HarnessesResponse, HealthResponse, MeResponse,
  AttachmentResponse, VersionResponse, EditsBody, EditsResponse, ProjectPatch, ProjectResponse, ProjectsResponse, PutFileBody, SettingsPatch, SettingsResponse, TurnEventsResponse, TurnsResponse,
  VisitorsPatchBody, ConnectCheckResponse, ProjectEnvResponse, OneCliResponse,
  ConnectSetupResponse, ConnectTemplatesResponse, ProjectConnectBody, ProjectConnectResponse,
  VisitorsResponse,
} from "@builder/core/api-types";
import type { Turn } from "@builder/core/types";
import { BRAND_NAME, BRAND_SLUG } from "./brand";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** The rest of the error body (a blocked publish carries its scan). */
  readonly extra: Record<string, unknown>;
  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/** A sentence a person can act on, never a stack trace. */
export function humanError(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof TypeError) return `${BRAND_NAME} is not answering. Check that the server is running, then try again.`;
  return e instanceof Error ? e.message : "Something went wrong.";
}

/** The server's CSRF token for environment changes, read from the env GET routes. Never a stored value. */
let csrfToken: string | null = null;
const CSRF_HEADER = `x-${BRAND_SLUG}-csrf`;
const remember = <T extends { csrf?: string }>(r: T): T => {
  if (r?.csrf) csrfToken = r.csrf;
  return r;
};

/** An environment change: carries the CSRF token, fetching it once, and retries once when the server restarted. */
async function envChange<T extends { csrf?: string }>(method: string, path: string, body?: unknown): Promise<T> {
  if (!csrfToken) remember(await request<ConnectTemplatesResponse>("GET", "/connect/templates"));
  try {
    return remember(await request<T>(method, path, body, { [CSRF_HEADER]: csrfToken! }));
  } catch (e) {
    if (!(e instanceof ApiError && e.code === "csrf")) throw e;
    remember(await request<ConnectTemplatesResponse>("GET", "/connect/templates"));
    return remember(await request<T>(method, path, body, { [CSRF_HEADER]: csrfToken! }));
  }
}

async function request<T>(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch (e) {
    throw e instanceof TypeError ? e : new TypeError(String(e));
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  if (!res.ok) {
    const { error: err, ...extra } = (data as { error?: { code?: string; message?: string } } | null) ?? {};
    throw new ApiError(res.status, err?.code ?? `http_${res.status}`, err?.message ?? "The server could not do that.", extra);
  }
  return data as T;
}

const q = (params: Record<string, string | number | boolean | undefined | null>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : "";
};

const P = (id: string) => `/projects/${encodeURIComponent(id)}`;

async function upload(url: string, file: Blob): Promise<AttachmentResponse> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "content-type": file.type }, body: file, credentials: "same-origin" });
  } catch (e) {
    throw e instanceof TypeError ? e : new TypeError(String(e));
  }
  const data = (await res.json().catch(() => null)) as (AttachmentResponse & { error?: { code: string; message: string } }) | null;
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? `http_${res.status}`, data?.error?.message ?? "Could not attach that image.");
  return data!;
}

export const api = {
  health: () => request<HealthResponse>("GET", "/health"),
  me: () => request<MeResponse>("GET", "/me"),
  harnesses: (force = false) => request<HarnessesResponse>("GET", `/harnesses${q({ force: force ? 1 : undefined })}`),
  settings: () => request<SettingsResponse>("GET", "/settings"),
  patchSettings: (patch: SettingsPatch) => request<SettingsResponse>("PATCH", "/settings", patch),

  projects: () => request<ProjectsResponse>("GET", "/projects"),
  createProject: (body: CreateProjectBody) => request<CreateProjectResponse>("POST", "/projects", body),
  project: (id: string) => request<ProjectResponse>("GET", P(id)),
  patchProject: (id: string, patch: ProjectPatch) => request<ProjectResponse>("PATCH", P(id), patch),
  deleteProject: (id: string, deleteFiles = false) => request<void>("DELETE", `${P(id)}${q({ deleteFiles: deleteFiles ? 1 : undefined })}`),

  createTurn: (id: string, body: CreateTurnBody) => request<CreateTurnResponse>("POST", `${P(id)}/turns`, body),
  cancelTurn: (id: string, turnId: string) => request<{ turn: Turn }>("POST", `${P(id)}/turns/${turnId}/cancel`),
  applyEdits: (id: string, body: EditsBody) => request<EditsResponse>("POST", `${P(id)}/edits`, body),
  attach: (id: string, file: Blob) => upload(`/api${P(id)}/attachments`, file),
  /** Home: no project yet, so the image is staged and POST /projects {images} moves it in. */
  stage: (file: Blob) => upload("/api/attachments", file),
  unstage: (file: string) => request<void>("DELETE", `/attachments/${encodeURIComponent(file)}`),
  steer: (id: string, turnId: string, text: string) => request<{ queued: true }>("POST", `${P(id)}/turns/${turnId}/steer`, { text }),
  turns: (id: string, before?: string | null) => request<TurnsResponse>("GET", `${P(id)}/turns${q({ before })}`),
  turnEvents: (id: string, turnId: string, after?: number) => request<TurnEventsResponse>("GET", `${P(id)}/turns/${turnId}/events${q({ after })}`),

  files: (id: string) => request<FilesResponse>("GET", `${P(id)}/files`),
  file: (id: string, path: string) => request<FileResponse>("GET", `${P(id)}/file${q({ path })}`),
  putFile: (id: string, body: PutFileBody) => request<FileResponse>("PUT", `${P(id)}/file`, body),

  checkpointNow: (id: string) => request<CheckpointResponse>("POST", `${P(id)}/checkpoint`),
  checkpoints: (id: string) => request<CheckpointsResponse>("GET", `${P(id)}/checkpoints`),
  diff: (id: string, sha: string) => request<DiffResponse>("GET", `${P(id)}/checkpoints/${sha}/diff`),
  restore: (id: string, sha: string) => request<CheckpointResponse>("POST", `${P(id)}/checkpoints/${sha}/restore`),
  bookmark: (id: string, sha: string, on: boolean) => request<CheckpointResponse>("POST", `${P(id)}/checkpoints/${sha}/bookmark`, { on }),
  version: (id: string) => request<VersionResponse>("GET", `${P(id)}/version`),
  previewVersion: (id: string, sha: string) => request<VersionResponse>("POST", `${P(id)}/checkpoints/${sha}/preview`),
  versionViewed: (id: string) => request<void>("POST", `${P(id)}/version/viewed`),
  closeVersion: (id: string) => request<void>("DELETE", `${P(id)}/version`),

  errors: (id: string, open = true) => request<ErrorsResponse>("GET", `${P(id)}/errors${q({ open: open ? 1 : undefined })}`),
  fix: (id: string, body: FixBody = {}) => request<CreateTurnResponse>("POST", `${P(id)}/fix`, body),

  restartPreview: (id: string) => request<ProjectResponse>("POST", `${P(id)}/preview/restart`),
  previewViewed: (id: string) => request<void>("POST", `${P(id)}/preview/viewed`),

  // The One CLI on this machine (Settings, One CLI).
  oneCli: (force = false) => request<OneCliResponse>("GET", `/one/cli${q({ force: force ? 1 : undefined })}`),
  oneCliRefresh: () => request<OneCliResponse>("POST", "/one/cli/refresh"),
  oneCliLogin: () => request<OneCliResponse>("POST", "/one/cli/login"),
  scopes: (id: string) => request<ScopesResponse>("GET", `${P(id)}/scopes`),
  setVisitors: (id: string, body: VisitorsPatchBody) => request<VisitorsResponse>("PATCH", `${P(id)}/visitors`, body),
  activity: (id: string, before?: number | null) => request<ActivityResponse>("GET", `${P(id)}/activity${q({ before })}`),
  testLocal: (id: string, platform: string) => request<AccessTestResponse>("POST", `${P(id)}/access/test-local`, { platform }),
  testOne: (id: string, platform: string) => request<AccessTestResponse>("POST", `${P(id)}/access/test-one`, { platform }),

  publishes: (id: string) => request<PublishesResponse>("GET", `${P(id)}/publishes`),
  scan: (id: string, sha?: string) => request<{ scan: ScanResult }>("POST", `${P(id)}/publish/scan`, sha ? { sha } : {}),
  publish: (id: string, body: PublishBody) => request<PublishStartResponse>("POST", `${P(id)}/publish`, body),

  // Environment: write-only. Responses carry names and status, never a value.
  // One Connect: saved Connect apps (templates and each project's own), CONTRACT 18.
  connectTemplates: () => request<ConnectTemplatesResponse>("GET", "/connect/templates").then(remember),
  createTemplate: (body: { name: string; values?: Record<string, string>; fromSetupId?: string }) => envChange<ConnectSetupResponse & { csrf?: string }>("POST", "/connect/templates", body),
  renameSetup: (sid: string, name: string) => envChange<ConnectSetupResponse & { csrf?: string }>("PATCH", `/connect/setups/${encodeURIComponent(sid)}`, { name }),
  removeSetup: (sid: string) => envChange<ConnectTemplatesResponse>("DELETE", `/connect/setups/${encodeURIComponent(sid)}`),
  saveSetupEnv: (sid: string, values: Record<string, string>) => envChange<ConnectSetupResponse & { csrf?: string }>("PUT", `/connect/setups/${encodeURIComponent(sid)}/env`, { values }),
  removeSetupEnv: (sid: string, name: string) => envChange<ConnectSetupResponse & { csrf?: string }>("DELETE", `/connect/setups/${encodeURIComponent(sid)}/env/${encodeURIComponent(name)}`),
  checkSetup: (sid: string, values: Record<string, string> = {}) => envChange<ConnectCheckResponse & { csrf?: string }>("POST", `/connect/setups/${encodeURIComponent(sid)}/check`, { values }),
  checkNewSetup: (values: Record<string, string>) => envChange<ConnectCheckResponse & { csrf?: string }>("POST", "/connect/check", { values }),
  projectConnect: (id: string) => request<ProjectConnectResponse>("GET", `${P(id)}/connect`).then(remember),
  setProjectConnect: (id: string, body: ProjectConnectBody) => envChange<ProjectConnectResponse>("PUT", `${P(id)}/connect`, body),
  saveProjectConnectAsTemplate: (id: string, name: string) => envChange<ConnectSetupResponse & { csrf?: string }>("POST", `${P(id)}/connect/save-template`, { name }),
  projectEnv: (id: string) => request<ProjectEnvResponse>("GET", `${P(id)}/env`).then(remember),
  saveProjectEnv: (id: string, values: Record<string, string>) => envChange<ProjectEnvResponse>("PUT", `${P(id)}/env`, { values }),
  removeProjectEnv: (id: string, name: string) => envChange<ProjectEnvResponse>("DELETE", `${P(id)}/env/${encodeURIComponent(name)}`),
};

/** Per-field messages from a 400 invalid answer (never a value). */
export const fieldErrors = (e: unknown): Record<string, string> => (e instanceof ApiError && e.code === "invalid" ? ((e.extra.fields as Record<string, string>) ?? {}) : {});

export const shotUrl = (projectId: string, file: string) => `/api${P(projectId)}/shots/${encodeURIComponent(file)}`;
export const eventsUrl = (projectId: string) => `/api${P(projectId)}/events`;
