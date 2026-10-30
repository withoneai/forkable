import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { DecideInput, Policy, PolicyLayer } from "./contract.js";
import { screenOf } from "./jev.js";
import { DEFAULT_THRESHOLDS, type Decision, type Kind, type Lane, LANES, type Thresholds, type VipTier } from "./types.js";

// INBOX.md is the policy. This file compiles its bullets into rules and runs
// them: first matching lane wins, the priority formula adds up, the Check
// badge shows when the deciding judgment is shaky. Jev never reads INBOX.md;
// it answers questions, this file decides what the answers mean. An unknown
// bullet is an error with its line number, never a silent default.

// ---- compiled shape ------------------------------------------------------------

type Cond =
  | { kind: "firstTime" }
  | { kind: "notVip" }
  | { kind: "notTeam" }
  | { kind: "team" }
  | { kind: "notScreened" }
  | { kind: "screenedOut"; not: boolean }
  | { kind: "senderVip" }
  | { kind: "vipOnThread" }
  | { kind: "goal"; threshold: number | null }
  | { kind: "needsReply"; threshold: number | null }
  | { kind: "ballMe" }
  | { kind: "meSentLast" }
  | { kind: "isKind"; value: Kind; not: boolean }
  | { kind: "always" };

interface LaneRule { lane: Lane; rule: string; groups: Cond[][]; line: number }

export interface CompiledPolicy extends Policy {
  me: string | null;
  laneRules: LaneRule[];
  screening: { quarantine: number | null; strip: number | null; screenedOutNeverJudged: boolean };
  priority: { goalMultiplier: number; tier: Record<VipTier, number>; urgency: [number, number, number, number]; needsReply: number; meetingSoon: number; kind: Partial<Record<Kind, number>> };
  check: { threshold: number | null; keepLane: boolean };
  drafts: { whenNeedsReply: boolean; respectNeverDraft: boolean; neverSend: boolean };
  followUp: { days: number; businessDays: boolean; vipCanOverride: boolean };
  /** Thresholds INBOX.md states; settings can still override them. */
  thresholds: Partial<Thresholds>;
}

const KIND_WORDS: [RegExp, Kind][] = [
  [/\bcold[- ]pitch(es)?\b/, "cold_pitch"],
  [/\bnewsletters?\b/, "newsletter"],
  [/\breceipts?\b/, "receipt"],
  [/\bnotifications?\b/, "notification"],
  [/\bcalendar( invites?| invitations?)?\b/, "calendar"],
  [/\b(a )?person\b/, "person"],
];

const num = (s: string): number | null => {
  const m = s.match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
};
const nums = (s: string): number[] => (s.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);

function fail(line: number, text: string): never {
  throw new Error(`INBOX.md line ${line}: cannot read "${text}"`);
}

