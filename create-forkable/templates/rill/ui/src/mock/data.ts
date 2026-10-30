// The Acme sample inbox for the in-browser mock. Made-up senders only.
import type {
  ApiDraft, ApiGoal, ApiMessage, ApiSettings, ApiVip, BriefResponse, EngineOption, LedgerRow, VipSuggestion,
} from "@rill/core/api-types";
import type { Judgment, Lane, VipTier } from "@rill/core/types";
import { GMAIL_SCOPES } from "@rill/core/types";

export const ME = { name: "Dana Reyes", email: "dana@acme.com", line: "Dana Reyes, CEO of Acme Inc" };
export const MODEL_JEV = "jev-1.13.0";

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const daysAgo = (d: number, h = 9) => {
  const t = new Date(); t.setDate(t.getDate() - d); t.setHours(h, 12, 0, 0); return t.toISOString();
};

export const goals: ApiGoal[] = [
  { id: "g1", title: "Close the seed round", detail: "Anything from investors, intros to investors, term sheets, data room requests.", weight: 9, paused: false, position: 0, matched7d: 14 },
  { id: "g2", title: "Hire 2 senior engineers", detail: "Candidates, recruiters we work with, offer approvals. Not cold recruiter pitches.", weight: 7, paused: false, position: 1, matched7d: 9 },
  { id: "g3", title: "Land 3 design partners", detail: "Pilots, pricing questions, champions at target companies.", weight: 8, paused: false, position: 2, matched7d: 6 },
];

export const vips: ApiVip[] = [
  { id: "v1", name: "Priya Nair", matchKind: "address", match: "priya@northwind.vc", tier: "inner", rules: { alwaysTop: true, notify: true, neverDraft: false }, matched7d: 5 },
  { id: "v2", name: "Acme team", matchKind: "domain", match: "acme.com", tier: "team", rules: { alwaysTop: false, notify: false, neverDraft: false }, matched7d: 22 },
  { id: "v3", name: "Board members", matchKind: "description", match: "anyone on our board", tier: "inner", rules: { replyWithinHours: 4 }, matched7d: 3 },
  { id: "v4", name: "Elena Ruiz", matchKind: "address", match: "elena@globex.com", tier: "key", rules: { followUpDays: 2 }, matched7d: 2 },
];

export const vipSuggestions: VipSuggestion[] = [
  { name: "Priya Nair", email: "priya@northwind.vc", reason: "You wrote to her 14 times in 30 days", sentCount: 14 },
  { name: "Marcus Lee", email: "marcus@acme.com", reason: "Your most frequent teammate", sentCount: 31 },
  { name: "Elena Ruiz", email: "elena@globex.com", reason: "Pilot champion, 6 threads", sentCount: 6 },
  { name: "Hana Oyelaran", email: "hana@oyelaran.partners", reason: "Board, replied within the hour every time", sentCount: 5 },
  { name: "Wei Zhang", email: "wei@hooli.com", reason: "You started 3 threads, waiting on 1", sentCount: 3 },
];

export const goalSuggestions = [
  { title: "Close the seed round", detail: "Anything from investors, intros to investors, term sheets, data room requests." },
  { title: "Hire 2 senior engineers", detail: "Candidates, recruiters we work with, offer approvals. Not cold recruiter pitches." },
  { title: "Land 3 design partners", detail: "Pilots, pricing questions, champions at target companies." },
  { title: "Reply to people waiting on me", detail: "Anyone who asked me a direct question and has not heard back." },
  { title: "Anything with money or a signature", detail: "Invoices over $1,000, contracts, anything that needs my signature." },
  { title: "Ship the October launch", detail: "Launch post, press, the demo video, anything blocking the date." },
];

type J = [question: string, label: string, kind: Judgment["kind"], answer: string, p: number, probs?: Record<string, number>];
const J = (...rows: J[]): Judgment[] =>
  rows.map(([question, label, kind, answer, probability, probabilities]) => ({
    question, label, kind, answer, probability,
    confidence: kind === "noul" ? Math.abs(probability - 0.5) * 2 : probability,
    probabilities,
    model: MODEL_JEV,
  }));

const KIND = (choice: string, p: number, probs?: Record<string, number>): J => ["kind", "Kind of email", "choice", choice, p, probs];
const GOAL = (title: string, p: number, probs?: Record<string, number>): J => ["goal", "Which goal does this move?", "choice", title, p, probs];
const REPLY = (yes: boolean, p: number): J => ["needs_reply", "Does it need a reply from you?", "noul", yes ? "Yes" : "No", p];
const BALL = (who: string, p: number): J => ["ball", "Whose move is next?", "choice", who, p];
const URG = (label: string, p: number): J => ["urgency", "Urgency", "score", label, p];
const VIPJ = (name: string, p: number, id: string): J => [`vip_${id}`, `Matches VIP: ${name}`, "noul", p > 0.5 ? "Yes" : "No", p];
const PROMISE = (p: number): J => ["commitment", "Did you promise something?", "noul", p > 0.5 ? "Yes" : "No", p];

