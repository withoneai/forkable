// The Connect setup screen's fields and their format checks (ported from Rill).
// Messages never contain the value.

export type ConnectFieldName = "ONE_CLIENT_ID" | "ONE_CLIENT_SECRET" | "ONE_CONNECT_KEY" | "ONE_PERMISSION_SET";

export interface ConnectFieldSpec {
  name: ConnectFieldName;
  label: string;
  secret: boolean;
  required: boolean;
  /** Where to find it in the One dashboard. */
  where: string;
  placeholder: string;
}

export const CONNECT_FIELDS: ConnectFieldSpec[] = [
  { name: "ONE_CLIENT_ID", label: "Client ID", secret: false, required: true, where: "On the app's page, Credentials, Client ID.", placeholder: "Paste the client ID" },
  { name: "ONE_CLIENT_SECRET", label: "Client secret", secret: true, required: true, where: "Credentials, Client secret. Shown once, right after you create the app. Regenerate makes a new one.", placeholder: "one_secret_..." },
  { name: "ONE_CONNECT_KEY", label: "Connect key", secret: true, required: true, where: "Credentials, Connect keys, Create key, with the dashboard on Production. Shown once.", placeholder: "sk_live_..." },
  { name: "ONE_PERMISSION_SET", label: "Permission set", secret: false, required: false, where: "What the app asks for, the permission set id. Leave empty for an app that asks for everything.", placeholder: "Paste the permission set id" },
];

export const ONE_DASHBOARD_URL = "https://app.withone.ai";

export interface FieldCheck {
  ok: boolean;
  message: string;
}

/** Which field a bare value belongs in, by its shape. */
function shapeOf(v: string): ConnectFieldName | null {
  if (v.startsWith("one_secret_")) return "ONE_CLIENT_SECRET";
  if (v.startsWith("sk_live_") || v.startsWith("sk_test_")) return "ONE_CONNECT_KEY";
  return null;
}

export function checkConnectField(name: ConnectFieldName, value: string): FieldCheck {
  const v = value.trim();
  const spec = CONNECT_FIELDS.find((f) => f.name === name)!;
  if (!v) return spec.required ? { ok: false, message: "Required." } : { ok: true, message: "Not set." };
  if (/\s/.test(v)) return { ok: false, message: "Has a space or a line break in it. Copy it again with the dashboard's copy chip." };
  if (/^[*•]+$|\.\.\.$/.test(v)) return { ok: false, message: "That is the masked placeholder, not the value. Copy the value itself." };
  const other = shapeOf(v);
  if (other && other !== name) return { ok: false, message: `This looks like your ${CONNECT_FIELDS.find((f) => f.name === other)!.label.toLowerCase()}.` };
  switch (name) {
    case "ONE_CLIENT_ID":
      if (!/^[A-Za-z0-9._:-]{6,200}$/.test(v)) return { ok: false, message: "A client ID is 6 to 200 letters, digits, dots, dashes or colons." };
      return { ok: true, message: "Looks like a client ID." };
    case "ONE_CLIENT_SECRET":
      if (!v.startsWith("one_secret_")) return { ok: false, message: "A client secret starts with one_secret_." };
      if (v.length < 20) return { ok: false, message: "Too short for a client secret. It may have been cut off." };
      return { ok: true, message: "Looks like a client secret." };
    case "ONE_CONNECT_KEY":
      if (v.startsWith("sk_test_")) return { ok: false, message: "Connect keys work in Production only. Switch the dashboard to Production and create the key there." };
      if (!v.startsWith("sk_live_")) return { ok: false, message: "A Connect key starts with sk_live_." };
      if (v.length < 16) return { ok: false, message: "Too short for a Connect key. It may have been cut off." };
      return { ok: true, message: "Looks like a Connect key." };
    case "ONE_PERMISSION_SET":
      if (!/^[A-Za-z0-9-]{8,64}$/.test(v)) return { ok: false, message: "A permission set id is letters, digits and dashes, like 37fe1bc7-c0e2-..." };
      return { ok: true, message: "Looks like a permission set id." };
  }
}

/** Why `one connect create` could not run or did not finish. */
export type ConnectCreateErrorCode = "cli_missing" | "not_logged_in" | "node_upgrade" | "busy" | "timeout" | "cancelled" | "failed";

/**
 * The "Create my Connect app" run: `one --agent connect create` in the repo
 * root. The link is the approval page; it is not a secret, but it is only
 * ever returned to this computer's own setup screen, never logged.
 */
export interface ConnectCreateStatus {
  /** checking: making sure the One CLI is there and logged in. waiting: the approval page is open. */
  phase: "idle" | "checking" | "waiting" | "done" | "failed";
  link: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  /** When the CLI stops waiting for approval. */
  expiresAt: string | null;
  outcome: "created" | "updated" | "unchanged" | null;
  /** The app's client id, once approved. Not a secret. */
  clientId: string | null;
  error: { code: ConnectCreateErrorCode; message: string; upgrade?: string } | null;
}

export const IDLE_CREATE: ConnectCreateStatus = { phase: "idle", link: null, startedAt: null, finishedAt: null, expiresAt: null, outcome: null, clientId: null, error: null };
