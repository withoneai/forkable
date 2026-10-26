import { agents, prettyPath } from "../agents.js";
import type { AskResponse, BriefResponse, EngineOption, MeetingPrep } from "../api-types.js";
import type { Ctx, DetectedCli, RillEnv, Writer, WriterLayer } from "../contract.js";
import { fixtures } from "../fixtures.js";
import { one } from "../one.js";
import { BALLS, KINDS, type Ball, type JevAnswers, type Kind, type WriterEngine } from "../types.js";
import { fixtureWriter, isCanned } from "./engines/fixture.js";
import { localWriter, LOCAL_MODELS } from "./engines/local.js";
import { ONE_MODELS, oneWriter } from "./engines/one.js";
import { localModels, oneModels } from "./models.js";
import { askPrompt, briefPrompt, draftPrompt, jevFallbackPrompt, parseJsonObject, prepPrompt, summaryPrompt } from "./prompts.js";
import { validateDraft } from "./validate.js";

// The writer: one interface, three transports (a local coding agent, a model
// through One on the user's grant, the user's own model through Connect),
// the same prompts and the same validator everywhere. Sample mailboxes wrap
// whatever was picked in the fixture engine, which replays recordings first.

export { fixtureWriter, localWriter, oneWriter, validateDraft };

const LOCAL_META: Record<DetectedCli["id"], { name: string; install: string; signIn: string }> = {
  "claude-code": { name: "Claude Code", install: "npm install -g @anthropic-ai/claude-code", signIn: "claude" },
  codex: { name: "Codex", install: "npm install -g @openai/codex", signIn: "codex login" },
  "gemini-cli": { name: "Gemini CLI", install: "npm install -g @google/gemini-cli", signIn: "gemini" },
};
const ONE_META = {
  anthropic: { name: "Claude Sonnet", detail: "Anthropic through One, on your grant", cost: "est. $0.004 a draft", add: "Connect Anthropic in One and grant it to Rill" },
  openai: { name: "GPT", detail: "OpenAI through One, on your grant", cost: "est. $0.003 a draft", add: "Connect OpenAI in One and grant it to Rill" },
  gemini: { name: "Gemini", detail: "Google through One, on your grant", cost: "est. $0.002 a draft", add: "Connect Gemini in One and grant it to Rill" },
} as const;
type OneProvider = keyof typeof ONE_META;
const ONE_PROVIDERS = Object.keys(ONE_META) as OneProvider[];

export const connectConfigured = (env: RillEnv) => Boolean(env.ONE_CLIENT_ID && env.ONE_CLIENT_SECRET && env.ONE_CONNECT_KEY);
const oneAvailable = (granted: string[] | undefined, p: OneProvider) => Boolean(granted?.includes(p));

/** Which fixture writer wraps which inner writer, so fastVariant can reach through. */
const innerOf = new WeakMap<Writer, Writer | null>();

/** The cheaper model for summaries, same transport. */
export function fastVariant(w: Writer): Writer {
  const inner = innerOf.get(w);
  if (inner !== undefined) {
    const f = fixtureWriter(inner ? fastVariant(inner) : null);
    innerOf.set(f, inner ? fastVariant(inner) : null);
    return f;
  }
  const table = (w.engine === "local" ? LOCAL_MODELS : ONE_MODELS) as Record<string, { draft: string; fast: string }>;
  const m = table[w.provider];
  if (!m || w.model !== m.draft) return w;
  return { ...w, model: m.fast };
}

function wrapSample(w: Writer | null): Writer {
  const f = fixtureWriter(w);
  innerOf.set(f, w);
  return f;
}

export async function meOf(ctx: Ctx): Promise<string> {
  if (ctx.settings.me) return ctx.settings.me;
  if (ctx.mailbox.source === "sample") return fixtures.loadInbox(ctx.env.ROOT).me;
  return ctx.user.name ?? ctx.user.email ?? ctx.mailbox.address ?? "me";
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const cap = (v: unknown, max: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(max, v)) : d);

