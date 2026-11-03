// The developer's session in each preview (per-project Connect). A preview
// app keeps its own Sign in with One session in an `app_sid` cookie on its
// own host; every request to it passes through the preview proxy, which
// remembers the latest one per project, in memory only. The verifier uses it
// after a turn so its check sees the app as the developer does (signed in),
// not as a first visitor. Never written to disk, never sent anywhere but
// back to the same preview host on this computer.

export const APP_SESSION_COOKIE = "app_sid";
const SID = /^[A-Za-z0-9_-]{16,200}$/;

export class PreviewSessions {
  private byProject = new Map<string, { value: string; at: number }>();

  /** From a proxied request's Cookie header. */
  seen(projectId: string, cookieHeader: string | undefined): void {
    if (!cookieHeader) return;
    for (const part of cookieHeader.split(";")) {
      const i = part.indexOf("=");
      if (i < 0) continue;
      if (part.slice(0, i).trim() !== APP_SESSION_COOKIE) continue;
      const v = part.slice(i + 1).trim();
      if (SID.test(v)) this.byProject.set(projectId, { value: v, at: Date.now() });
    }
  }

  get(projectId: string): { name: string; value: string } | null {
    const hit = this.byProject.get(projectId);
    return hit ? { name: APP_SESSION_COOKIE, value: hit.value } : null;
  }

  forget(projectId: string): void {
    this.byProject.delete(projectId);
  }
}
