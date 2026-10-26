import "dotenv/config";

export interface Env {
  port: number;
  oneClientId?: string;
  oneClientSecret?: string;
  oneConnectKey?: string;
  oneRedirectUri?: string;
  onePermissionSet?: string;
}

export function loadEnv(): Env {
  return {
    port: Number(process.env.PORT ?? 51890),
    oneClientId: process.env.ONE_CLIENT_ID,
    oneClientSecret: process.env.ONE_CLIENT_SECRET,
    oneConnectKey: process.env.ONE_CONNECT_KEY,
    oneRedirectUri: process.env.ONE_REDIRECT_URI,
    onePermissionSet: process.env.ONE_PERMISSION_SET,
  };
}

export function hasOneConnectConfig(env: Env): boolean {
  return Boolean(env.oneClientId && env.oneClientSecret && env.oneConnectKey && env.oneRedirectUri);
}