export const writer: WriterLayer = {
  async detectEngines(env, granted) {
    const options: EngineOption[] = [];
    if (env.LOCAL) {
      const clis = await agents.detect();
      for (const id of Object.keys(LOCAL_META) as DetectedCli["id"][]) {
        const cli = clis.find((c) => c.id === id);
        const meta = LOCAL_META[id];
        if (!cli?.bin) {
          options.push({ id, group: "local", name: meta.name, detail: "Not found on this machine", status: "missing", cost: "Your subscription", install: meta.install });
        } else if (cli.signedIn === false) {
          options.push({ id, group: "local", name: meta.name, detail: `Found at ${prettyPath(cli.bin)} · sign in to use it`, status: "signed_out", cost: "Your subscription", install: meta.signIn });
        } else {
          const bits = [`Found at ${prettyPath(cli.bin)}`, cli.version ? `v${cli.version}` : null, "tool-less mode"].filter(Boolean);
          options.push({ id, group: "local", name: meta.name, detail: bits.join(" · "), status: "ready", cost: "Your subscription", model: LOCAL_MODELS[id].draft, models: localModels(id, cli.bin) });
        }
      }
    }
    const claudeBin = env.LOCAL ? ((await agents.detect()).find((c) => c.id === "claude-code")?.bin ?? null) : null;
    for (const p of ONE_PROVIDERS) {
      const meta = ONE_META[p];
      const ok = oneAvailable(granted, p);
      options.push({
        id: `one-${p}`,
        group: "one",
        name: meta.name,
        detail: ok ? meta.detail : meta.add,
        status: ok ? "available" : "unavailable",
        cost: meta.cost,
        model: ONE_MODELS[p].draft,
        ...(ok ? { models: oneModels(p, claudeBin) } : {}),
      });
    }
    const connect = connectConfigured(env);
    options.push({
      id: "connect-own",
      group: "connect",
      name: "Connect your Anthropic, OpenAI or Gemini",
      detail: connect ? "Custom access: generate only. Owned in your One account" : "Connect is not configured on this server",
      status: connect ? "available" : "unavailable",
      cost: "Your account",
    });
    return options;
  },

  async pickWriter(ctx, detected) {
    const env = ctx.env;
    const build = async (engine: string | null | undefined, provider: string | null | undefined, model: string | null | undefined): Promise<Writer | null> => {
      if (engine === "local") {
        if (!env.LOCAL) return null;
        const ready = detected.filter((o) => o.group === "local" && o.status === "ready");
        const pick = provider ? ready.find((o) => o.id === provider) : ready[0];
        if (!pick) return null;
        const cli = (await agents.detect()).find((c) => c.id === pick.id);
        if (!cli?.bin) return null;
        return localWriter({ id: cli.id, bin: cli.bin }, model || undefined);
      }
      if (engine === "one") {
        const p = (provider || "anthropic") as OneProvider;
        if (p !== "anthropic") return null; // openai and gemini through One are not wired yet
        const granted = [...(await one.grantedConnections(ctx.oneConnect, ctx.user.id)).keys()];
        if (!oneAvailable(granted, p)) return null;
        return oneWriter(p, model || undefined);
      }
      return null; // connect: the user's own model is not wired yet
    };
    let w: Writer | null = null;
    const s = ctx.settings;
    if (s.writerEngine) w = await build(s.writerEngine, s.writerProvider, s.writerModel);
    if (!w && env.AI_ENGINE) w = await build(env.AI_ENGINE, env.AI_PROVIDER, env.AI_MODEL);
    if (!w) w = await build("local", null, null);
    if (!w) w = await build("one", "anthropic", null);
    return ctx.mailbox.source === "sample" ? wrapSample(w) : w;
  },

  async summarize(ctx, w, mail, thread) {
    const me = await meOf(ctx);
    const p = summaryPrompt(mail, thread, me);
    const out = await fastVariant(w).complete(ctx, {
      system: p.system,
      user: p.user,
      json: true,
      maxTokens: p.maxTokens,
      summary: `Summarize "${clip(mail.subject || "(no subject)", 50)}"`,
      recordingKey: { threadId: thread.id, key: "summary" },
    });
    try {
      const j = parseJsonObject<{ summary?: unknown; ask?: unknown }>(out.text);
      const summary = typeof j.summary === "string" ? j.summary.trim() : "";
      if (!summary) throw new Error("no summary");
      return { summary: clean(summary), ask: typeof j.ask === "string" && j.ask.trim() ? clean(j.ask.trim()) : null };
    } catch {
      return { summary: clean(clip(out.text.replace(/\s+/g, " ").trim(), 300)), ask: null };
    }
  },

  async draft(ctx, w, input) {
    let last: { body: string; validator: { ok: boolean; reasons: string[] } } = { body: "", validator: { ok: false, reasons: ["not attempted"] } };
    for (let attempt = 0; attempt < 2; attempt++) {
      const p = draftPrompt(input, ctx.mailbox.address, attempt === 0 ? undefined : last.validator.reasons);
      const out = await w.complete(ctx, {
        system: p.system,
        user: p.user,
        json: false,
        maxTokens: p.maxTokens,
        summary: `${attempt === 0 ? "Draft" : "Redraft"} reply to ${input.mail.from.name || input.mail.from.email}`,
        recordingKey: attempt === 0 ? { threadId: input.thread.id, key: "draft" } : undefined,
      });
      const body = out.text.trim();
      if (isCanned(body)) return { body, validator: { ok: false, reasons: ["no recording for this thread"] } };
      last = { body, validator: validateDraft(body, input.mail.body) };
      if (last.validator.ok) return last;
      if (out.model === "recorded") return last; // a recording is replayed as is
    }
    return last;
  },

  async brief(ctx, w, input) {
    const kpis = briefKpis(input);
    const p = briefPrompt(input);
    const known = new Set([...input.vipsWaiting, ...input.goalMoves, ...input.repliesOwed, ...input.followUps].map((x) => x.threadId));
    const fallbackLines = codeLines(input);
    let lines = fallbackLines;
    let text = fallbackText(input);
    let model = w.model;
    const empty = known.size === 0;
    if (!empty) {
      try {
        const out = await w.complete(ctx, { system: p.system, user: p.user, json: true, maxTokens: p.maxTokens, summary: `Write the brief for ${input.forDate}`, recordingKey: { threadId: `brief-${input.forDate}`, key: "brief" } });
        model = out.model;
        const j = parseJsonObject<{ lines?: unknown; text?: unknown }>(out.text);
        if (Array.isArray(j.lines)) {
          const parsed = j.lines
            .filter((l): l is Record<string, unknown> => Boolean(l) && typeof l === "object")
            .map((l) => ({
              when: String(l.when ?? "").slice(0, 40),
              title: clean(String(l.title ?? "").slice(0, 120)),
              detail: clean(String(l.detail ?? "").slice(0, 240)),
              tone: (["neutral", "positive", "warning", "negative"] as const).find((t) => t === l.tone) ?? "neutral",
              threadId: typeof l.threadId === "string" && known.has(l.threadId) ? l.threadId : undefined,
            }))
            .filter((l) => l.title)
            .slice(0, 8);
          if (parsed.length) lines = parsed;
        }
        if (typeof j.text === "string" && j.text.trim()) text = clean(j.text.trim());
      } catch {
        // the code-built lines stand
      }
    }
    const res: BriefResponse = { forDate: input.forDate, generatedAt: new Date().toISOString(), kpis, lines, text, engine: w.engine, model, today: todayOf(input) };
    return res;
  },

  async ask(ctx, w, q, evidence) {
    const me = await meOf(ctx);
    const p = askPrompt(q, evidence, me);
    if (evidence.length === 0) {
      return { answer: "Nothing in the inbox matches that question yet.", citations: [], engine: w.engine, model: w.model };
    }
    const out = await w.complete(ctx, { system: p.system, user: p.user, json: true, maxTokens: p.maxTokens, summary: `Ask: "${clip(q, 50)}"` });
    const res: AskResponse = { answer: "", citations: [], engine: w.engine, model: out.model };
    try {
      const j = parseJsonObject<{ answer?: unknown; citations?: unknown }>(out.text);
      res.answer = clean(typeof j.answer === "string" ? j.answer.trim() : clip(out.text, 600));
      if (Array.isArray(j.citations)) {
        for (const c of j.citations) {
          if (!c || typeof c !== "object") continue;
          const tid = String((c as Record<string, unknown>).threadId ?? "");
          const ev = evidence.find((e) => e.threadId === tid);
          if (!ev) continue;
          res.citations.push({ threadId: tid, subject: ev.subject, from: ev.from, date: ev.date, quote: clip(String((c as Record<string, unknown>).quote ?? "").trim(), 300) });
        }
      }
    } catch {
      res.answer = clean(clip(out.text.trim(), 600));
    }
    return res;
  },

  async judgeFallback(ctx, w, input) {
    const p = jevFallbackPrompt(input);
    const out = await w.complete(ctx, { system: p.system, user: p.user, json: true, maxTokens: p.maxTokens, summary: `Writer judges "${clip(input.mail.subject || "(no subject)", 50)}"` });
    const j = parseJsonObject<Record<string, unknown>>(out.text);
    const n = (v: unknown, d = 0.5) => cap(v, 1, d);
    const conf = (v: unknown) => Math.min(0.6, cap(v, 1, 0.6));
    const choice = <T extends string>(v: unknown, allowed: readonly T[], d: T, c: unknown) => {
      const ch = allowed.includes(String(v) as T) ? (String(v) as T) : d;
      const confidence = conf(c);
      return { choice: ch, confidence, probabilities: { [ch]: confidence } as Record<string, number> };
    };
    const goalIds = [...input.goals.map((g) => g.id), "none"];
    const vipByDescription: Record<string, number> = {};
    for (const v of input.vips) {
      if (v.matchKind !== "description") continue;
      const val = j[`vip_${v.id}`];
      if (typeof val === "number") vipByDescription[v.id] = Math.min(0.8, n(val, 0));
    }
    const hasHidden = input.mail.hiddenText.trim().length > 0;
    const answers: JevAnswers = {
      screen: {
        agentAddressed: n(j.inj_agent_addressed, 0),
        override: n(j.inj_override, 0),
        actionRequest: n(j.inj_action_request, 0),
        hidden: hasHidden ? n(j.inj_hidden, 0) : null,
        inviteSpam: input.facts.calendarInvite ? n(j.invite_spam, 0) : null,
      },
      kind: choice<Kind>(j.kind, KINDS, "person", j.kind_confidence),
      goal: input.goals.length ? choice(j.goal, goalIds, "none", j.goal_confidence) : { choice: "none", confidence: 1, probabilities: { none: 1 } },
      needsReply: capNoul(n(j.needs_reply)),
      ball: choice<Ball>(j.ball, BALLS, "nobody", j.ball_confidence),
      urgency: { score: Math.round(cap(j.urgency, 3, 1)), confidence: 0.6 },
      vipByDescription,
      commitment: capNoul(n(j.commitment, 0)),
      model: `${w.provider}/${out.model}`,
      inputTokens: 0,
    };
    return answers;
  },

  async prep(ctx, w, input) {
    const me = await meOf(ctx);
    const p = prepPrompt(input, me);
    const generatedAt = new Date().toISOString();
    const fallback: MeetingPrep = {
      attendees: input.attendees.map((a) => ({ name: a.name, email: a.email, vip: a.vip, lastThread: a.lastThread, asks: [] })),
      goal: input.goal,
      text: `${input.attendees.length} ${input.attendees.length === 1 ? "attendee" : "attendees"}${input.goal ? `. Moves "${input.goal.title}".` : "."}`,
      citations: [],
      generatedAt,
    };
    try {
      const out = await w.complete(ctx, { system: p.system, user: p.user, json: true, maxTokens: p.maxTokens, summary: `Prep for "${input.title}"` });
      const j = parseJsonObject<{ text?: unknown; attendeeNotes?: unknown }>(out.text);
      const notes = new Map<string, string[]>();
      if (Array.isArray(j.attendeeNotes)) {
        for (const n of j.attendeeNotes) {
          if (!n || typeof n !== "object") continue;
          const email = String((n as Record<string, unknown>).email ?? "").toLowerCase();
          const asks = (n as Record<string, unknown>).asks;
          if (email && Array.isArray(asks)) notes.set(email, asks.filter((a): a is string => typeof a === "string").slice(0, 2));
        }
      }
      return {
        attendees: input.attendees.map((a) => ({ name: a.name, email: a.email, vip: a.vip, lastThread: a.lastThread, asks: notes.get(a.email.toLowerCase()) ?? [] })),
        goal: input.goal,
        text: typeof j.text === "string" && j.text.trim() ? clean(j.text.trim()) : fallback.text,
        citations: [],
        generatedAt,
      };
    } catch {
      return fallback;
    }
  },

  validateDraft,
};