export interface MockThread {
  id: string;
  lane: Lane;
  subject: string;
  from: { name: string; email: string };
  at: string;
  messages: ApiMessage[];
  priority: number;
  confidence: number;
  check: boolean;
  goal: { id: string; title: string } | null;
  vip: { id: string; name: string; tier: VipTier } | null;
  kind: string;
  needsReply: boolean;
  urgency: number;
  summary: string;
  ask: string | null;
  why: Judgment[];
  rule: string;
  draft: string | null;
  screen: "pass" | "strip" | "quarantine";
  firstTime: boolean;
  unread: boolean;
}

const msg = (id: string, from: { name: string; email: string }, date: string, subject: string, body: string, extra: Partial<ApiMessage> = {}): ApiMessage => ({
  id, from, to: [ME.email], cc: [], date, subject, body, isFromMe: from.email === ME.email, screen: "pass", ...extra,
});
const me = { name: ME.name, email: ME.email };

const P = {
  priya: { name: "Priya Nair", email: "priya@northwind.vc" },
  marcus: { name: "Marcus Lee", email: "marcus@acme.com" },
  hana: { name: "Hana Oyelaran", email: "hana@oyelaran.partners" },
  elena: { name: "Elena Ruiz", email: "elena@globex.com" },
  jordan: { name: "Jordan Park", email: "jordan@acme.com" },
  sam: { name: "Sam Okafor", email: "sam@initech.io" },
  dev: { name: "Dev Patel", email: "dev@talentbridge.co" },
  wei: { name: "Wei Zhang", email: "wei@hooli.com" },
  ravi: { name: "Ravi Chandran", email: "ravi@vandelay.com" },
  mia: { name: "Mia Torres", email: "mia@brightspace-offices.com" },
  nikhil: { name: "Nikhil Rao", email: "nikhil@wayfarer.design" },
  lea: { name: "Lea Fischer", email: "lea@foundersound.fm" },
  omar: { name: "Omar Siddiqui", email: "omar@harborline-insurance.com" },
  figma: { name: "Figma", email: "no-reply@figma.com" },
  weekly: { name: "The Product Weekly", email: "hello@productweekly.news" },
  linear: { name: "Linear", email: "notifications@linear.app" },
  cal: { name: "Google Calendar", email: "calendar-notification@google.com" },
  stripe: { name: "Stripe", email: "receipts@stripe.com" },
  alex: { name: "Alex Kim", email: "alex@growthloop.co" },
  nadia: { name: "Nadia Hassan", email: "nadia@umbrella.org" },
  ops: { name: "Ravi Menon", email: "ops@dataroom-sync.io" },
  rocket: { name: "Recruit Rocket", email: "hello@recruitrocket.co" },
};

const g = (id: "g1" | "g2" | "g3") => ({ id, title: goals.find((x) => x.id === id)!.title });
const v = (id: "v1" | "v2" | "v3" | "v4") => { const x = vips.find((y) => y.id === id)!; return { id, name: x.name, tier: x.tier }; };

