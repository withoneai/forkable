// A preview's .dev.vars (CONTRACT 12): the dev token and the local check's
// address. Not a One credential.

import { BRAND, env, SERVER_ORIGIN } from "./brand.js";

/** Where a preview app's dev client asks before each One call and reports after (the local check, CONTRACT 12). */
export const DEV_URL = (projectId: string): string => `${SERVER_ORIGIN}/api/dev/${projectId}`;

/**
 * The project's .dev.vars: the dev token for the local check and the shared
 * callback's state binding. Not a One credential; One Connect's values reach
 * the Worker through the dev server's own env, never a file. Rewritten at
 * every dev server start, so an older project's relay lines go away.
 */
export function devVarsText(projectId: string, token: string, devUrl = DEV_URL(projectId)): string {
  return [
    `# Written by ${BRAND.name}. Preview only: this project's dev token for the local check, not a One credential.`,
    `${env("DEV_URL")}=${devUrl}`,
    `${env("DEV_TOKEN")}=${token}`,
    `${env("PROJECT_ID")}=${projectId}`,
    "",
  ].join("\n");
}