/** Keeps a Noul's implied confidence (|p-0.5|*2) at or below 0.6. */
function capNoul(p: number): number {
  return Math.max(0.2, Math.min(0.8, p));
}

function clean(s: string): string {
  return s.replace(/—/g, ", ").replace(/–/g, ", ").replace(/\s+,/g, ",").replace(/!/g, ".").trim();
}

function briefKpis(input: Parameters<WriterLayer["brief"]>[2]): BriefResponse["kpis"] {
  const oldest = input.vipsWaiting[0]?.age;
  const goalsTouched = new Set(input.goalMoves.map((g) => g.goalTitle)).size;
  const drafted = input.repliesOwed.filter((r) => r.hasDraft).length;
  return [
    { label: "Meetings today", value: input.today.length, hint: nextMeetingHint(input.today) },
    { label: "VIPs waiting", value: input.vipsWaiting.length, hint: oldest ? `oldest ${oldest}` : "none waiting" },
    { label: "Moves a goal", value: input.goalMoves.length, hint: `${goalsTouched} ${goalsTouched === 1 ? "goal" : "goals"}` },
    { label: "Replies owed", value: input.repliesOwed.length, hint: `${drafted} drafted` },
    { label: "Follow-ups due", value: input.followUps.length, hint: input.followUps.length ? "you wrote last" : "nothing overdue" },
    { label: "Screened out", value: input.screenedOut, hint: "kept out of your lanes" },
  ];
}