export const threads: MockThread[] = [
  {
    id: "t01", lane: "vip", subject: "Term sheet redlines, need you by Thursday", from: P.priya, at: ago(18),
    messages: [
      msg("t01m1", me, daysAgo(2, 16), "Term sheet", "Priya, attached is the term sheet as discussed. Let me know where you land on the board seat and pro rata.\n\nDana", { to: [P.priya.email] }),
      msg("t01m2", P.priya, ago(18), "Term sheet redlines, need you by Thursday", "Dana,\n\nRedlines attached. Two open points:\n\n1. Board seat timing. We would like the seat at close rather than at the next round.\n2. Pro rata. Our standard is full pro rata in all future rounds.\n\nEverything else is clean. I need your call on both by Thursday 5pm so we can get to signature Friday.\n\nPriya"),
    ],
    priority: 96, confidence: 0.94, check: false, goal: g("g1"), vip: v("v1"), kind: "person", needsReply: true, urgency: 2,
    summary: "Priya sent redlines on the term sheet. Two open points: board seat timing and the pro rata clause.",
    ask: "Your call on both points by Thursday 5pm.",
    why: J(VIPJ("Priya Nair", 1, "v1"), GOAL("Close the seed round", 0.94, { "Close the seed round": 0.94, "Land 3 design partners": 0.03, none: 0.03 }), REPLY(true, 0.97), BALL("You", 0.95), URG("This week", 0.88), KIND("person", 0.99)),
    rule: "vip: sender is a VIP", screen: "pass", firstTime: false, unread: true,
    draft: "Hi Priya,\n\nThanks for the fast turn. Board seat timing works as written. On pro rata, can we cap it at the next round only? Happy to jump on a call Wednesday.\n\nDana",
  },
  {
    id: "t02", lane: "vip", subject: "Re: Q4 hiring plan", from: P.marcus, at: ago(95),
    messages: [
      msg("t02m1", me, daysAgo(1, 11), "Q4 hiring plan", "Marcus, where are we on the two senior backend roles?\n\nDana", { to: [P.marcus.email] }),
      msg("t02m2", P.marcus, ago(95), "Re: Q4 hiring plan", "Both finalists cleared the last round. Rhea and Tomasz. Both have competing offers, so I want to go out at the top of band today. Can you approve the range?\n\nMarcus"),
    ],
    priority: 81, confidence: 0.9, check: false, goal: g("g2"), vip: v("v2"), kind: "person", needsReply: true, urgency: 2,
    summary: "Marcus has two final-round candidates and wants approval to send offers at the top of band.",
    ask: "Approve or adjust the offer range.",
    why: J(VIPJ("Acme team", 1, "v2"), GOAL("Hire 2 senior engineers", 0.9), REPLY(true, 0.92), BALL("You", 0.9), URG("Today", 0.81), KIND("person", 0.98)),
    rule: "vip: sender is on my team", screen: "pass", firstTime: false, unread: true,
    draft: "Marcus, approved at top of band for both. Send today so we do not lose them. Loop me on the calls if useful.\n\nDana",
  },
  {
    id: "t03", lane: "vip", subject: "Board deck comments before Tuesday", from: P.hana, at: ago(170),
    messages: [
      msg("t03m1", P.hana, ago(170), "Board deck comments before Tuesday", "Dana,\n\nI went through the deck. Slides 4 and 9 need the updated burn numbers, and I would move the hiring slide before the product update. Can you send a revised version before Tuesday so the others have time?\n\nHana"),
    ],
    priority: 78, confidence: 0.82, check: false, goal: null, vip: v("v3"), kind: "person", needsReply: true, urgency: 2,
    summary: "Hana reviewed the board deck and wants updated burn numbers on two slides, plus a reorder, before Tuesday.",
    ask: "Send a revised deck before Tuesday.",
    why: J(VIPJ("Board members", 0.82, "v3"), GOAL("none", 0.58, { none: 0.58, "Close the seed round": 0.3 }), REPLY(true, 0.9), BALL("You", 0.92), URG("This week", 0.8), KIND("person", 0.99)),
    rule: "vip: Jev matched the description \"anyone on our board\"", screen: "pass", firstTime: false, unread: true,
    draft: "Hana,\n\nThanks for the close read. I will update slides 4 and 9 with October burn and move hiring ahead of product. Revised deck to you by Monday noon.\n\nDana",
  },
  {
    id: "t04", lane: "vip", subject: "Pilot results and next steps", from: P.elena, at: ago(240),
    messages: [
      msg("t04m1", P.elena, ago(240), "Pilot results and next steps", "Hi Dana,\n\nThe 4-week pilot wrapped on Friday. Weekly active usage went up every week and the import team does not want to give it back. We would like pricing for 40 seats, ideally before our budget meeting on Friday.\n\nElena"),
    ],
    priority: 74, confidence: 0.86, check: false, goal: g("g3"), vip: v("v4"), kind: "person", needsReply: true, urgency: 2,
    summary: "Globex finished the 4-week pilot. Usage was up every week and they want pricing for 40 seats.",
    ask: "Send a pricing proposal before Friday.",
    why: J(VIPJ("Elena Ruiz", 1, "v4"), GOAL("Land 3 design partners", 0.86), REPLY(true, 0.89), BALL("You", 0.93), URG("This week", 0.77), KIND("person", 0.99)),
    rule: "vip: sender is a VIP", screen: "pass", firstTime: false, unread: false,
    draft: "Hi Elena,\n\nGreat to hear the pilot went well. I will send a 40-seat proposal by Thursday so you have it before the budget meeting. Would a 20 minute call help to walk through it?\n\nDana",
  },
  {
    id: "t05", lane: "vip", subject: "Can you review the launch post?", from: P.jordan, at: ago(600),
    messages: [
      msg("t05m1", P.jordan, ago(600), "Can you review the launch post?", "Draft of the launch blog post is in the shared doc. Would love your comments by tomorrow so design can lay it out.\n\nJordan"),
    ],
    priority: 52, confidence: 0.88, check: false, goal: null, vip: v("v2"), kind: "person", needsReply: true, urgency: 1,
    summary: "Jordan shared the launch blog draft and wants comments by tomorrow.",
    ask: "Review the doc.",
    why: J(VIPJ("Acme team", 1, "v2"), REPLY(true, 0.88), GOAL("none", 0.62, { none: 0.62, "Ship the October launch": 0 }), BALL("You", 0.86), URG("Today", 0.6), KIND("person", 0.99)),
    rule: "vip: sender is on my team", screen: "pass", firstTime: false, unread: false,
    draft: "Will review tonight and leave comments in the doc. Thanks Jordan.",
  },
  {
    id: "t06", lane: "goals", subject: "Intro: you and Lena from Initech", from: P.sam, at: ago(380),
    messages: [
      msg("t06m1", P.sam, ago(380), "Intro: you and Lena from Initech", "Dana, meet Lena. Lena is a partner at Initech Ventures and asked about what you are building after I mentioned the pilot results. Lena, Dana is the CEO of Acme. I will let you two take it from here.\n\nSam", { cc: ["lena@initech.io"] }),
    ],
    priority: 58, confidence: 0.55, check: true, goal: g("g1"), vip: null, kind: "person", needsReply: true, urgency: 1,
    summary: "Sam is introducing Lena, a partner at Initech Ventures, who asked about the round.",
    ask: "Reply to Lena and move Sam to bcc.",
    why: J(GOAL("Close the seed round", 0.55, { "Close the seed round": 0.55, "Land 3 design partners": 0.31, none: 0.14 }), REPLY(true, 0.81), BALL("You", 0.84), URG("This week", 0.52), KIND("person", 0.97)),
    rule: "goals: goal probability at least 0.5", screen: "pass", firstTime: false, unread: true,
    draft: "Thanks Sam, moving you to bcc.\n\nLena, great to meet you. Here is a short deck. I would love 30 minutes next week if you are open to it.\n\nDana",
  },
  {
    id: "t07", lane: "goals", subject: "Two senior backend candidates for your review", from: P.dev, at: ago(450),
    messages: [
      msg("t07m1", P.dev, ago(450), "Two senior backend candidates for your review", "Hi Dana,\n\nTwo profiles for the senior backend role, both open to a conversation this week. Profiles attached. Want me to set up intro calls with Marcus?\n\nDev"),
    ],
    priority: 61, confidence: 0.84, check: false, goal: g("g2"), vip: null, kind: "person", needsReply: true, urgency: 1,
    summary: "Dev from the recruiting partner sent two senior backend profiles and offers to set up intro calls.",
    ask: "Say yes to the intro calls, or pass.",
    why: J(GOAL("Hire 2 senior engineers", 0.84), REPLY(true, 0.78), BALL("You", 0.8), URG("This week", 0.55), KIND("person", 0.9, { person: 0.9, cold_pitch: 0.08 })),
    rule: "goals: goal probability at least 0.5", screen: "pass", firstTime: false, unread: true,
    draft: "Dev, yes, please set up calls with Marcus for both this week. Copy me on the invites.\n\nDana",
  },
  {
    id: "t08", lane: "goals", subject: "Pilot at Hooli?", from: P.wei, at: daysAgo(3, 15),
    messages: [
      msg("t08m1", me, daysAgo(3, 15), "Pilot at Hooli?", "Wei, following up on our chat at the summit. Would your import team be open to a 4-week pilot in November? Happy to tailor it.\n\nDana", { to: [P.wei.email] }),
    ],
    priority: 44, confidence: 0.79, check: false, goal: g("g3"), vip: null, kind: "person", needsReply: false, urgency: 0,
    summary: "You asked Wei about a pilot on Friday. No reply in 3 days. A nudge is drafted.",
    ask: null,
    why: J(GOAL("Land 3 design partners", 0.79), PROMISE(0.2), BALL("Them", 0.9), REPLY(false, 0.08), KIND("person", 0.98)),
    rule: "goals: I wrote last, follow up after 3 days", screen: "pass", firstTime: false, unread: false,
    draft: "Wei, quick nudge on the pilot idea. If November is too soon, happy to look at January instead. Either way, good to see you at the summit.\n\nDana",
  },
  {
    id: "t09", lane: "goals", subject: "Pricing for the import team", from: P.ravi, at: ago(720),
    messages: [
      msg("t09m1", P.ravi, ago(720), "Pricing for the import team", "Dana,\n\nWe saw the Globex case study. What would 25 seats look like for a team that already uses the API? And is there a way to start with 10?\n\nRavi"),
    ],
    priority: 66, confidence: 0.79, check: false, goal: g("g3"), vip: null, kind: "person", needsReply: true, urgency: 1,
    summary: "Ravi at Vandelay saw the case study and asks about pricing for 25 seats, possibly starting with 10.",
    ask: "Send pricing for 10 and 25 seats.",
    why: J(GOAL("Land 3 design partners", 0.79), REPLY(true, 0.86), BALL("You", 0.9), URG("This week", 0.5), KIND("person", 0.95)),
    rule: "goals: goal probability at least 0.5", screen: "pass", firstTime: false, unread: true,
    draft: "Hi Ravi,\n\nYes, starting with 10 works. I will send pricing for both 10 and 25 seats tomorrow, with the API usage folded in.\n\nDana",
  },
  {
    id: "t10", lane: "reply", subject: "Signature needed: office lease amendment", from: P.mia, at: ago(300),
    messages: [
      msg("t10m1", P.mia, ago(300), "Signature needed: office lease amendment", "Hi Dana,\n\nThe amendment for the extra 400 sq ft is ready. It needs your signature by the end of the week to hold the space.\n\nMia"),
    ],
    priority: 48, confidence: 0.91, check: false, goal: null, vip: null, kind: "person", needsReply: true, urgency: 2,
    summary: "The lease amendment for the extra space is ready and needs your signature by the end of the week.",
    ask: "Sign the amendment, or ask for changes.",
    why: J(REPLY(true, 0.91), GOAL("none", 0.7), BALL("You", 0.9), URG("This week", 0.74), KIND("person", 0.97)),
    rule: "reply: needs a reply from me", screen: "pass", firstTime: false, unread: true,
    draft: "Hi Mia,\n\nThanks. I will sign it by Thursday. Can you send the signature link straight to me?\n\nDana",
  },
  {
    id: "t11", lane: "reply", subject: "Can we move Thursday's call?", from: P.nikhil, at: ago(500),
    messages: [
      msg("t11m1", P.nikhil, ago(500), "Can we move Thursday's call?", "Dana, something came up Thursday morning. Could we do Friday at 10 instead? I will have the new onboarding screens ready by then anyway.\n\nNikhil"),
    ],
    priority: 40, confidence: 0.87, check: false, goal: null, vip: null, kind: "person", needsReply: true, urgency: 1,
    summary: "Nikhil asks to move Thursday's design review to Friday at 10.",
    ask: "Confirm Friday at 10 or propose another time.",
    why: J(REPLY(true, 0.87), GOAL("none", 0.8), BALL("You", 0.88), URG("Today", 0.55), KIND("person", 0.99)),
    rule: "reply: needs a reply from me", screen: "pass", firstTime: false, unread: false,
    draft: "Friday at 10 works. See you then.\n\nDana",
  },
  {
    id: "t12", lane: "reply", subject: "Re: Podcast invitation for Dana", from: P.lea, at: ago(1500),
    messages: [
      msg("t12m1", P.lea, daysAgo(6), "Podcast invitation for Dana", "Hi Dana, we would love to have you on Founder Sound to talk about building in the open. 45 minutes, remote.\n\nLea"),
      msg("t12m2", me, daysAgo(5), "Re: Podcast invitation for Dana", "Lea, thanks, sounds fun. Can you send a few dates in November?\n\nDana", { to: [P.lea.email] }),
      msg("t12m3", P.lea, ago(1500), "Re: Podcast invitation for Dana", "Of course. November 6, 12 or 19, any of them at 10am your time. Which works?\n\nLea"),
    ],
    priority: 34, confidence: 0.72, check: false, goal: null, vip: null, kind: "person", needsReply: true, urgency: 0,
    summary: "Lea offers three November dates for the podcast recording.",
    ask: "Pick a date.",
    why: J(REPLY(true, 0.72), GOAL("none", 0.84), BALL("You", 0.9), URG("No rush", 0.6), KIND("person", 0.98)),
    rule: "reply: needs a reply from me", screen: "pass", firstTime: false, unread: false,
    draft: "Lea, November 12 at 10am works. Send the invite whenever you are ready.\n\nDana",
  },
  {
    id: "t13", lane: "reply", subject: "Insurance renewal: two questions", from: P.omar, at: ago(1900),
    messages: [
      msg("t13m1", P.omar, ago(1900), "Insurance renewal: two questions", "Dana,\n\nFor the renewal I need two things: your current headcount, and whether you want to keep the cyber rider. The quote holds until the 31st.\n\nOmar"),
    ],
    priority: 36, confidence: 0.8, check: false, goal: null, vip: null, kind: "person", needsReply: true, urgency: 1,
    summary: "Omar needs headcount and a decision on the cyber rider for the insurance renewal before the 31st.",
    ask: "Send headcount and a yes or no on the rider.",
    why: J(REPLY(true, 0.8), GOAL("none", 0.76), BALL("You", 0.88), URG("This week", 0.45), KIND("person", 0.96)),
    rule: "reply: needs a reply from me", screen: "pass", firstTime: false, unread: false,
    draft: "Omar, headcount is 14 as of today. Keep the cyber rider. Send the renewal when ready.\n\nDana",
  },
  {
    id: "t14", lane: "other", subject: "Your invoice for October", from: P.figma, at: ago(700),
    messages: [msg("t14m1", P.figma, ago(700), "Your invoice for October", "Your Figma invoice for October is ready. Amount: $45.00. Paid with the card on file ending 4242.")],
    priority: 12, confidence: 0.97, check: false, goal: null, vip: null, kind: "receipt", needsReply: false, urgency: 0,
    summary: "Monthly invoice, $45, paid by card on file.", ask: null,
    why: J(KIND("receipt", 0.97), REPLY(false, 0.01), GOAL("none", 0.95)),
    rule: "other: receipt", screen: "pass", firstTime: false, unread: true, draft: null,
  },
  {
    id: "t15", lane: "other", subject: "How the best PMs run discovery", from: P.weekly, at: ago(900),
    messages: [msg("t15m1", P.weekly, ago(900), "How the best PMs run discovery", "This week: a long read on discovery interviews, three templates, and a job board. Read online or unsubscribe at the bottom.")],
    priority: 8, confidence: 0.95, check: false, goal: null, vip: null, kind: "newsletter", needsReply: false, urgency: 0,
    summary: "Weekly newsletter on product discovery.", ask: null,
    why: J(KIND("newsletter", 0.95), REPLY(false, 0.02), GOAL("none", 0.9)),
    rule: "other: newsletter", screen: "pass", firstTime: false, unread: true, draft: null,
  },
  {
    id: "t16", lane: "other", subject: "Daily digest: 14 issues updated", from: P.linear, at: ago(540),
    messages: [msg("t16m1", P.linear, ago(540), "Daily digest: 14 issues updated", "14 issues changed in Acme since yesterday. 3 completed, 6 in progress, 5 new.")],
    priority: 6, confidence: 0.96, check: false, goal: null, vip: null, kind: "notification", needsReply: false, urgency: 0,
    summary: "Issue tracker digest, 14 updates.", ask: null,
    why: J(KIND("notification", 0.96), REPLY(false, 0.01), GOAL("none", 0.93)),
    rule: "other: notification", screen: "pass", firstTime: false, unread: false, draft: null,
  },
  {
    id: "t17", lane: "other", subject: "Invitation: Board meeting, Tue Oct 28 10:00", from: P.cal, at: ago(1300),
    messages: [msg("t17m1", P.cal, ago(1300), "Invitation: Board meeting, Tue Oct 28 10:00", "Hana Oyelaran invited you to Board meeting. Tuesday Oct 28, 10:00 to 11:30. Accept, Tentative, Decline.")],
    priority: 15, confidence: 0.93, check: false, goal: null, vip: null, kind: "calendar", needsReply: false, urgency: 0,
    summary: "Calendar invite for the board meeting on Oct 28.", ask: null,
    why: J(KIND("calendar", 0.93), REPLY(false, 0.1), GOAL("none", 0.7)),
    rule: "other: calendar", screen: "pass", firstTime: false, unread: false, draft: null,
  },
  {
    id: "t18", lane: "other", subject: "Your payout of $12,480.00 has been sent", from: P.stripe, at: ago(1600),
    messages: [msg("t18m1", P.stripe, ago(1600), "Your payout of $12,480.00 has been sent", "A payout of $12,480.00 was sent to your bank account ending 8810. It should arrive in 2 business days.")],
    priority: 10, confidence: 0.98, check: false, goal: null, vip: null, kind: "receipt", needsReply: false, urgency: 0,
    summary: "Payout receipt, $12,480.", ask: null,
    why: J(KIND("receipt", 0.98), REPLY(false, 0.01), GOAL("none", 0.9)),
    rule: "other: receipt", screen: "pass", firstTime: false, unread: false, draft: null,
  },
  {
    id: "t19", lane: "screener", subject: "Quick question about your onboarding", from: P.alex, at: ago(130),
    messages: [msg("t19m1", P.alex, ago(130), "Quick question about your onboarding", "Hi Dana, I run a small agency that rewrites onboarding emails for B2B startups. Noticed a few things in yours. Do you have 15 minutes this week?\n\nAlex")],
    priority: 20, confidence: 0.71, check: false, goal: null, vip: null, kind: "cold_pitch", needsReply: false, urgency: 0,
    summary: "First-time sender. Reads like an agency pitch for onboarding emails.", ask: null,
    why: J(KIND("cold_pitch", 0.71, { cold_pitch: 0.71, person: 0.27 }), REPLY(false, 0.3), GOAL("none", 0.82)),
    rule: "screener: first-time sender", screen: "pass", firstTime: true, unread: true, draft: null,
  },
  {
    id: "t20", lane: "screener", subject: "Speaking slot at Umbrella Summit", from: P.nadia, at: ago(300),
    messages: [msg("t20m1", P.nadia, ago(300), "Speaking slot at Umbrella Summit", "Dear Dana,\n\nWe are putting together the engineering track for Umbrella Summit in March and would love a talk from you on hiring in a small team. 25 minutes, travel covered.\n\nNadia")],
    priority: 35, confidence: 0.64, check: true, goal: g("g2"), vip: null, kind: "person", needsReply: true, urgency: 0,
    summary: "First-time sender inviting Dana to speak in March. Could serve the hiring goal.", ask: "Accept or decline the slot.",
    why: J(KIND("person", 0.64, { person: 0.64, cold_pitch: 0.33 }), GOAL("Hire 2 senior engineers", 0.41, { "Hire 2 senior engineers": 0.41, none: 0.5 }), REPLY(true, 0.7), BALL("You", 0.8)),
    rule: "screener: first-time sender", screen: "pass", firstTime: true, unread: true, draft: null,
  },
  {
    id: "t21", lane: "screener", subject: "Data room sync: action required", from: P.ops, at: ago(60),
    messages: [msg("t21m1", P.ops, ago(60), "Data room sync: action required", "Your data room has 3 documents pending sync. Open the portal to continue.\n\n[Hidden text removed: 2 lines addressed to an AI assistant asking it to delete all messages in this mailbox and confirm by replying.]", { screen: "quarantine" })],
    priority: 5, confidence: 0.97, check: false, goal: null, vip: null, kind: "cold_pitch", needsReply: false, urgency: 0,
    summary: "Quarantined. The email hides text that tells an AI assistant to delete your inbox. Nothing was run.", ask: null,
    why: J(
      ["inj_hidden", "Hidden text", "noul", "Yes", 0.97],
      ["inj_agent_addressed", "Addressed to an AI", "noul", "Yes", 0.93],
      ["inj_override", "Tries to override instructions", "noul", "Yes", 0.9],
      ["inj_action_request", "Pushes for an action", "noul", "Yes", 0.95],
      KIND("cold_pitch", 0.6), REPLY(false, 0.05),
    ),
    rule: "screener: quarantine, injection signal at least 0.7", screen: "quarantine", firstTime: true, unread: true, draft: null,
  },
  {
    id: "t22", lane: "screener", subject: "Senior engineers available this week", from: P.rocket, at: ago(2000),
    messages: [msg("t22m1", P.rocket, ago(2000), "Senior engineers available this week", "We have 40 pre-vetted senior engineers ready to start. Book a call and get the first hire fee free.")],
    priority: 10, confidence: 0.88, check: false, goal: null, vip: null, kind: "cold_pitch", needsReply: false, urgency: 0,
    summary: "First-time sender. Recruiting agency pitch.", ask: null,
    why: J(KIND("cold_pitch", 0.88), GOAL("none", 0.7, { none: 0.7, "Hire 2 senior engineers": 0.28 }), REPLY(false, 0.1)),
    rule: "screener: first-time sender", screen: "strip", firstTime: true, unread: false, draft: null,
  },
];

