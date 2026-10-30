// Smoke test for @rill/core: no database, no network, no keys.
// Run: pnpm exec tsx scripts/smoke.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compileInbox, decide, fixtures, jev, screenOf, validateDraft, hiddenText,
  addDays, categoryAllowed, categoryOf, categoryQuery, excludedLabels, normalizeCategories,
  DEFAULT_THRESHOLDS, type Facts, type JevAnswers, type JevInput, type GoalRow, type VipRow,
} from "../src/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

// 1. INBOX.md compiles.
const md = readFileSync(path.join(ROOT, "INBOX.md"), "utf8");
const policy = compileInbox(md);
console.log("\nINBOX.md compiled:");
for (const l of policy.lanes) console.log(`  ${l.lane.padEnd(9)} ${l.rule}`);
console.log(`  screening ${JSON.stringify(policy.screening)}`);
console.log(`  priority  ${JSON.stringify(policy.priority)}`);
console.log(`  check ${JSON.stringify(policy.check)}  drafts ${JSON.stringify(policy.drafts)}  followUp ${JSON.stringify(policy.followUp)}`);
check("seven lane rules in order", policy.lanes.map((l) => l.lane).join(",") === "other,screener,vip,goals,reply,other,other");
check("goal multiplier 5, inner 30, hour 20, newsletter -40", policy.priority.goalMultiplier === 5 && policy.priority.tier.inner === 30 && policy.priority.urgency[3] === 20 && policy.priority.kind.newsletter === -40);
let threw = "";
try {
  compileInbox("## Lanes\n- vip: sender is a VIP\n## Priority\n- the moon phase adds 7\n");
} catch (e) {
  threw = (e as Error).message;
}
check("unknown bullet throws with its line", /INBOX\.md line 4: cannot read "the moon phase adds 7"/.test(threw), threw);

// 2. Fixtures load and the first thread becomes a Jev request.
const inbox = fixtures.loadInbox(ROOT);
const records = fixtures.threadRecords(inbox);
check(`fixtures load (${records.length} threads)`, records.length >= 3);
const goals: GoalRow[] = inbox.goals.map((g, i) => ({ id: g.id, mailboxId: "mb", title: g.title, detail: g.detail, weight: g.weight, paused: false, position: i, createdAt: new Date() }));
const vips: VipRow[] = inbox.vips.map((v) => ({ id: v.id, mailboxId: "mb", name: v.name, matchKind: v.matchKind, match: v.match, tier: v.tier, rules: (v.rules ?? {}) as VipRow["rules"], createdAt: new Date() }));
const t01 = records.find((t) => t.id === inbox.threads[0]!.id)!;
const mail = [...t01.messages].reverse().find((m) => !m.isFromMe) ?? t01.messages[t01.messages.length - 1]!;
const facts: Facts = {
  vipId: vips.find((v) => v.matchKind === "address" && v.match === mail.from.email)?.id ?? null,
  vipTier: vips.find((v) => v.matchKind === "address" && v.match === mail.from.email)?.tier ?? null,
  team: false,
  firstTimeSender: false,
  fromMe: false,
  meSentLast: false,
  hasListUnsubscribe: false,
  isReply: t01.messages.length > 1,
  calendarInvite: false,
  messageCount: t01.messageCount,
  meetingSoon: false,
};
const input: JevInput = { me: inbox.me, goals, vips, mail, thread: t01, facts };
const req = jev.buildRequest(input, "jev-latest") as { model: string; state: Record<string, unknown>; questions: Record<string, unknown> };
const qKeys = Object.keys(req.questions);
console.log(`\nJev request for ${t01.id} "${t01.subject}": ${qKeys.length} questions: ${qKeys.join(", ")}`);
check("question set", ["inj_agent_addressed", "inj_override", "inj_action_request", "kind", "goal", "needs_reply", "ball", "urgency", "commitment"].every((k) => qKeys.includes(k)));
check("one vip_<id> question per description VIP", vips.filter((v) => v.matchKind === "description").every((v) => qKeys.includes(`vip_${v.id}`)));
check("no inj_hidden without hidden text", !qKeys.includes("inj_hidden") === (mail.hiddenText.trim() === ""));

