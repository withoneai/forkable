import type { HarnessEvent, Usage } from "../types.js";
import { asCount } from "./util.js";

/**
 * `openclaw agent exec --json` prints one envelope when the turn ends:
 * ok, status (ok | error | timeout), final, payloads[{text}], usage
 * {input, output, total}, costUsd, model, provider, sessionId, error
 * {message, kind}. Nothing streams.
 */

export interface OpenClawEnvelope {
  ok: boolean;
  status: string;
  final: string;
  sessionId: string | null;
  usage: Usage | null;
  costUsd: number | null;
  model: string | null;
  error: { message: string; kind: string | null } | null;
}

/** The last top-level JSON object in stdout (log lines may come first). */
export function parseOpenClawEnvelope(stdout: string): OpenClawEnvelope | null {
  const text = stdout.trim();
  const candidates: number[] = [];
  for (let i = 0; i < text.length; i++) if (text[i] === "{" && (i === 0 || text[i - 1] === "\n")) candidates.push(i);
  for (const start of candidates.reverse()) {
    try {
      const o = JSON.parse(text.slice(start)) as Record<string, unknown>;
      return normalize(o);
    } catch {
      // not the envelope
    }
  }
  return null;
}

function normalize(o: Record<string, unknown>): OpenClawEnvelope {
  const u = (o.usage ?? null) as Record<string, unknown> | null;
  const payloads = Array.isArray(o.payloads) ? (o.payloads as { text?: unknown }[]) : [];
  const final =
    typeof o.final === "string" && o.final
      ? o.final
      : payloads.map((p) => (typeof p?.text === "string" ? p.text : "")).filter(Boolean).join("\n\n");
  const err = (o.error ?? null) as { message?: unknown; kind?: unknown } | null;
  return {
    ok: o.ok === true,
    status: typeof o.status === "string" ? o.status : o.ok === true ? "ok" : "error",
    final,
    sessionId: typeof o.sessionId === "string" ? o.sessionId : null,
    usage: u ? { input: asCount(u.input), output: asCount(u.output), cacheRead: asCount(u.cacheRead), cacheWrite: asCount(u.cacheWrite) } : null,
    costUsd: typeof o.costUsd === "number" && Number.isFinite(o.costUsd) ? o.costUsd : null,
    model: typeof o.model === "string" ? o.model : null,
    error: err ? { message: String(err.message ?? "OpenClaw failed"), kind: typeof err.kind === "string" ? err.kind : null } : null,
  };
}

export function openClawEvents(env: OpenClawEnvelope): HarnessEvent[] {
  const out: HarnessEvent[] = [];
  if (env.sessionId) out.push({ t: "session", id: env.sessionId });
  if (env.final) out.push({ t: "text", text: env.final });
  if (env.usage) out.push({ t: "usage", usage: env.usage, total: true });
  if (env.error) out.push({ t: "error", message: env.error.message });
  return out;
}

/** OpenClaw's own "runtime missing" message: the UI shows it with "Open OpenClaw setup". */
export function isOpenClawSetupError(message: string | null | undefined): boolean {
  return !!message && /harness runtime|plugin registration|not configured|no provider|credentials/i.test(message);
}