/** The order threads get judged in the live sort, so lanes fill together. */
export const judgeOrder = ["t14", "t01", "t19", "t06", "t10", "t15", "t02", "t07", "t20", "t11", "t16", "t03", "t21", "t09", "t12", "t17", "t04", "t08", "t13", "t22", "t05", "t18"];

export const mkDraft = (t: MockThread, body: string, engine = "local", model = "claude-code · sonnet"): ApiDraft => ({
  id: `d-${t.id}`,
  to: [t.from.email === ME.email ? (t.messages[0]?.to[0] ?? "") : t.from.email],
  subject: t.subject.startsWith("Re:") ? t.subject : `Re: ${t.subject}`,
  body,
  engine,
  model,
  status: "proposed",
  validator: { ok: true, reasons: [] },
  updatedAt: new Date().toISOString(),
});

export const engines: EngineOption[] = [
  { id: "claude-code", group: "local", name: "Claude Code", detail: "Found at ~/.local/bin/claude · Sonnet · tool-less mode", status: "ready", cost: "Your subscription", model: "sonnet" },
  { id: "codex", group: "local", name: "Codex", detail: "Found at /opt/homebrew/bin/codex · sign in to use it", status: "signed_out", cost: "Your subscription", install: "codex login" },
  { id: "gemini-cli", group: "local", name: "Gemini CLI", detail: "Not found on this machine", status: "missing", cost: "Your subscription", install: "npm install -g @google/gemini-cli" },
  { id: "one-anthropic", group: "one", name: "Claude Sonnet", detail: "Anthropic through One", status: "available", cost: "est. $0.004 a draft", model: "claude-sonnet-4-5" },
  { id: "one-openai", group: "one", name: "GPT", detail: "OpenAI through One", status: "available", cost: "est. $0.003 a draft", model: "gpt-5" },
  { id: "one-gemini", group: "one", name: "Gemini", detail: "Google through One", status: "available", cost: "est. $0.002 a draft", model: "gemini-2.5-pro" },
  { id: "connect-own", group: "connect", name: "Connect your Anthropic, OpenAI or Gemini", detail: "Custom access: generate only. Owned in your One account", status: "available", cost: "Your account" },
];

