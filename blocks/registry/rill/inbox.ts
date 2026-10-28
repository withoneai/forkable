import type { Context } from "hono";
import type { OneServer } from "../lib/one-server.js";
import { GMAIL } from "../gmail/actions.js";
import { fromHelper, type HelperThread } from "../gmail/map.js";
import type { MailThreadDetail } from "../gmail/types.js";
import { JEV } from "./actions.js";
import { rillConfig } from "./config.js";
import { buildJevRequest, noulOf, urgencyOf, type JevAnswers } from "./jev.js";
import { decideLane, vipFor } from "./policy.js";
import { RILL_SAMPLE } from "./sample.js";
import { LANES, type Goal, type Lane, type LaneThread, type LanesResponse, type Vip } from "./types.js";

// The judged inbox every Rill block reads: the user's threads from Gmail,
// one Jev request each on their grant, Rill's lane policy in code. Before a
// Connect app exists it is the Acme sample with Rill's recorded Jev answers,
// run through the same policy.

const FOLLOW_UP_DAYS = 3;
const cache = new Map<string, JevAnswers>(); // thread id + last message id -> answers, per process

export interface RillContext { me: string; address: string; teamDomain: string | null; goals: Goal[]; vips: Vip[] }

export async function judgedInbox(one: OneServer, c: Context, limit = 25): Promise<{ data: LanesResponse; meta: Awaited<ReturnType<OneServer["call"]>>["meta"]; ctx: RillContext; details: Map<string, MailThreadDetail> }> {
  const res = await one.call<{ threads?: HelperThread[] }>(c, {
    action: GMAIL.getThreads,
    body: { query: "in:inbox", numberOfThreads: limit, format: "full", maxBodyLength: 2000 },
    sample: () => ({ threads: [] }),
  });
  const details = new Map<string, MailThreadDetail>();

  if (res.meta.mode === "sample") {
    const ctx: RillContext = { me: RILL_SAMPLE.me, address: RILL_SAMPLE.address, teamDomain: RILL_SAMPLE.teamDomain, goals: RILL_SAMPLE.goals, vips: RILL_SAMPLE.vips };
    const now = Date.now();
    const threads = RILL_SAMPLE.threads.map((t) => {
      const msgs = t.messages.map((m) => ({ id: m.id, from: m.from, to: m.to, date: new Date(now - m.minutesAgo * 60_000).toISOString(), body: m.body, fromMe: m.from.email === ctx.address }));
      const last = msgs[msgs.length - 1]!;
      const lastIn = [...msgs].reverse().find((m) => !m.fromMe) ?? last;
      const detail: MailThreadDetail = { id: t.id, subject: t.subject, snippet: last.body.replace(/\s+/g, " ").slice(0, 160), from: lastIn.from, date: last.date, unread: t.messages.some((m) => m.labelIds.includes("UNREAD")), starred: false, inInbox: true, count: msgs.length, messages: msgs };
      details.set(t.id, detail);
      return toLaneThread(detail, t.jev, { firstTime: t.firstTimeSender, vip: vipFor(lastIn.from.email, ctx.vips), onTeam: isTeam(lastIn.from.email, ctx.teamDomain) }, ctx, t.summary?.summary ?? null);
    });
    return { data: summarize(threads, "recorded"), meta: res.meta, ctx, details };
  }

  // Live: the profile address, who you have written to, then Jev per thread.
  const ctx: RillContext = { ...rillConfig, address: "" };
  const mine = (res.data.threads ?? []).map((t) => fromHelper(t, "")).filter((t): t is MailThreadDetail => t !== null);
  const sent = await one.call<{ threads?: HelperThread[] }>(c, {
    action: GMAIL.getThreads,
    body: { query: "in:sent newer_than:180d", numberOfThreads: 100, format: "full", maxBodyLength: 200 },
    sample: () => ({ threads: [] }),
  });
  const wroteTo = new Set<string>();
  for (const t of sent.data.threads ?? []) for (const m of fromHelper(t, "")?.messages ?? []) for (const to of m.to) wroteTo.add(to.toLowerCase());

  const threads: LaneThread[] = [];
  const queue = [...mine];
  const worker = async () => {
    for (let t = queue.shift(); t; t = queue.shift()) {
      details.set(t.id, t);
      const last = t.messages[t.messages.length - 1]!;
      const lastIn = [...t.messages].reverse().find((m) => !m.fromMe) ?? last;
      const facts = { firstTime: !wroteTo.has(lastIn.from.email.toLowerCase()), vip: vipFor(lastIn.from.email, ctx.vips), onTeam: isTeam(lastIn.from.email, ctx.teamDomain) };
      const key = `${t.id}:${last.id}`;
      let answers = cache.get(key);
      if (!answers) {
        const req = buildJevRequest({
          me: ctx.me,
          mail: { from: lastIn.from, subject: t.subject, body: lastIn.body, hiddenText: "" },
          thread: t.messages.slice(0, -1).map((m) => `${m.from.name}: ${m.body.slice(0, 600)}`).join("\n\n"),
          facts: { first_time_sender: facts.firstTime, sender_is_vip: !!facts.vip, sender_on_team: facts.onTeam },
          goals: ctx.goals,
          vips: ctx.vips,
        });
        const j = await one.call<{ answers?: JevAnswers }>(c, { action: JEV.systemOne, body: req, sample: () => ({ answers: {} }) });
        answers = j.data.answers ?? {};
        cache.set(key, answers);
      }
      threads.push(toLaneThread(t, answers, facts, ctx, null));
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  threads.sort((a, b) => b.date.localeCompare(a.date));
  return { data: summarize(threads, "jev"), meta: res.meta, ctx, details };
}

const isTeam = (email: string, team: string | null) => !!team && email.toLowerCase().endsWith(`@${team.toLowerCase()}`);

function toLaneThread(t: MailThreadDetail, a: JevAnswers, facts: { firstTime: boolean; vip: Vip | null; onTeam: boolean }, ctx: RillContext, summary: string | null): LaneThread {
  const d = decideLane(a, facts, ctx.goals, ctx.vips);
  const last = t.messages[t.messages.length - 1];
  const followUp = !!last?.fromMe && Date.now() - new Date(last.date).getTime() >= FOLLOW_UP_DAYS * 864e5;
  return {
    id: t.id,
    subject: t.subject,
    snippet: t.snippet,
    from: t.from,
    date: t.date,
    unread: t.unread,
    lane: d.lane,
    rule: followUp ? `${d.rule}. You wrote last, ${Math.floor((Date.now() - new Date(last!.date).getTime()) / 864e5)} days ago` : d.rule,
    kind: d.kind,
    goal: d.goal ? { id: d.goal.id, title: d.goal.title } : null,
    vip: d.vip?.name ?? null,
    needsReply: noulOf(a, "needs_reply"),
    urgency: urgencyOf(a),
    summary,
    followUp,
  };
}

function summarize(threads: LaneThread[], judgedBy: LanesResponse["judgedBy"]): LanesResponse {
  const counts = Object.fromEntries(LANES.map((l) => [l, 0])) as Record<Lane, number>;
  for (const t of threads) counts[t.lane]++;
  return { judgedBy, counts, threads };
}
