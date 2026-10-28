import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { ACTIONS, BY_ID, type FlowAction } from "./actions";
import { getThreads, sampleArchive } from "./sample/gmail";
import { listEvents } from "./sample/calendar";
import { getInvoices, listCharges, listSubscriptions } from "./sample/stripe";
import { getPullRequests } from "./sample/github";

// The page's stand-in for the blocks MCP server. A flow's UI calls
// runAction / useAction from "@forkable/ui" exactly as it would inside
// Claude or ChatGPT; here the call is answered from the Acme Inc sample
// instead of the user's grant. What stays the same as the real server:
// undeclared actions are refused, every write stops for a Confirm written
// by the host (not by the UI), and a cancelled write throws "cancelled".

export class ActionError extends Error {
  constructor(
    readonly status: number,
    readonly refused: string | null,
    message: string,
  ) {
    super(message);
  }
}

export type ActionInput = {
  query?: Record<string, string>;
  body?: unknown;
  pathParams?: Record<string, string | number | boolean>;
  headers?: Record<string, string>;
};

export type ConfirmRequest = { headline: string; platform: string; fields: { label: string; value: string }[] };

export type Host = {
  declared: Set<string>;
  confirm: (c: ConfirmRequest) => Promise<boolean>;
};

const HostCtx = createContext<Host | null>(null);

// runAction is a plain function (called from click handlers), so it uses the
// host the person last touched. useAction reads its own host from context.
let active: Host | null = null;

// Same wording rules as the server's summarize() in the blocks MCP.
export function summarize(action: FlowAction, input: ActionInput): ConfirmRequest {
  const body = input.body && typeof input.body === "object" ? (input.body as Record<string, unknown>) : {};
  const show = (v: unknown) => {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return s.length > 280 ? `${s.slice(0, 280)}…` : s;
  };
  const platform = action.platform.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  const fields: { label: string; value: string }[] = [];
  const pick = (label: string, ...keys: string[]) => {
    for (const k of keys) if (body[k] !== undefined && body[k] !== "") return void fields.push({ label, value: show(body[k]) });
  };
  if (action.platform === "gmail" && /send|draft/i.test(action.title + action.path)) {
    pick("To", "to");
    pick("Cc", "cc");
    pick("Subject", "subject");
    pick("Message", "body");
  }
  if (fields.length === 0) {
    for (const [k, v] of Object.entries({ ...input.pathParams, ...input.query, ...body })) {
      if (fields.length >= 8) continue;
      fields.push({ label: k, value: show(v) });
    }
  }
  const verb = /send/i.test(action.title + action.path) ? "Send" : /delete|remove|trash/i.test(action.title + action.path) ? "Delete" : "Run";
  return { headline: `${verb} with ${platform}: ${action.title}`, platform: action.platform, fields };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function answer(action: FlowAction, input: ActionInput): unknown {
  const body = (input.body ?? {}) as Record<string, any>;
  const query = input.query ?? {};
  switch (action.actionId) {
    case ACTIONS.gmailThreads.actionId:
      return getThreads(body);
    case ACTIONS.gmailSend.actionId:
    case ACTIONS.gmailDraft.actionId: {
      if (!body.to || !body.subject || !body.body) throw new ActionError(400, null, "to, subject and body are required");
      return { id: `sample-${Math.random().toString(36).slice(2, 10)}`, sample: true };
    }
    case ACTIONS.gmailBatchModify.actionId: {
      const ids = Array.isArray(body.ids) ? (body.ids as string[]) : [];
      if (!ids.length) throw new ActionError(400, null, "ids is required");
      if ((body.removeLabelIds ?? []).includes("INBOX")) sampleArchive(ids);
      return {};
    }
    case ACTIONS.calendarEvents.actionId:
      return listEvents(query);
    case ACTIONS.stripeCharges.actionId:
      return listCharges(query);
    case ACTIONS.stripeSubscriptions.actionId:
      return listSubscriptions(query);
    case ACTIONS.stripeInvoices.actionId:
      return getInvoices(body);
    case ACTIONS.githubPulls.actionId:
      return getPullRequests(body);
  }
  throw new ActionError(404, null, "Unknown action in the sample.");
}

export async function call(host: Host | null, actionId: string, input: ActionInput = {}): Promise<unknown> {
  const action = BY_ID[actionId];
  if (!host || !action || !host.declared.has(actionId)) {
    throw new ActionError(403, "not_declared", "This UI did not declare that action, so it cannot run it.");
  }
  if (action.write) {
    const ok = await host.confirm(summarize(action, input));
    if (!ok) throw new ActionError(409, "cancelled", "You cancelled, so nothing ran.");
  }
  await wait(action.write ? 450 : 350 + Math.random() * 350);
  return answer(action, input);
}

export async function runActionOnActiveHost(actionId: string, input: ActionInput = {}) {
  return call(active, actionId, input);
}

export function useHost() {
  return useContext(HostCtx);
}

// Wraps one rendered UI. The class scopes the canvas tokens (index.css), so
// the UI looks the way it does in the chat app's frame.
export function FlowHost({ declared, confirm, children }: { declared: string[]; confirm: Host["confirm"]; children: ReactNode }) {
  const confirmRef = useRef(confirm);
  confirmRef.current = confirm;
  const host = useMemo<Host>(() => ({ declared: new Set(declared), confirm: (c) => confirmRef.current(c) }), [declared.join("|")]);
  useEffect(() => {
    active ??= host;
    return () => {
      if (active === host) active = null;
    };
  }, [host]);
  const touch = () => {
    active = host;
  };
  return (
    <HostCtx.Provider value={host}>
      <div className="fk-canvas" onPointerDownCapture={touch} onFocusCapture={touch} onKeyDownCapture={touch}>
        {children}
      </div>
    </HostCtx.Provider>
  );
}