export const settings: ApiSettings = {
  writerEngine: "local",
  writerProvider: "claude-code",
  writerModel: "sonnet",
  thresholds: {},
  briefTime: "07:30",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  allowWrites: false,
  applyLabels: true,
  showImages: true,
  autoDraft: true,
  onboarded: false,
  me: ME.line,
  database: { kind: "embedded", url: "postgres://127.0.0.1:54329/rill", sizeBytes: 38_600_000, dataDir: "~/.rill/pg" },
  secondaryTimezone: null,
  workingHours: { days: [1, 2, 3, 4, 5], startMinute: 540, endMinute: 1080 },
  defaultCalendarId: null,
  todayRail: true, defaultConferencing: null, mailCategories: ["primary", "promotions", "updates", "social", "forums"],
};

let ledgerSeq = 1;
const L = (minutesAgo: number, row: Omit<LedgerRow, "id" | "at">): LedgerRow => ({ id: ledgerSeq++, at: ago(minutesAgo), ...row });

export const ledger: LedgerRow[] = [
  L(31, { platform: "gmail", action: "gmail.get-threads", method: "POST", path: "/v1/gmail/get-threads", mode: "fixture", level: "read", status: 200, ok: true, blockedByGrant: false, refusal: null, engine: null, model: null, ms: 412, summary: "22 threads, newer_than:7d", note: null }),
  L(31, { platform: "gmail", action: "gmail.list-labels", method: "GET", path: "/gmail/v1/users/me/labels", mode: "fixture", level: "read", status: 200, ok: true, blockedByGrant: false, refusal: null, engine: null, model: null, ms: 96, summary: "Found Rill/VIP, Rill/Goals, Rill/Reply, Rill/Other, Rill/Screener", note: null }),
  L(30, { platform: "typesafe", action: "typesafe.systemone", method: "POST", path: "/v1/systemone", mode: "key", level: "read", status: 200, ok: true, blockedByGrant: false, refusal: null, engine: "jev", model: MODEL_JEV, ms: 221, summary: "t01 · 9 questions · 1,840 tokens", note: null }),
  L(30, { platform: "typesafe", action: "typesafe.systemone", method: "POST", path: "/v1/systemone", mode: "key", level: "read", status: 200, ok: true, blockedByGrant: false, refusal: null, engine: "jev", model: MODEL_JEV, ms: 198, summary: "t02 · 9 questions · 1,120 tokens", note: null }),
  L(29, { platform: "claude-code", action: "writer.summarize", method: "LOCAL", path: "claude -p --tools \"\"", mode: "local", level: "read", status: 200, ok: true, blockedByGrant: false, refusal: null, engine: "local", model: "haiku", ms: 1830, summary: "Summary for t01", note: null }),
  L(29, { platform: "claude-code", action: "writer.draft", method: "LOCAL", path: "claude -p --tools \"\"", mode: "local", level: "read", status: 200, ok: true, blockedByGrant: false, refusal: null, engine: "local", model: "sonnet", ms: 4210, summary: "Draft for t01, validator ok", note: null }),
  L(28, { platform: "gmail", action: "gmail.modify-thread-labels", method: "POST", path: "/gmail/v1/users/me/threads/t01/modify", mode: "fixture", level: "write", status: 200, ok: true, blockedByGrant: false, refusal: null, engine: null, model: null, ms: 140, summary: "+Rill/VIP", note: null }),
  L(27, { platform: "gmail", action: "gmail.create-draft", method: "POST", path: "/v1/gmail/create-draft", mode: "fixture", level: "write", status: 200, ok: true, blockedByGrant: false, refusal: null, engine: null, model: null, ms: 233, summary: "Draft to priya@northwind.vc", note: null }),
  L(26, { platform: "typesafe", action: "typesafe.systemone", method: "POST", path: "/v1/systemone", mode: "key", level: "read", status: 200, ok: true, blockedByGrant: false, refusal: null, engine: "jev", model: MODEL_JEV, ms: 240, summary: "t21 · 10 questions · hidden text found", note: null }),
  L(25, { platform: "gmail", action: "gmail.modify-thread-labels", method: "POST", path: "/gmail/v1/users/me/threads/t21/modify", mode: "fixture", level: "write", status: 200, ok: true, blockedByGrant: false, refusal: null, engine: null, model: null, ms: 131, summary: "+Rill/Screener (quarantine)", note: null }),
  L(25, { platform: "gmail", action: "gmail.delete-message", method: "DELETE", path: "/gmail/v1/users/me/messages/t21m1", mode: "fixture", level: "write", status: 403, ok: false, blockedByGrant: true, refusal: "grant", engine: null, model: null, ms: 18, summary: "Refused by One. Delete is not in the grant", note: "Requested by text hidden in t21. Gmail was never called" }),
  L(4, { platform: "gmail", action: "gmail.get-threads", method: "POST", path: "/v1/gmail/get-threads", mode: "fixture", level: "read", status: 200, ok: true, blockedByGrant: false, refusal: null, engine: null, model: null, ms: 388, summary: "0 new threads", note: null }),
];