// 3. decide() on synthetic answers.
const answers: JevAnswers = {
  screen: { agentAddressed: 0.02, override: 0.03, actionRequest: 0.1, hidden: null, inviteSpam: null },
  kind: { choice: "person", confidence: 0.93, probabilities: { person: 0.93, cold_pitch: 0.02 } },
  goal: { choice: "g1", confidence: 0.82, probabilities: { g1: 0.82, g2: 0.05, g3: 0.08, none: 0.05 } },
  needsReply: 0.91,
  ball: { choice: "me", confidence: 0.88, probabilities: { me: 0.88, them: 0.08 } },
  urgency: { score: 2, confidence: 0.7 },
  vipByDescription: { v3: 0.1 },
  commitment: 0.2,
  model: "jev-smoke",
  inputTokens: 0,
};
const t = DEFAULT_THRESHOLDS;
const d1 = decide(policy, { facts, answers, goals, vips, senderStatus: "let_in", thresholds: t, judgedBy: "jev" });
console.log(`\ndecide(${t01.id}): ${JSON.stringify(d1)}`);
check("VIP sender lands in vip", d1.lane === "vip" && d1.vipId === facts.vipId);
check("alwaysTop VIP gets priority 100", d1.priority === 100);
check("neverDraft VIP rule blocks the draft", d1.draft === false && d1.needsReply === true);

const plain: Facts = { ...facts, vipId: null, vipTier: null };
const d2 = decide(policy, { facts: plain, answers, goals, vips, senderStatus: "let_in", thresholds: t, judgedBy: "jev" });
console.log(`decide(goal thread): ${JSON.stringify(d2)}`);
check("goal probability 0.82 lands in goals with g1", d2.lane === "goals" && d2.goalId === "g1");
check("priority = 9*0.82*5 + 12 + 10 = 59", d2.priority === 59, String(d2.priority));
check("draft when needs reply", d2.draft === true);

const d3 = decide(policy, { facts: { ...plain, firstTimeSender: true }, answers: { ...answers, goal: { choice: "none", confidence: 0.9, probabilities: { none: 0.9 } } }, goals, vips, senderStatus: "unknown", thresholds: t, judgedBy: "jev" });
check("first-time sender lands in screener", d3.lane === "screener", d3.lane);
const d4 = decide(policy, { facts: plain, answers: { ...answers, goal: { choice: "none", confidence: 0.9, probabilities: { none: 0.9 } } }, goals, vips, senderStatus: "let_in", thresholds: t, judgedBy: "jev" });
check("needs reply + ball with me lands in reply", d4.lane === "reply", d4.lane);
const news: JevAnswers = { ...answers, kind: { choice: "newsletter", confidence: 0.95, probabilities: { newsletter: 0.95 } }, goal: { choice: "none", confidence: 0.9, probabilities: { none: 0.9 } }, needsReply: 0.05, ball: { choice: "nobody", confidence: 0.9, probabilities: { nobody: 0.9 } }, urgency: { score: 0, confidence: 0.9 } };
const d5 = decide(policy, { facts: { ...plain, hasListUnsubscribe: true }, answers: news, goals, vips, senderStatus: "let_in", thresholds: t, judgedBy: "jev" });
check("newsletter lands in other at priority 0", d5.lane === "other" && d5.priority === 0, `${d5.lane} ${d5.priority}`);
const inj: JevAnswers = { ...answers, screen: { agentAddressed: 0.9, override: 0.85, actionRequest: 0.92, hidden: 0.95, inviteSpam: null } };
const d6 = decide(policy, { facts: { ...plain, firstTimeSender: true }, answers: inj, goals, vips, senderStatus: "unknown", thresholds: t, judgedBy: "jev" });
check("injection is quarantined: other, 0, check, no draft", d6.lane === "other" && d6.priority === 0 && d6.check && !d6.draft, d6.rule);
check("screenOf quarantine", screenOf(inj, t).screen === "quarantine");
const shaky = decide(policy, { facts: plain, answers: { ...answers, goal: { choice: "g1", confidence: 0.52, probabilities: { g1: 0.52, g3: 0.4, none: 0.08 } } }, goals, vips, senderStatus: "let_in", thresholds: t, judgedBy: "jev" });
check("Check badge when the deciding judgment is below 0.6", shaky.lane === "goals" && shaky.check === true);
const screened = decide(policy, { facts: plain, answers: null, goals, vips, senderStatus: "screened_out", thresholds: t, judgedBy: null });
check("screened-out sender: other, never judged", screened.lane === "other" && screened.priority === 0 && !screened.draft);

