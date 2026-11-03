// "Test a refusal" on the Access tab.
// Local: a DELETE action this app does not call, put to the preview's local
// check, which stops it before One (always a Local receipt).
// Ask One: the same action sent to One with a resource id that cannot
// exist, on the developer's own sign-in to this app's Connect app. Live, it
// runs inside the preview (the sign-in lives there): the platform mints a
// one-use ticket, the editor hands it to the preview, the app runs it and
// reports One's answer. One's own 403 if the grant lacks it; if the grant
// allows it, the provider's 404 comes back and we say so. On the sample
// source the stub One answers in place. One's answer is never made up.

import { randomBytes } from "node:crypto";
import type { AccessTestResponse } from "./api-types.js";
import type { ActivityLedger } from "./activity.js";
import { verbFor } from "./catalog/naming.js";
import type { CatalogService } from "./catalog/service.js";
import type { ConnectSetups } from "./connect.js";
import type { DevGate } from "./devgate.js";
import { makeReceipt } from "./receipts.js";
import type { ProjectRef, ScopeService } from "./scopes/service.js";
import type { OneSource } from "./onesource.js";

export const MISSING_ID = "builder-receipt-test-does-not-exist";

export interface AccessTicket {
  projectId: string;
  platform: string;
  actionId: string;
  title: string;
  method: string;
  path: string;
  pathParams: Record<string, string>;
  at: number;
}

const TICKET_TTL = 2 * 60_000;

export class AccessTests {
  private tickets = new Map<string, AccessTicket>();

  constructor(private d: { catalog: CatalogService; scopes: ScopeService; gate: DevGate; activity: ActivityLedger; connect: ConnectSetups; source: OneSource }) {}

  /** A DELETE action on the platform that the manifest does not include. */
  async pick(p: ProjectRef, platform: string): Promise<{ actionId: string; title: string; method: string; path: string } | null> {
    const { manifest } = await this.d.scopes.derive(p);
    const inManifest = new Set(manifest.actions.map((a) => a.actionId));
    const deletes = (await this.d.catalog.deletes(platform).catch(() => [])).filter((a) => !inManifest.has(a.actionId));
    // Prefer "delete one message" over "delete a label" style actions: one {{id}} after a plural noun.
    deletes.sort((a, b) => score(b.path, b.title) - score(a.path, a.title));
    return deletes[0] ?? null;
  }

  async local(p: ProjectRef, platform: string): Promise<AccessTestResponse> {
    const a = await this.pick(p, platform);
    if (!a) return { receipt: null, note: await this.nothing(platform), action: null };
    const r = await this.d.gate.check(p, { platform, actionId: a.actionId, method: a.method, path: a.path, title: a.title });
    return { receipt: r.allow ? null : r.receipt, note: r.allow ? "The local check let this through, which it should not. Check the manifest." : null, action: a };
  }

  async one(p: ProjectRef, platform: string): Promise<AccessTestResponse> {
    const a = await this.pick(p, platform);
    if (!a) return { receipt: null, note: await this.nothing(platform), action: null };
    const c = await this.d.connect.projectConnect(p.id);
    if (!c.enabled) return { receipt: null, note: "Turn on One Connect for this app first. This test runs on your own sign-in to the app's Connect app.", action: a };
    const name = await this.d.catalog.platformName(platform);
    const verb = verbFor({ method: a.method, path: a.path, platform });
    const pathParams = fill(a.path);
    const stub = this.d.source.stub;
    if (!stub) {
      const id = randomBytes(18).toString("base64url");
      const now = Date.now();
      for (const [k, t] of this.tickets) if (now - t.at > TICKET_TTL) this.tickets.delete(k);
      this.tickets.set(id, { projectId: p.id, platform, ...a, pathParams, at: now });
      return { receipt: null, note: null, action: a, ticket: id };
    }
    // The sample: the stub One stands in for this app's Connect app and your sign-in to it.
    const conn = stub.file.connections.find((x) => x.platform === platform);
    if (!conn) return { receipt: null, note: `${name} is not in the sample grant, so there is nothing for One to refuse.`, action: a };
    const t0 = Date.now();
    const r = await stub.runAction("sample-builder", { connectionKey: conn.key, actionId: a.actionId, method: a.method, path: a.path, pathParams });
    const { receipt } = await this.d.gate.report(p, { platform, actionId: a.actionId, title: a.title, method: a.method, path: a.path, status: r.status, ok: r.ok, blockedByGrant: r.blockedByGrant, ms: Date.now() - t0 });
    if (r.blockedByGrant) return { receipt, note: null, action: a };
    return { receipt: null, note: noteFor(name, verb, r.status), action: a };
  }

  /** The preview's app redeems a ticket (dev token checked by the route): which call to make, once. */
  redeem(projectId: string, id: string): AccessTicket | null {
    const t = this.tickets.get(id);
    if (!t || t.projectId !== projectId) return null;
    this.tickets.delete(id);
    return Date.now() - t.at > TICKET_TTL ? null : t;
  }

  private async nothing(platform: string): Promise<string> {
    const name = await this.d.catalog.platformName(platform);
    return `There is no ${name} delete action outside this app's manifest to test with.`;
  }
}

/** The words for an answer that was not a refusal. */
export function noteFor(name: string, verb: string, status: number): string {
  if (status === 404) return `Your grant allows ${name} · ${verb}. One sent the test on and ${name} found nothing to delete. Narrow your grant in One to see the refusal.`;
  if (status === 401) return "Sign in with One in the preview first. This test runs on your own sign-in to the app.";
  return `One sent the test on and ${name} answered ${status}. Your grant allows ${name} · ${verb}; narrow it in One to see the refusal.`;
}

function score(path: string, title: string): number {
  let s = 0;
  if (/\/(messages|threads|emails|items|records|events|files)\/\{\{?id\}?\}$/.test(path)) s += 3;
  if (/message|email/i.test(title)) s += 2;
  if (/label|filter|alias|setting/i.test(title)) s -= 2;
  return s;
}

/** Path params for the test: `userId` is "me", everything else an id that cannot exist. */
function fill(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of path.matchAll(/\{\{?\s*([A-Za-z0-9_]+)\s*\}?\}/g)) out[m[1]!] = /^user_?id$/i.test(m[1]!) ? "me" : MISSING_ID;
  return out;
}