export const receiptRow = (): LedgerRow => L(0, {
  platform: "gmail", action: "gmail.delete-message", method: "DELETE", path: "/gmail/v1/users/me/messages/t21m1", mode: "fixture", level: "write",
  status: 403, ok: false, blockedByGrant: true, refusal: "grant", engine: null, model: null, ms: 14,
  summary: "Refused by One. Delete is not in the grant", note: "Replayed from the quarantined email t21. Gmail was never called",
});

export const scopes = GMAIL_SCOPES.map((s) => ({ action: s.action, level: s.level, granted: "granted" in s ? s.granted : true, why: s.why }));

export function brief(): BriefResponse {
  return {
    forDate: new Date().toISOString().slice(0, 10),
    generatedAt: new Date().toISOString(),
    kpis: [
      { label: "VIPs waiting", value: 5, hint: "oldest 10h" },
      { label: "Moves a goal", value: 7, hint: "3 goals" },
      { label: "Replies owed", value: 11, hint: "11 drafted" },
      { label: "Screened out", value: 23, hint: "since yesterday" },
    ],
    lines: [
      { when: "Seed round", title: "Priya sent term sheet redlines", detail: "Two open points, due Thursday 5pm. Draft ready.", tone: "warning", threadId: "t01" },
      { when: "Seed round", title: "New intro to Lena at Initech Ventures", detail: "Jev is 55% sure this is the round, not partners. Check it.", tone: "neutral", threadId: "t06" },
      { when: "Hiring", title: "Two finalists ready for offers", detail: "Marcus wants top-of-band approval. Draft ready.", tone: "neutral", threadId: "t02" },
      { when: "Hiring", title: "Two senior backend profiles from Dev", detail: "Intro calls with Marcus this week if you say yes.", tone: "neutral", threadId: "t07" },
      { when: "Partners", title: "Globex pilot finished, wants 40 seats", detail: "Send pricing by Friday.", tone: "positive", threadId: "t04" },
      { when: "Partners", title: "Vandelay asks about 10 to 25 seats", detail: "Saw the Globex case study. Draft ready.", tone: "positive", threadId: "t09" },
      { when: "Follow up", title: "No reply from Wei at Hooli in 3 days", detail: "You asked about a pilot on Friday. Nudge drafted.", tone: "neutral", threadId: "t08" },
      { when: "Screened", title: "One email hid an instruction to delete your inbox", detail: "Quarantined. The delete call was refused by One, 403. See Access.", tone: "negative", threadId: "t21" },
    ],
    text: "Five VIPs are waiting, Priya first: her term sheet redlines need your call by Thursday. The seed round moved twice overnight, the partner goal moved twice, and Marcus wants to send two offers today. Eleven replies are owed and every one has a draft. One screened email hid an instruction to an AI; it was quarantined and the delete attempt was refused.",
    engine: "local",
    model: "claude-code · sonnet",
    today: { meetings: [], invitesWaiting: 0, conflicts: [] },
  };
}