// 4. Judgment rows round trip.
const rows = jev.toJudgments(answers, input);
console.log(`\n${rows.length} judgment rows; e.g. ${rows.map((r) => `${r.label}: ${r.answer} (${Math.round(r.probability * 100)}%)`).slice(0, 4).join(" | ")}`);
const back = jev.fromJudgments(rows, { goals, vips });
check("fromJudgments rebuilds goal, kind, needsReply", back !== null && back.goal.choice === "g1" && back.kind.choice === "person" && Math.abs(back.needsReply - 0.91) < 1e-6);
const dBack = decide(policy, { facts: plain, answers: back, goals, vips, senderStatus: "let_in", thresholds: t, judgedBy: "jev" });
check("decide over rebuilt answers matches", dBack.lane === d2.lane && dBack.priority === d2.priority);

// 5. Hidden text from the injection fixture.
const injThread = inbox.threads.find((th) => th.messages.some((m) => m.html));
if (injThread) {
  const m = injThread.messages.find((x) => x.html)!;
  const hidden = hiddenText(m.html!, m.body);
  console.log(`\nhidden text in ${injThread.id}: "${hidden.slice(0, 120)}${hidden.length > 120 ? "…" : ""}"`);
  check("hidden text extracted from the injection email", hidden.length > 20);
}

// 6. The draft validator.
const inbound = "Could you confirm the option pool size by Thursday 5pm so we can circulate the final? See https://northwind.vc/docs/term-sheet";
const good = "Thanks for the note, Priya.\n\nI can confirm both points by Thursday. On the pool, I lean toward the larger number and will come back with a firm answer tomorrow.\n\nBest,\nDana";
const bad = "Thanks! I'll send the signed copy and have booked a call — details at https://calendly.example/dana.\n\n- Option pool size by Thursday 5pm so we can circulate the final";
const v1 = validateDraft(good, inbound);
const v2 = validateDraft(bad, inbound);
console.log(`\nvalidator good: ${JSON.stringify(v1)}\nvalidator bad:  ${JSON.stringify(v2)}`);
check("good draft passes", v1.ok);
check("bad draft fails for dash, new URL, claimed action, bullets, mirroring", !v2.ok && v2.reasons.length >= 4, v2.reasons.join("; "));

// 7. Inbox tabs, the Check band, facts the model is not asked, follow-up timers.
check("default tabs are Primary only", JSON.stringify(normalizeCategories(undefined)) === '["primary"]');
check("Gmail query skips every tab that is off", categoryQuery("gmail", ["primary"]) === "in:inbox -category:promotions -category:updates -category:social -category:forums", categoryQuery("gmail", ["primary"]));
check("Gmail query with Updates on keeps Updates", !categoryQuery("gmail", ["primary", "updates"]).includes("-category:updates"));
check("Outlook query keeps Focused only", categoryQuery("outlook-mail", ["primary"]) === "in:inbox -category:other");
check("a promotions label reads as promotions", categoryOf(["INBOX", "CATEGORY_PROMOTIONS"]) === "promotions" && categoryOf(["INBOX"]) === "primary");
check("a promotion is skipped under Primary only", !categoryAllowed(["CATEGORY_PROMOTIONS"], ["primary"]) && categoryAllowed(["CATEGORY_PERSONAL"], ["primary"]));
check("excluded labels cover the tabs that are off", excludedLabels(["primary", "updates"]).join(",") === "CATEGORY_PROMOTIONS,CATEGORY_SOCIAL,CATEGORY_FORUMS,CATEGORY_OTHER");
{
  const { graphQuery } = await import("../src/providers/outlook/mailMappers.js");
  const g = graphQuery("in:inbox -category:other newer_than:2d", new Date("2026-10-27T12:00:00Z"));
  check("Graph filter reads Focused and the date", g.filter === "isDraft eq false and receivedDateTime ge 2026-10-25T12:00:00.000Z and inferenceClassification eq 'focused'" && !g.search, JSON.stringify(g));
}
check("INBOX.md sets the check band", policy.thresholds.checkBand === 0.15 && policy.priority.meetingSoon === 15);

