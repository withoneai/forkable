import type { Ctx, Recording, Writer, WriterCompletion } from "../../contract.js";
import { fixtures, isFixtureThreadId } from "../../fixtures.js";
import { ledger } from "../../ledger.js";

// Sample mailboxes replay the writer's recorded answers from
// fixtures/recorded/<threadId>.json. When a thread has no recording and a real
// writer is available (RECORD=1 or a local agent), the call falls through to
// it and, when recording, the answer is written back. With nothing to fall
// through to, the completion is a canned placeholder the caller recognizes.

export const NO_RECORDING = "No recording for this thread yet.";
export const isCanned = (text: string) => text.trim() === NO_RECORDING || text.includes(`"${NO_RECORDING}"`);

function recordedText(rec: Recording | null, key: string): string | null {
  if (!rec) return null;
  if (key === "summary" && rec.summary) return JSON.stringify(rec.summary);
  if (key === "draft" && typeof rec.draft === "string") return rec.draft;
  const extra = (rec as Record<string, unknown>)[key];
  if (typeof extra === "string") return extra;
  if (extra && typeof extra === "object") return JSON.stringify(extra);
  return null;
}

export function fixtureWriter(inner: Writer | null): Writer {
  return {
    engine: inner?.engine ?? "local",
    provider: inner?.provider ?? "recording",
    model: inner?.model ?? "recorded",
    async complete(ctx: Ctx, input): Promise<WriterCompletion> {
      const key = input.recordingKey;
      const started = Date.now();
      if (key) {
        const text = recordedText(fixtures.readRecording(ctx.env.ROOT, key.threadId), key.key);
        if (text !== null) {
          const ms = Date.now() - started;
          const row = await ledger.record(ctx.db, {
            mailboxId: ctx.mailbox.id,
            userId: ctx.user.id,
            platform: "recording",
            action: key.key,
            method: "READ",
            path: `fixtures/recorded/${key.threadId}.json`,
            mode: "fixture",
            level: "read",
            status: 200,
            ok: true,
            blockedByGrant: false,
            refusal: null,
            engine: "fixture",
            model: "recorded",
            ms,
            summary: input.summary,
            note: null,
          });
          try {
            ctx.emit({ type: "ledger", row });
          } catch {
            // closed stream
          }
          return { text, model: "recorded", costUsd: 0, ms };
        }
      }
      if (inner) {
        const out = await inner.complete(ctx, input);
        if (key && fixtures.recording(ctx.env) && isFixtureThreadId(key.threadId)) {
          const patch: Partial<Recording> & Record<string, unknown> = { writerModel: out.model };
          if (key.key === "summary") {
            try {
              const parsed = JSON.parse(out.text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as { summary?: string; ask?: string | null };
              if (typeof parsed.summary === "string") patch.summary = { summary: parsed.summary, ask: typeof parsed.ask === "string" ? parsed.ask : null };
            } catch {
              // not JSON: the caller will reject it; nothing to record
            }
          } else if (key.key === "draft") patch.draft = out.text;
          else patch[key.key] = out.text;
          fixtures.writeRecording(ctx.env.ROOT, key.threadId, patch);
        }
        return out;
      }
      const text = input.json ? JSON.stringify({ summary: NO_RECORDING, ask: null }) : NO_RECORDING;
      return { text, model: "recorded", costUsd: 0, ms: Date.now() - started };
    },
  };
}
