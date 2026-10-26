// The Connect setup screen's fields and their format checks. Browser-safe:
// the server checks with the same rules before anything is stored. Messages
// never contain the value.

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

/** What GET /setup/connect says about one field. Never the value. */
export interface ConnectFieldStatus {
  name: ConnectFieldName;
  saved: boolean;
  where: "keychain" | "file" | null;
  updatedAt: string | null;
  /** Last four characters. */
  hint: string | null;
}

export interface ConnectSetupResponse {
  /** false when hosted: the setup screen is for local mode only. */
  available: boolean;
  /** Sign in with One is on. */
  configured: boolean;
  /** Where the running app came from. "env" is the old .env path. */
  source: "store" | "env" | null;
  /** The exact address to register as the app's redirect URI. */
  redirectUri: string;
  /** Where saved values go on this computer. */
  storage: "keychain" | "file";
  fields: ConnectFieldStatus[];
}

export type ConnectSetupInput = Partial<Record<ConnectFieldName, string>>;
