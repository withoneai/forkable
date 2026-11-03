// The preview's local check. A preview app
// calls One itself, on the developer's own sign-in to its own Connect app;
// before every call its dev client asks here, with the project's dev token,
// whether this call may leave the computer, and after it reports what One
// answered. Every call writes one Activity row. The checks, in order:
//   1. the live manifest (re-derived from the working tree): an action the
//      code on screen does not ask for answers 403 source "local",
//      blockedByManifest, and One is never called
//   2. run as the owner for a visitor (`one(c, { as: "owner" })`) and the
//      builder has not allowed that action for visitors: 403 local
//      visitors_off or visitor_not_allowed
//   3. a version preview (an older checkpoint on its own host) and the
//      action is not a read: 403 local version_preview
//   4. a turn is running and the action writes: 423 source "held"
//   5. otherwise allowed. The app runs it on its own Connect grant, and
//      One's own refusal (blockedByGrant) comes back as source "one", or
//      "sample" on the keyless stub One.
//
// This replaces the old relay, which ran every preview call on a
// builder-level grant. Honest limit (stated in Access): the check is not a
// security boundary against the project's own code, which holds the dev
// token. The boundary that holds is the developer's grant to the app.

import { verbFor } from "./catalog/naming.js";
import type { CatalogService } from "./catalog/service.js";
import type { ActivityLedger } from "./activity.js";
import { makeReceipt } from "./receipts.js";
import type { ProjectRef, ScopeService } from "./scopes/service.js";
import type { ActivityRow, ManifestAction, Receipt, ReceiptSource, VisitorGrant } from "./types.js";
import { VISITORS_OFF } from "./visitors.js";

/** What the app's dev client sends before a call (no input values: the check needs only which action). */
export interface DevCheckBody {
  platform?: string;
  actionId?: string;
  method?: string;
  path?: string;
  title?: string;
  /** "owner": the template's one(c, { as: "owner" }), a visitor on the owner's grant. */
  as?: "user" | "owner";
}

/** What the app's dev client reports after a call it made. */
export interface DevReportBody extends DevCheckBody {
  status?: number;
  ok?: boolean;
  blockedByGrant?: boolean;
  ms?: number;
  /** The app's own refusal before One (not_connected, signed_out, owner_not_connected). */
  code?: string;
}

export type DevCheckAnswer =
  | { allow: true; level: string; source: ReceiptSource }
  | { allow: false; status: number; body: Record<string, unknown>; receipt: Receipt; row: ActivityRow };

export interface DevGateDeps {
  catalog: CatalogService;
  scopes: ScopeService;
  activity: ActivityLedger;
  /** The project's running turn, if any (writes are held while one runs). */
  activeTurn: (projectId: string) => Promise<{ id: string; status: string } | null>;
  /** The builder's visitor setting for the project (off when absent). */
  visitors?: (projectId: string) => Promise<VisitorGrant>;
  /** "one" live, "sample" on the stub One: the label One's refusals get. */
  kind: () => ReceiptSource;
}

const HOLD_STATUSES = new Set(["running", "settling", "verifying", "fixing"]);

/**
 * Query values as strings. A nested object becomes bracket keys, the form
 * Stripe and most REST APIs read (`due_date: { lt: 1700000000 }` is
 * `due_date[lt]=1700000000`); String() would have sent "[object Object]".
 */
export function queryStrings(q: Record<string, unknown> | undefined): Record<string, string | string[]> | undefined {
  if (!q) return undefined;
  const out: Record<string, string | string[]> = {};
  const put = (k: string, v: unknown) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) out[k] = v.map((x) => (x !== null && typeof x === "object" ? JSON.stringify(x) : String(x)));
    else if (typeof v === "object") for (const [sub, x] of Object.entries(v)) put(`${k}[${sub}]`, x);
    else out[k] = String(v);
  };
  for (const [k, v] of Object.entries(q)) put(k, v);
  return out;
}

export class DevGate {
  constructor(private d: DevGateDeps) {}

  private async receiptFor(platform: string, method: string, path: string, source: ReceiptSource, code: string, actionId: string | null): Promise<Receipt> {
    const name = await this.d.catalog.platformName(platform);
    return makeReceipt({ platformName: name, verb: verbFor({ method, path, platform }), source, code, platform, actionId });
  }