const goalNone = { choice: "none", confidence: 0.9, probabilities: { none: 0.9 } };
const nearReply = decide(policy, { facts: plain, answers: { ...answers, goal: goalNone, needsReply: 0.66 }, goals, vips, senderStatus: "let_in", thresholds: t, judgedBy: "jev" });
check("needs reply 0.66 against 0.6 lands in Reply with Check and a reason", nearReply.lane === "reply" && nearReply.check && /needs a reply at 66%/.test(nearReply.checkReason ?? ""), JSON.stringify(nearReply));
const farReply = decide(policy, { facts: plain, answers: { ...answers, goal: goalNone, needsReply: 0.95 }, goals, vips, senderStatus: "let_in", thresholds: t, judgedBy: "jev" });
check("needs reply 0.95 has no Check", !farReply.check && farReply.checkReason === null);
const nearGoal = decide(policy, { facts: plain, answers: { ...answers, goal: { choice: "g1", confidence: 0.8, probabilities: { g1: 0.56, none: 0.44 } } }, goals, vips, senderStatus: "let_in", thresholds: t, judgedBy: "jev" });
check("goal at 0.56 against 0.5 gets Check naming the goal", nearGoal.lane === "goals" && nearGoal.check && /at 56%/.test(nearGoal.checkReason ?? ""), nearGoal.checkReason ?? "");
const nearInj = decide(policy, { facts: plain, answers: { ...answers, screen: { ...answers.screen, override: 0.62 } }, goals, vips, senderStatus: "let_in", thresholds: t, judgedBy: "jev" });
check("an injection signal just under quarantine gets Check", nearInj.check && /quarantine line/.test(nearInj.checkReason ?? ""));

const pitchy: JevAnswers = { ...answers, goal: goalNone, kind: { choice: "person", confidence: 0.6, probabilities: { person: 0.55, cold_pitch: 0.4 } }, needsReply: 0.8 };
const stranger = decide(policy, { facts: { ...plain, firstTimeSender: true, isReply: false }, answers: pitchy, goals, vips, senderStatus: "unknown", thresholds: t, judgedBy: "jev" });
const known = decide(policy, { facts: { ...plain, firstTimeSender: false, isReply: false }, answers: pitchy, goals, vips, senderStatus: "let_in", thresholds: t, judgedBy: "jev" });
check("a stranger's pitchy email goes to the screener with no reply owed and no draft", stranger.lane === "screener" && !stranger.needsReply && !stranger.draft, JSON.stringify(stranger));
check("the same email from someone you know still needs a reply", known.needsReply && known.draft);
check("a stranger's pitch ranks under the known sender's", stranger.priority < known.priority, `${stranger.priority} vs ${known.priority}`);

const soon = decide(policy, { facts: { ...plain, meetingSoon: true }, answers, goals, vips, senderStatus: "let_in", thresholds: t, judgedBy: "jev" });
check("a meeting within 48 hours adds 15", soon.priority === d2.priority + 15 && /48 hours/.test(soon.rule), `${soon.priority}`);

check("3 days after Friday noon is Monday noon", addDays(new Date("2026-10-23T12:00:00Z"), 3, false).toISOString() === "2026-10-26T12:00:00.000Z");
check("3 business days after Friday is Wednesday", addDays(new Date("2026-10-23T12:00:00Z"), 3, true).toISOString() === "2026-10-28T12:00:00.000Z");
{
  const fb = compileInbox(md.replace("nudge after 3 days", "nudge after 5 business days"));
  check("INBOX.md reads business days", fb.followUp.days === 5 && fb.followUp.businessDays);
}

const v3 = validateDraft("Hi [Name],\n\nI hope this email finds you well. Thursday works.\n\nDana", inbound);
check("placeholders and stock AI openers fail the draft", !v3.ok && v3.reasons.some((r) => r.includes("placeholder")) && v3.reasons.some((r) => r.includes("stock")), v3.reasons.join("; "));

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
