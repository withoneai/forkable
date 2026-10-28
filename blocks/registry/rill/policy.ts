import type { Goal, Kind, Lane, Vip } from "./types.js";
import { choiceOf, noulOf, type JevAnswers } from "./jev.js";

// Rill's lanes, first match wins (orez/INBOX.md, "## Lanes"):
//   quarantine: any injection screen at 0.7 or more, to Other, never drafted
//   other:      a receipt, a newsletter or a notification
//   screener:   first-time sender, not a VIP, not on the team
//   vip:        sender is a VIP (address, domain, or Jev on a description)
//   goals:      goal probability at least 0.5
//   reply:      needs a reply at 0.6 or more, and the ball is with you
//   other:      everything else (a calendar invite checks VIP and goals first)

export const THRESHOLDS = { injection: 0.7, goal: 0.5, needsReply: 0.6 } as const;

export interface Facts { firstTime: boolean; vip: Vip | null; onTeam: boolean }

export function vipFor(email: string, vips: Vip[]): Vip | null {
  const e = email.toLowerCase();
  const domain = e.split("@")[1] ?? "";
  return vips.find((v) => (v.matchKind === "address" && v.match.toLowerCase() === e) || (v.matchKind === "domain" && (domain === v.match.toLowerCase() || domain.endsWith(`.${v.match.toLowerCase()}`)))) ?? null;
}

export function decideLane(a: JevAnswers, facts: Facts, goals: Goal[], vips: Vip[]): { lane: Lane; rule: string; kind: Kind; goal: Goal | null; vip: Vip | null } {
  const kind = choiceOf(a, "kind", "person").choice as Kind;
  const g = choiceOf(a, "goal", "none");
  const goal = g.choice !== "none" && g.p >= THRESHOLDS.goal ? goals.find((x) => x.id === g.choice) ?? null : null;
  const described = vips.filter((v) => v.matchKind === "description").find((v) => noulOf(a, `vip_${v.id}`) >= 0.5) ?? null;
  const vip = facts.vip ?? described;
  const inj = Math.max(noulOf(a, "inj_agent_addressed"), noulOf(a, "inj_override"), noulOf(a, "inj_action_request"), noulOf(a, "inj_hidden"));

  if (inj >= THRESHOLDS.injection) return { lane: "other", rule: "Quarantined: it talks to an assistant, not to you", kind, goal: null, vip };
  if (kind === "receipt" || kind === "newsletter" || kind === "notification") return { lane: "other", rule: `A ${kind}`, kind, goal: null, vip };
  if (facts.firstTime && !vip && !facts.onTeam) return { lane: "screener", rule: kind === "cold_pitch" ? "First-time sender, a cold pitch" : "First-time sender", kind, goal, vip };
  if (vip) return { lane: "vip", rule: `VIP: ${vip.name}`, kind, goal, vip };
  if (goal) return { lane: "goals", rule: `Moves ${goal.title}`, kind, goal, vip };
  if (noulOf(a, "needs_reply") >= THRESHOLDS.needsReply && choiceOf(a, "ball", "nobody").choice === "me") return { lane: "reply", rule: "Waiting on your reply", kind, goal, vip };
  return { lane: "other", rule: kind === "calendar" ? "A calendar invitation" : "Nothing owed", kind, goal, vip };
}