function nextMeetingHint(today: Parameters<WriterLayer["brief"]>[2]["today"]): string {
  const next = today.find((m) => new Date(m.end).getTime() > Date.now());
  if (!next) return today.length ? "all done for today" : "nothing on the calendar";
  return `next at ${new Date(next.start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: next.timeZone ?? undefined })}`;
}

function todayOf(input: Parameters<WriterLayer["brief"]>[2]): BriefResponse["today"] {
  const meetings = input.today;
  const invitesWaiting = meetings.filter((m) => m.needsRsvp).length;
  const conflicts: { a: string; b: string; start: string }[] = [];
  for (let i = 0; i < meetings.length; i++) {
    for (let j = i + 1; j < meetings.length; j++) {
      if (new Date(meetings[j]!.start) >= new Date(meetings[i]!.end)) break;
      conflicts.push({ a: meetings[i]!.title, b: meetings[j]!.title, start: meetings[j]!.start });
    }
  }
  return { meetings, invitesWaiting, conflicts };
}

function codeLines(input: Parameters<WriterLayer["brief"]>[2]): BriefResponse["lines"] {
  const lines: BriefResponse["lines"] = [];
  for (const v of input.vipsWaiting.slice(0, 3)) lines.push({ when: "VIP", title: `${v.from}: ${v.subject}`, detail: v.hasDraft ? `Waiting ${v.age}. Draft ready.` : `Waiting ${v.age}.`, tone: "warning", threadId: v.threadId });
  for (const g of input.goalMoves.slice(0, 3)) lines.push({ when: g.goalTitle, title: g.subject, detail: g.summary ?? `From ${g.from}.`, tone: "neutral", threadId: g.threadId });
  for (const r of input.repliesOwed.slice(0, 2)) lines.push({ when: "Reply", title: `${r.from}: ${r.subject}`, detail: r.hasDraft ? "Draft ready." : "No draft yet.", tone: "neutral", threadId: r.threadId });
  for (const f of input.followUps.slice(0, 2)) lines.push({ when: "Follow up", title: `No reply from ${f.to} in ${f.daysSilent} days`, detail: f.subject, tone: "neutral", threadId: f.threadId });
  return lines.slice(0, 8);
}

function fallbackText(input: Parameters<WriterLayer["brief"]>[2]): string {
  const parts: string[] = [];
  parts.push(input.vipsWaiting.length ? `${input.vipsWaiting.length} VIP ${input.vipsWaiting.length === 1 ? "thread is" : "threads are"} waiting on you.` : "No VIP is waiting on you.");
  if (input.goalMoves.length) parts.push(`${input.goalMoves.length} ${input.goalMoves.length === 1 ? "email moves" : "emails move"} a goal.`);
  if (input.repliesOwed.length) parts.push(`You owe ${input.repliesOwed.length} ${input.repliesOwed.length === 1 ? "reply" : "replies"}, ${input.repliesOwed.filter((r) => r.hasDraft).length} drafted.`);
  if (input.followUps.length) parts.push(`${input.followUps.length} follow-${input.followUps.length === 1 ? "up is" : "ups are"} due.`);
  if (input.screenedOut) parts.push(`${input.screenedOut} ${input.screenedOut === 1 ? "sender" : "senders"} screened out.`);
  return parts.join(" ");
}

export type { WriterEngine };