  private base(b: DevCheckBody) {
    const actionId = String(b.actionId ?? "");
    const known = this.d.catalog.cached(actionId);
    return {
      platform: String(b.platform ?? known?.connectionPlatform ?? ""),
      actionId,
      method: String(b.method ?? known?.method ?? "POST").toUpperCase(),
      path: String(b.path ?? known?.path ?? ""),
      title: String(b.title ?? known?.title ?? actionId),
    };
  }

  private async refuse(p: ProjectRef, b: ReturnType<DevGate["base"]>, status: number, source: "local" | "held", code: string, turnId: string | null, extra: Record<string, unknown> = {}): Promise<DevCheckAnswer> {
    const t0 = Date.now();
    const receipt = await this.receiptFor(b.platform, b.method, b.path, source, code, b.actionId);
    const refusal = { source, code, message: source === "held" ? "Writes pause while the agent works." : receipt.caption };
    const row = await this.d.activity.record(p.id, { ...b, source, status, ok: false, blockedByGrant: false, refusal, ms: Date.now() - t0, turnId });
    return { allow: false, status, receipt, row, body: { ok: false, status, source, blockedByGrant: false, refusal, ...extra } };
  }

  /**
   * May this call leave the computer? `version`: the call comes from a version
   * preview; its manifest is the one that version's files ask for (`path` is
   * the exported tree, `id` its own cache key). Activity rows go to the project.
   */
  async check(p: ProjectRef, body: DevCheckBody, o: { skipManifest?: boolean; version?: { id: string; path: string } } = {}): Promise<DevCheckAnswer> {
    const b = this.base(body);
    const active = await this.d.activeTurn(p.id);
    const turnId = active?.id ?? null;

    let entry: ManifestAction | undefined;
    if (!o.skipManifest) {
      const { manifest } = await this.d.scopes.derive(o.version ? { id: o.version.id, name: p.name, path: o.version.path } : p);
      entry = manifest.actions.find((a) => a.actionId === b.actionId);
      if (!entry) return this.refuse(p, b, 403, "local", "not_in_manifest", turnId, { blockedByManifest: true });
    }

    if (body.as === "owner" && !o.skipManifest) {
      const v = (await this.d.visitors?.(p.id).catch(() => VISITORS_OFF)) ?? VISITORS_OFF;
      const code = !v.enabled ? "visitors_off" : !v.actions.includes(b.actionId) ? "visitor_not_allowed" : null;
      if (code) return this.refuse(p, b, 403, "local", code, turnId);
    }

    const level = entry?.level ?? (b.method === "GET" ? "read" : "write");
    if (o.version && level !== "read") return this.refuse(p, b, 403, "local", "version_preview", turnId);
    if (active && HOLD_STATUSES.has(active.status) && level !== "read") return this.refuse(p, b, 423, "held", "held_during_build", turnId);
    return { allow: true, level, source: this.d.kind() };
  }

  /** The app ran a call (or refused it itself): one Activity row, and One's receipt when One refused it. */
  async report(p: ProjectRef, body: DevReportBody): Promise<{ row: ActivityRow; receipt: Receipt | null }> {
    const b = this.base(body);
    const active = await this.d.activeTurn(p.id);
    const status = Number.isInteger(body.status) ? Number(body.status) : 0;
    const ms = Number.isFinite(body.ms) ? Math.max(0, Math.round(Number(body.ms))) : null;
    if (body.code && body.ok !== true) {
      const receipt = await this.receiptFor(b.platform, b.method, b.path, "local", body.code, b.actionId);
      const row = await this.d.activity.record(p.id, { ...b, source: "local", status, ok: false, blockedByGrant: false, refusal: { source: "local", code: body.code, message: receipt.caption }, ms, turnId: active?.id ?? null });
      return { row, receipt };
    }
    const source = this.d.kind();
    if (body.blockedByGrant) {
      const receipt = await this.receiptFor(b.platform, b.method, b.path, source, "blocked_by_grant", b.actionId);
      const row = await this.d.activity.record(p.id, { ...b, source, status: 403, ok: false, blockedByGrant: true, refusal: { source, code: "blocked_by_grant", message: receipt.caption }, ms, turnId: active?.id ?? null });
      return { row, receipt };
    }
    const row = await this.d.activity.record(p.id, { ...b, source, status, ok: body.ok === true, blockedByGrant: false, ms, turnId: active?.id ?? null });
    return { row, receipt: null };
  }
}