function clean(s: string): string {
  return s
    .replace(/\([^)]*\)/g, " ")
    .replace(/[.!]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// ---- lane conditions -------------------------------------------------------------

function parseClause(raw: string, line: number, original: string): Cond | { modifier: number } {
  const c = raw.replace(/^(and|or)\s+/, "").trim();
  if (!c) return fail(line, original);
  let m: RegExpMatchArray | null;
  if ((m = c.match(/^(?:with )?(?:a )?probability (?:of )?at least ([\d.]+)$/)) || (m = c.match(/^at least ([\d.]+)$/))) return { modifier: Number(m[1]) };
  if (/^(a )?first[- ]time sender$/.test(c)) return { kind: "firstTime" };
  if (/^not (a )?vip$/.test(c) || /^(the )?sender is not a vip$/.test(c)) return { kind: "notVip" };
  if (/^not on my team$/.test(c) || /^(the )?sender is not on my team$/.test(c)) return { kind: "notTeam" };
  if (/^on my team$/.test(c) || /^(the )?sender is on my team$/.test(c)) return { kind: "team" };
  if (/^not screened( yet)?$/.test(c) || /^not (yet )?(let in or )?screened( out)?( yet)?$/.test(c)) return { kind: "notScreened" };
  if (/^(the )?sender is screened out$/.test(c) || /^screened out$/.test(c)) return { kind: "screenedOut", not: false };
  if (/^(the )?sender is not screened out$/.test(c) || /^not screened out$/.test(c)) return { kind: "screenedOut", not: true };
  if (/^(the )?sender is a vip$/.test(c) || /^(a )?vip$/.test(c) || /^from a vip$/.test(c)) return { kind: "senderVip" };
  if (/^a vip is on the thread$/.test(c) || /^a vip is in the thread$/.test(c) || /^any vip on the thread$/.test(c)) return { kind: "vipOnThread" };
  if ((m = c.match(/^(?:moves a goal|goal probability|goal match|matches a goal)(?: (?:of )?at least ([\d.]+))?$/))) return { kind: "goal", threshold: m[1] ? Number(m[1]) : null };
  if ((m = c.match(/^needs a reply(?: from me)?(?:,? probability (?:of )?at least ([\d.]+))?$/))) return { kind: "needsReply", threshold: m[1] ? Number(m[1]) : null };
  if (/^the ball is with me$/.test(c) || /^my move$/.test(c) || /^ball with me$/.test(c)) return { kind: "ballMe" };
  if (/^i wrote last$/.test(c) || /^me sent last$/.test(c)) return { kind: "meSentLast" };
  if (/^everything else$/.test(c) || /^anything else$/.test(c) || /^the rest$/.test(c) || /^otherwise$/.test(c)) return { kind: "always" };
  const not = /^not (a |an )?/.test(c);
  const kindText = c.replace(/^not (a |an )?/, "").replace(/^(a |an )/, "").replace(/^(it is |kind is |kind )/, "");
  for (const [re, value] of KIND_WORDS) {
    if (re.test(kindText) && kindText.split(" ").length <= 3) return { kind: "isKind", value, not };
  }
  return fail(line, original);
}

function parseLaneConditions(text: string, line: number, original: string): Cond[][] {
  const groups: Cond[][] = [[]];
  const re = /\s*,\s*(or\s+|and\s+)?|\s+(or|and)\s+/g;
  let last = 0;
  let orBefore = false;
  let m: RegExpExecArray | null;
  const push = (clause: string, or: boolean) => {
    const t = clause.trim();
    if (!t) return;
    if (or) groups.push([]);
    const parsed = parseClause(t, line, original);
    const group = groups[groups.length - 1]!;
    if ("modifier" in parsed) {
      const prev = group[group.length - 1] ?? groups[groups.length - 2]?.slice(-1)[0];
      if (!prev || (prev.kind !== "goal" && prev.kind !== "needsReply")) return fail(line, original);
      prev.threshold = parsed.modifier;
      return;
    }
    group.push(parsed);
  };
  while ((m = re.exec(text))) {
    push(text.slice(last, m.index), orBefore);
    orBefore = /or/.test(m[1] ?? m[2] ?? "");
    last = m.index + m[0].length;
  }
  push(text.slice(last), orBefore);
  // "a calendar invitation, a receipt, a newsletter or a notification": kinds are
  // mutually exclusive, so a comma list of kinds can only mean "any of these".
  const normalized: Cond[][] = [];
  for (const g of groups.filter((x) => x.length > 0)) {
    const allKinds = g.length > 1 && g.every((c) => c.kind === "isKind" && !c.not);
    if (allKinds) for (const c of g) normalized.push([c]);
    else normalized.push(g);
  }
  return normalized;
}

// ---- compile ---------------------------------------------------------------------

type Section = "lanes" | "screening" | "priority" | "check" | "drafts" | "followups" | "me" | "other";

function sectionOf(heading: string): Section {
  const h = heading.toLowerCase();
  if (h.startsWith("lanes")) return "lanes";
  if (h.startsWith("screening")) return "screening";
  if (h.startsWith("priority")) return "priority";
  if (h.includes("check")) return "check";
  if (h.startsWith("drafts")) return "drafts";
  if (h.startsWith("follow")) return "followups";
  if (h.startsWith("who i am")) return "me";
  return "other";
}

const tierWords: [RegExp, VipTier][] = [
  [/inner( circle)?/, "inner"],
  [/key( account)?/, "key"],
  [/team/, "team"],
];

export function compileInbox(markdown: string): CompiledPolicy {
  const policy: CompiledPolicy = {
    lanes: [],
    source: markdown,
    me: null,
    laneRules: [],
    screening: { quarantine: null, strip: null, screenedOutNeverJudged: false },
    priority: { goalMultiplier: 5, tier: { inner: 0, key: 0, team: 0 }, urgency: [0, 0, 0, 0], needsReply: 0, meetingSoon: 0, kind: {} },
    check: { threshold: null, keepLane: true },
    drafts: { whenNeedsReply: false, respectNeverDraft: true, neverSend: true },
    followUp: { days: 3, businessDays: false, vipCanOverride: true },
    thresholds: {},
  };
  const lines = markdown.split(/\r?\n/);
  let section: Section = "other";
  const meLines: string[] = [];
  lines.forEach((rawLine, i) => {
    const n = i + 1;
    const line = rawLine.trimEnd();
    const h = line.match(/^##\s+(.*)$/);
    if (h) {
      section = sectionOf(h[1]!.trim());
      return;
    }
    if (section === "me") {
      if (line.trim() && !line.startsWith("#")) meLines.push(line.trim());
      return;
    }
    const b = line.match(/^\s*[-*]\s+(.*)$/);
    if (!b) return;
    const text = b[1]!.trim();
    const c = clean(text);
    switch (section) {
      case "lanes": {
        const m = text.match(/^([a-z]+)\s*:\s*(.+)$/i);
        const lane = m?.[1]?.toLowerCase() as Lane | undefined;
        if (!m || !lane || !(LANES as readonly string[]).includes(lane)) return fail(n, text);
        const rule = m[2]!.trim();
        const groups = parseLaneConditions(clean(rule), n, text);
        policy.laneRules.push({ lane, rule, groups, line: n });
        policy.lanes.push({ lane, rule });
        for (const g of groups) for (const cond of g) {
          if (cond.kind === "goal" && cond.threshold !== null) policy.thresholds.goal = cond.threshold;
          if (cond.kind === "needsReply" && cond.threshold !== null) policy.thresholds.needsReply = cond.threshold;
        }
        return;
      }
      case "screening": {
        const v = num(c);
        if (/^quarantine\b/.test(c) && v !== null) {
          policy.screening.quarantine = v;
          policy.thresholds.quarantine = v;
          return;
        }
        if (/^strip\b/.test(c) && v !== null) {
          policy.screening.strip = v;
          policy.thresholds.strip = v;
          return;
        }
        if (/screened[- ]out sender/.test(c) && /never judged/.test(c)) {
          policy.screening.screenedOutNeverJudged = true;
          return;
        }
        return fail(n, text);
      }
      case "priority": {
        if (/^goal weight/.test(c)) {
          const all = nums(c);
          const mult = all.length ? all[all.length - 1]! : null;
          if (mult === null) return fail(n, text);
          policy.priority.goalMultiplier = mult;
          return;
        }
        if (/^vip tier/.test(c)) {
          let any = false;
          for (const [re, tier] of tierWords) {
            const m = c.match(new RegExp(`${re.source}\\s+(\\d+(?:\\.\\d+)?)`));
            if (m) {
              policy.priority.tier[tier] = Number(m[m.length - 1]);
              any = true;
            }
          }
          if (!any) return fail(n, text);
          return;
        }
        if (/^urgency/.test(c)) {
          const pick = (re: RegExp) => {
            const m = c.match(new RegExp(`${re.source}\\s+(\\d+(?:\\.\\d+)?)`));
            return m ? Number(m[m.length - 1]) : null;
          };
          const hour = pick(/within the hour/);
          const today = pick(/today/);
          const week = pick(/this week/);
          if (hour === null && today === null && week === null) return fail(n, text);
          policy.priority.urgency = [0, week ?? 0, today ?? 0, hour ?? 0];
          return;
        }
        if (/meeting with them/.test(c)) {
          const v = num(c.replace(/\b48 hours\b|\bnext \d+ hours\b/, ""));
          if (v === null) return fail(n, text);
          policy.priority.meetingSoon = v;
          return;
        }
        if (/^needs a reply/.test(c)) {
          const v = num(c);
          if (v === null) return fail(n, text);
          policy.priority.needsReply = /loses|minus|subtracts/.test(c) ? -v : v;
          return;
        }
        {
          const v = num(c);
          const sign = /loses|minus|subtracts/.test(c) ? -1 : /adds|plus|gains/.test(c) ? 1 : 0;
          if (v === null || sign === 0) return fail(n, text);
          let any = false;
          for (const [re, kind] of KIND_WORDS) {
            if (re.test(c)) {
              policy.priority.kind[kind] = sign * v;
              any = true;
            }
          }
          if (!any) return fail(n, text);
          return;
        }
      }
      case "check": {
        if (/within [\d.]+ of its (line|threshold)/.test(c)) {
          const v = num(c);
          if (v === null) return fail(n, text);
          policy.thresholds.checkBand = v;
          return;
        }
        if (/^show it when/.test(c) || /below [\d.]+ confidence/.test(c)) {
          const v = num(c);
          if (v === null) return fail(n, text);
          policy.check.threshold = v;
          policy.thresholds.check = v;
          return;
        }
        if (/never file silently/.test(c) || /keeps its lane/.test(c)) {
          policy.check.keepLane = true;
          return;
        }
        return fail(n, text);
      }
      case "drafts": {
        if (/^write a draft when a reply is needed/.test(c)) {
          policy.drafts.whenNeedsReply = true;
          return;
        }
        if (/^never write a draft for a vip/.test(c)) {
          policy.drafts.respectNeverDraft = true;
          return;
        }
        if (/^never send\b/.test(c)) {
          policy.drafts.neverSend = true;
          return;
        }
        return fail(n, text);
      }
      case "followups": {
        if (/^when i wrote last/.test(c)) {
          const v = num(c);
          if (v === null) return fail(n, text);
          policy.followUp.days = v;
          policy.followUp.businessDays = /business days?/.test(c);
          return;
        }
        if (/^a vip rule can (shorten|lengthen|change|override)/.test(c)) {
          policy.followUp.vipCanOverride = true;
          return;
        }
        return fail(n, text);
      }
      default:
        return;
    }
  });
  policy.me = meLines.length ? meLines.join(" ").split(/\.\s/)[0]!.replace(/\.$/, "") : null;
  if (policy.laneRules.length === 0) throw new Error("INBOX.md: no lanes found under \"## Lanes\"");
  return policy;
}

// ---- decide --------------------------------------------------------------------

const cache = new Map<string, { mtime: number; policy: CompiledPolicy }>();

export function loadPolicy(root: string): CompiledPolicy {
  const file = path.join(root, "INBOX.md");
  const mtime = statSync(file).mtimeMs;
  const hit = cache.get(file);
  if (hit && hit.mtime === mtime) return hit.policy;
  const policy = compileInbox(readFileSync(file, "utf8"));
  cache.set(file, { mtime, policy });
  return policy;
}

function compiled(policy: Policy): CompiledPolicy {
  if ("laneRules" in policy && Array.isArray((policy as CompiledPolicy).laneRules)) return policy as CompiledPolicy;
  return compileInbox(policy.source);
}

/** Settings win when the user changed them; else what INBOX.md says; else the defaults. */
export function effectiveThresholds(policy: CompiledPolicy, input: Thresholds): Thresholds {
  const out = { ...DEFAULT_THRESHOLDS };
  for (const k of Object.keys(out) as (keyof Thresholds)[]) {
    const fromInbox = policy.thresholds[k];
    if (input[k] !== DEFAULT_THRESHOLDS[k]) out[k] = input[k];
    else if (typeof fromInbox === "number") out[k] = fromInbox;
  }
  return out;
}

const noulConfidence = (p: number) => Math.min(1, Math.abs(p - 0.5) * 2);
const pct = (p: number) => `${Math.round(p * 100)}%`;

/** Cold pitch probability that counts when code already knows the sender is a stranger. */
const COLD_PITCH_UNKNOWN = 0.35;

/**
 * A stranger who opens a thread with something that reads like a pitch is a
 * cold pitch, even when Jev's top choice is "person": code knows they never
 * wrote to them or met them, so a weaker signal is enough. No reply owed, no draft.
 */
function isColdOutreach(input: DecideInput): boolean {
  const a = input.answers;
  return Boolean(
    a && input.facts.firstTimeSender && !input.facts.isReply &&
      (a.kind.choice === "cold_pitch" || (a.kind.probabilities.cold_pitch ?? 0) >= COLD_PITCH_UNKNOWN),
  );
}

/**
 * Judgments that sit close to the line they were measured against. A 0.62
 * "needs a reply" against a 0.6 line files the same as a 0.98 one, so these
 * get the Check badge with the reason in words. Only the lines that moved the
 * thread count: needs-reply, the goal, and an injection signal just under
 * quarantine.
 */
function borderline(input: DecideInput, t: Thresholds, lane: Lane, goal: { id: string; p: number } | null): string | null {
  const a = input.answers;
  if (!a || t.checkBand <= 0) return null;
  const near = (p: number, line: number) => Math.abs(p - line) < t.checkBand;
  const reasons: string[] = [];
  const signals = [a.screen.agentAddressed, a.screen.override, a.screen.actionRequest, a.screen.hidden ?? 0, a.screen.inviteSpam ?? 0];
  const top = Math.max(...signals);
  if (top < t.quarantine && top >= t.quarantine - t.checkBand) reasons.push(`an injection signal at ${pct(top)}, just under the ${pct(t.quarantine)} quarantine line`);
  if (lane !== "screener" && near(a.needsReply, t.needsReply)) reasons.push(`needs a reply at ${pct(a.needsReply)}, close to the ${pct(t.needsReply)} line`);
  if (goal && (lane === "goals" || lane === "reply" || lane === "other") && near(goal.p, t.goal)) {
    const title = input.goals.find((g) => g.id === goal.id)?.title ?? "a goal";
    reasons.push(`"${title}" at ${pct(goal.p)}, close to the ${pct(t.goal)} line`);
  }
  return reasons.length ? `Borderline: ${reasons.join("; ")}` : null;
}

interface Eval { pass: boolean; confidence: number }

function evalCond(cond: Cond, input: DecideInput, t: Thresholds, descVip: { id: string; p: number } | null): Eval {
  const { facts, answers } = input;
  const vipHere = facts.vipId !== null || (descVip !== null && descVip.p >= 0.5);
  const vipConfidence = facts.vipId !== null ? 1 : descVip ? noulConfidence(descVip.p) : 1;
  switch (cond.kind) {
    case "firstTime":
      return { pass: facts.firstTimeSender, confidence: 1 };
    case "notVip":
      return { pass: !vipHere, confidence: vipConfidence };
    case "senderVip":
    case "vipOnThread":
      return { pass: vipHere, confidence: vipConfidence };
    case "notTeam":
      return { pass: !facts.team, confidence: 1 };
    case "team":
      return { pass: facts.team, confidence: 1 };
    case "notScreened":
      return { pass: input.senderStatus === "unknown", confidence: 1 };
    case "screenedOut":
      return { pass: (input.senderStatus === "screened_out") !== cond.not, confidence: 1 };
    case "meSentLast":
      return { pass: facts.meSentLast, confidence: 1 };
    case "goal": {
      if (!answers) return { pass: false, confidence: 0 };
      const best = bestGoal(input);
      return { pass: best !== null && best.p >= (cond.threshold ?? t.goal), confidence: answers.goal.confidence };
    }
    case "needsReply": {
      if (!answers) return { pass: false, confidence: 0 };
      if (isColdOutreach(input)) return { pass: false, confidence: 1 };
      return { pass: answers.needsReply >= (cond.threshold ?? t.needsReply), confidence: noulConfidence(answers.needsReply) };
    }
    case "ballMe":
      if (!answers) return { pass: false, confidence: 0 };
      return { pass: answers.ball.choice === "me", confidence: answers.ball.confidence };
    case "isKind": {
      if (!answers) return { pass: false, confidence: 0 };
      const is = answers.kind.choice === cond.value;
      return { pass: is !== cond.not, confidence: answers.kind.confidence };
    }
    case "always":
      return { pass: true, confidence: answers ? answers.kind.confidence : 1 };
  }
}

function bestGoal(input: DecideInput): { id: string; p: number } | null {
  if (!input.answers) return null;
  const active = new Set(input.goals.filter((g) => !g.paused).map((g) => g.id));
  let best: { id: string; p: number } | null = null;
  for (const [id, p] of Object.entries(input.answers.goal.probabilities)) {
    if (id === "none" || !active.has(id)) continue;
    if (!best || p > best.p) best = { id, p };
  }
  if (!best && input.answers.goal.choice !== "none" && active.has(input.answers.goal.choice)) {
    best = { id: input.answers.goal.choice, p: input.answers.goal.confidence };
  }
  return best;
}

function bestDescriptionVip(input: DecideInput): { id: string; p: number } | null {
  if (!input.answers) return null;
  let best: { id: string; p: number } | null = null;
  for (const v of input.vips) {
    if (v.matchKind !== "description") continue;
    const p = input.answers.vipByDescription[v.id];
    if (typeof p !== "number") continue;
    if (!best || p > best.p) best = { id: v.id, p };
  }
  return best;
}

export function decide(policyIn: Policy, input: DecideInput): Decision {
  const policy = compiled(policyIn);
  const t = effectiveThresholds(policy, input.thresholds);
  const { facts, answers } = input;
  const descVip = bestDescriptionVip(input);
  const vipId = facts.vipId ?? (descVip && descVip.p >= 0.5 ? descVip.id : null);
  const vip = vipId ? input.vips.find((v) => v.id === vipId) ?? null : null;
  const vipTier = vip?.tier ?? facts.vipTier ?? null;
  const goal = bestGoal(input);
  const goalId = goal && goal.p >= t.goal ? goal.id : null;
  const coldOutreach = isColdOutreach(input);
  const needsReply = answers && !coldOutreach ? answers.needsReply >= t.needsReply : false;
  const followUpDays = facts.meSentLast ? (policy.followUp.vipCanOverride && typeof vip?.rules.followUpDays === "number" ? vip.rules.followUpDays : policy.followUp.days) : null;

  // Screened-out senders go to Other and are never judged.
  if (input.senderStatus === "screened_out") {
    return { lane: "other", rule: "sender screened out", priority: 0, confidence: 1, check: false, checkReason: null, goalId: null, vipId, needsReply: false, draft: false, followUpDays };
  }

  // Quarantine: an injection signal, or a spam-looking invite, over the line. Other, priority 0, Check on, no draft.
  if (answers) {
    const s = screenOf(answers, t);
    if (s.screen === "quarantine") {
      return { lane: "other", rule: `quarantined: ${s.reason}`, priority: 0, confidence: 1, check: true, checkReason: `Quarantined: ${s.reason}`, goalId: null, vipId, needsReply: false, draft: false, followUpDays };
    }
  }

  // Lanes, first match wins.
  let lane: Lane = "other";
  let rule = "no lane matched";
  let confidence = answers ? answers.kind.confidence : 1;
  outer: for (const r of policy.laneRules) {
    for (const group of r.groups) {
      const evals = group.map((c) => evalCond(c, input, t, descVip));
      if (evals.every((e) => e.pass)) {
        lane = r.lane;
        rule = `${r.lane}: ${r.rule}`;
        confidence = evals.reduce((min, e) => Math.min(min, e.confidence), 1);
        break outer;
      }
    }
  }
  if (!answers && lane !== "screener" && lane !== "vip") {
    rule = "not judged yet";
    confidence = 0;
  }

  // Priority.
  let priority = 0;
  if (answers) {
    if (goalId && goal) {
      const weight = input.goals.find((g) => g.id === goalId)?.weight ?? 5;
      priority += weight * goal.p * policy.priority.goalMultiplier;
    }
    priority += policy.priority.urgency[Math.max(0, Math.min(3, answers.urgency.score))] ?? 0;
    if (needsReply) priority += policy.priority.needsReply;
    const kind = answers.kind.choice;
    const coldPitch = coldOutreach || kind === "cold_pitch" || (answers.kind.probabilities.cold_pitch ?? 0) >= t.coldPitch;
    if (coldPitch && policy.priority.kind.cold_pitch !== undefined) priority += policy.priority.kind.cold_pitch;
    else if (policy.priority.kind[kind] !== undefined) priority += policy.priority.kind[kind]!;
  }
  if (vipTier) priority += policy.priority.tier[vipTier];
  if (facts.meetingSoon) priority += policy.priority.meetingSoon;
  priority = Math.round(Math.max(0, Math.min(100, priority)));
  if (vip?.rules.alwaysTop) priority = 100;

  if (coldOutreach && lane !== "screener") rule = `${rule} (cold pitch from someone you never wrote to or met)`;
  if (facts.meetingSoon && policy.priority.meetingSoon) rule = `${rule} (you meet them within 48 hours)`;

  const shaky = answers ? confidence < t.check : false;
  const band = borderline(input, t, lane, goal);
  const check = shaky || band !== null;
  // The borderline reason names the number and its line, so it wins when both apply.
  const checkReason = band ?? (shaky ? `Jev was unsure: ${pct(confidence)} confidence, under the ${pct(t.check)} line` : null);
  const draft = Boolean(
    answers &&
      policy.drafts.whenNeedsReply &&
      needsReply &&
      !(policy.drafts.respectNeverDraft && vip?.rules.neverDraft),
  );

  return { lane, rule, priority, confidence, check, checkReason, goalId, vipId, needsReply, draft, followUpDays };
}

export const policy: PolicyLayer = { compileInbox, loadPolicy, decide };
