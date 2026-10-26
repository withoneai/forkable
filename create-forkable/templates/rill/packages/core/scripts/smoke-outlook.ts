// Smoke test for Outlook mail and calendar: no database, no network, no keys.
// A stubbed Connect grant answers each One action with a payload shaped from
// that action's documented response in the One catalog (fixtures/outlook/),
// so the real provider code builds every request and maps every answer. This
// is fixture verification only: no live Outlook grant has run it.
// Run: pnpm exec tsx scripts/smoke-outlook.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { OneConnectClient } from "@withone/connect/server";
import {
  CALENDAR_INVITE_LABEL, LIST_UNSUBSCRIBE_LABEL, OUTLOOK_CALENDAR_ACTIONS, OUTLOOK_MAIL_ACTIONS, actionLabel, compileInbox, conferencing, decide, fixtures,
  getCalendarProvider, getMailProvider, isCalendarInvite, isEditable, jev, mergeAttendees, platformLabel, writer, DEFAULT_THRESHOLDS,
  type CalendarEvent, type Ctx, type Facts, type GoalRow, type JevInput, type LedgerRow, type VipRow, type Writer,
} from "../src/index.js";
import { wallClockToUtc } from "../src/tz.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const FIX = path.join(ROOT, "fixtures/outlook");
const load = <T = any>(name: string): T => JSON.parse(readFileSync(path.join(FIX, name), "utf8")) as T; // eslint-disable-line @typescript-eslint/no-explicit-any

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

// ---- the stubbed grant ---------------------------------------------------------

interface Sent { actionId: string; method: string; path: string; connectionKey: string; body?: any; query?: Record<string, string | string[]> } // eslint-disable-line @typescript-eslint/no-explicit-any
const sent: Sent[] = [];
const last = (actionId: string) => [...sent].reverse().find((s) => s.actionId === actionId);
const M = OUTLOOK_MAIL_ACTIONS;
const C = OUTLOOK_CALENDAR_ACTIONS;
const MAIL_KEY = "test::outlook-mail::dana";
const CAL_KEY = "test::outlook-calendar::dana";
const TYPESAFE_KEY = "test::typesafe::dana";

function answer(s: Sent): { status: number; data: unknown } {
  const q = s.query ?? {};
  switch (s.actionId) {
    case M.getProfile.id: return { status: 200, data: load("me.json") };
    case M.listMessages.id: {
      const all = load("messages.json");
      const conv = String(q.$filter ?? "").match(/conversationId eq '([^']+)'/)?.[1];
      return { status: 200, data: conv ? { value: all.value.filter((m: { conversationId: string }) => m.conversationId === conv) } : all };
    }
    case M.listFolderMessages.id: return { status: 200, data: load("sent-items.json") };
    case M.updateMessage.id: return { status: 200, data: { id: s.path.split("/").pop(), categories: s.body?.categories } };
    case M.createReply.id: return { status: 201, data: load("create-reply.json") };
    case M.createMessage.id: return { status: 201, data: load("create-message.json") };
    case M.reply.id: case M.sendDraft.id: return { status: 202, data: {} };
    case C.calendars.id: return { status: 200, data: load("calendars.json") };
    case C.calendarView.id: return { status: 200, data: load("calendar-view.json") };
    case C.eventsGet.id: return { status: 200, data: load("event-after-rsvp.json") };
    case C.accept.id: case C.tentativelyAccept.id: case C.decline.id: case C.eventsCancel.id: return { status: 202, data: {} };
    case C.eventsInsert.id: return { status: 201, data: load("event-created.json") };
    case C.eventsPatch.id: return { status: 200, data: load("event-patched.json") };
    case C.getSchedule.id: return { status: 200, data: load("schedule.json") };
    case "conn_mod_def::GNh4bXcHPaU::V2ndvy5CQJmYHvkElwVM_w": return { status: 200, data: fixtures.readRecording(ROOT, "t01")!.jev };
    default: return { status: 404, data: null };
  }
}

const grant = {
  async isConnected() { return true; },
  async listConnections() {
    return [
      { platform: "outlook-mail", key: MAIL_KEY, title: "dana@acme.com" },
      { platform: "outlook-calendar", key: CAL_KEY, title: "Dana's calendar" },
      { platform: "typesafe", key: TYPESAFE_KEY, title: "TypeSafe" },
    ];
  },
  async runAction(_userId: string, req: Sent) {
    sent.push(req);
    // One refuses a delete before the provider is called: delete is never in the grant.
    if (req.method === "DELETE") return { status: 403, ok: false, data: null, blockedByGrant: true, refusal: "grant" };
    const a = answer(req);
    return { status: a.status, ok: a.status < 300, data: a.data, blockedByGrant: false, refusal: null };
  },
} as unknown as OneConnectClient;

let ledgerId = 0;
const ledgerRows: LedgerRow[] = [];
// ledger.record is the only database write a provider call makes.
const db = {
  insert: () => ({
    values: (v: Record<string, unknown>) => ({
      returning: async () => {
        const row = { ...v, id: ++ledgerId, at: new Date() } as unknown as LedgerRow;
        ledgerRows.push(row);
        return [row];
      },
    }),
  }),
};

function ctxFor(source: "live" | "sample"): Ctx {
  return {
    db,
    mailbox: {
      id: `mbx_outlook_${source}`, userId: "usr_dana", source, mode: source === "live" ? "connect" : "fixture", connectionKey: source === "live" ? MAIL_KEY : null,
      mailProvider: "outlook-mail", calendarProvider: "outlook-calendar", calendarConnectionKey: source === "live" ? CAL_KEY : null,
      address: "dana@acme.com", label: "dana@acme.com", status: "active", syncState: {},
    },
    user: { id: "usr_dana", name: "Dana Reyes", email: "dana@acme.com" },
    settings: { mailboxId: `mbx_outlook_${source}`, me: "Dana Reyes, CEO of Acme Inc", timezone: "America/Los_Angeles", defaultConferencing: null },
    oneConnect: source === "live" ? grant : null,
    env: { LOCAL: true, ROOT },
    emit: () => {},
  } as unknown as Ctx;
}

const ctx = ctxFor("live");
const mail = getMailProvider("outlook-mail");
const cal = getCalendarProvider("outlook-calendar");
const receipt = (r: LedgerRow) => `${platformLabel(r.platform)} · ${actionLabel(r.action)}   ${r.blockedByGrant ? "declined" : r.ok ? "ok" : "failed"}, ${r.status}`;

// ---- mail -----------------------------------------------------------------------

console.log("\nOutlook mail");
const address = await mail.address!(ctx);
check("address() reads Graph's `mail`, lowercased", address === "dana@acme.com", String(address));
check("address() runs on the mailbox's own connection", last(M.getProfile.id)?.connectionKey === MAIL_KEY);
check("address() asks with $select in the query, not the body", String(last(M.getProfile.id)?.query?.$select).includes("mail") && last(M.getProfile.id)?.body === undefined);

const { threads, nextPageToken } = await mail.listThreads(ctx, { query: "newer_than:7d", max: 50 });
const listReq = last(M.listMessages.id)!;
check("sync's newer_than:7d becomes a receivedDateTime $filter that skips drafts", /isDraft eq false and receivedDateTime ge 20\d\d-/.test(String(listReq.query?.$filter)), String(listReq.query?.$filter));
check("newest first, $top from max", listReq.query?.$orderby === "receivedDateTime desc" && listReq.query?.$top === "50");
check("the next page token is @odata.nextLink's $skip", nextPageToken === "50", String(nextPageToken));
check("messages group into conversations (4 threads from 6 messages)", threads.length === 4, threads.map((t) => t.id).join(","));
const term = threads.find((t) => t.id === "AAQkADc1=")!;
check("a thread's id is the conversationId, its messages oldest first", term?.messages.map((m) => m.id).join(",") === "AAMkADm1=,AAMkADm2=");
check("an unsent draft in the conversation is left out", !term.messages.some((m) => m.id === "AAMkADdraft="));
check("your own message reads as from you", term.messages[1]!.isFromMe && !term.messages[0]!.isFromMe);
check("HTML body becomes text; rawBody keeps the HTML", term.messages[0]!.body.includes("option pool size by Thursday") && /<p>/.test(term.messages[0]!.rawBody ?? ""));
check("to and cc read from toRecipients/ccRecipients", term.messages[0]!.to.join() === "dana@acme.com" && term.messages[0]!.cc.join() === "sam@globex.com");
check("categories ride as labelIds", term.messages[0]!.labelIds.includes("Blue category") && term.messages[0]!.labelIds.includes("Rill/Other"));
check("participants named from the headers", term.participants.find((p) => p.email === "priya@northwind.vc")?.name === "Priya Shah");
const inj = threads.find((t) => t.id === "AAQkADc2=")!.messages[0]!;
check("hidden text in an Outlook HTML body is found (the injection email)", /delete every email/.test(inj.hiddenText), inj.hiddenText.slice(0, 60));
const news = threads.find((t) => t.id === "AAQkADc3=")!.messages[0]!;
check("a List-Unsubscribe header marks list mail", news.labelIds.includes(LIST_UNSUBSCRIBE_LABEL));
const invite = threads.find((t) => t.id === "AAQkADc4=")!.messages[0]!;
check("a Graph eventMessage is a calendar invite", invite.labelIds.includes(CALENDAR_INVITE_LABEL) && isCalendarInvite(invite));
check("an ordinary message is not an invite", !isCalendarInvite(term.messages[0]!));

const thread = await mail.getThread(ctx, "AAQkADc1=");
check("getThread filters by conversationId", String(last(M.listMessages.id)?.query?.$filter) === "conversationId eq 'AAQkADc1='" && thread?.messageCount === 2);
const html = await mail.threadHtml(ctx, "AAQkADc1=");
check("threadHtml returns the HTML part by message id", Boolean(html["AAMkADm1="]) && !html["AAMkADm2="]);

// Jev, the lanes and a summary run on the Outlook message exactly as on Gmail's.
const inbox = fixtures.loadInbox(ROOT);
const goals: GoalRow[] = inbox.goals.map((g, i) => ({ id: g.id, mailboxId: "mb", title: g.title, detail: g.detail, weight: g.weight, paused: false, position: i, createdAt: new Date() }));
const vips: VipRow[] = inbox.vips.map((v) => ({ id: v.id, mailboxId: "mb", name: v.name, matchKind: v.matchKind, match: v.match, tier: v.tier, rules: (v.rules ?? {}) as VipRow["rules"], createdAt: new Date() }));
const priyaMail = term.messages[0]!;
const facts: Facts = { vipId: null, vipTier: null, team: false, firstTimeSender: false, fromMe: false, meSentLast: true, hasListUnsubscribe: false, isReply: true, calendarInvite: false, messageCount: 2 };
const jevInput: JevInput = { me: "Dana Reyes, CEO of Acme Inc", goals, vips, mail: priyaMail, thread: term, facts };
const answers = await jev.judge(ctx, jevInput);
const jevReq = [...sent].reverse().find((s) => s.path === "/v1/systemone")!;
check("Jev judges the Outlook message on the grant's TypeSafe connection", jevReq?.connectionKey === TYPESAFE_KEY);
check("Jev's state carries the Outlook sender and subject", JSON.stringify(jevReq?.body).includes("priya@northwind.vc") && JSON.stringify(jevReq?.body).includes("Term sheet, option pool"));
const policy = compileInbox(readFileSync(path.join(ROOT, "INBOX.md"), "utf8"));
const decision = decide(policy, { facts, answers, goals, vips, senderStatus: "let_in", thresholds: DEFAULT_THRESHOLDS, judgedBy: "jev" });
check(`the policy puts it in a lane (${decision.lane}, priority ${decision.priority})`, ["vip", "goals", "reply", "other", "screener"].includes(decision.lane));
let summaryPrompt = "";
const w: Writer = {
  engine: "local", provider: "claude-code", model: "fixture",
  async complete(_c, input) { summaryPrompt = input.user; return { text: JSON.stringify({ summary: "Priya needs the option pool size by Thursday.", ask: "Confirm the pool size" }), model: "fixture", costUsd: null, ms: 1 }; },
};
const summary = await writer.summarize(ctx, w, priyaMail, term);
check("the summary prompt reads the Outlook body", summaryPrompt.includes("option pool size by Thursday"));
check("a summary comes back", summary.summary.startsWith("Priya needs") && summary.ask === "Confirm the pool size");

await mail.modifyThreadLabels(ctx, "AAQkADc1=", ["Rill/VIP"], ["Rill/Other"]);
const patches = sent.filter((s) => s.actionId === M.updateMessage.id);
const priyaPatch = patches.find((p) => p.path.includes("AAMkADm1"));
check("lane move keeps other categories, drops the old lane, adds the new", JSON.stringify(priyaPatch?.body?.categories) === JSON.stringify(["Blue category", "Rill/VIP"]), JSON.stringify(priyaPatch?.body));
check("Rill's own marks (INBOX/SENT) never become categories", patches.every((p) => !p.body.categories.some((c: string) => c === "INBOX" || c === "SENT")));
check("ensureLabel is the category name itself", (await mail.ensureLabel(ctx, "Rill/VIP")) === "Rill/VIP");

const saved = await mail.createDraft(ctx, { to: ["priya@northwind.vc"], subject: "RE: Term sheet, option pool", body: "Confirmed: 10 percent.", threadId: "AAQkADc1=", inReplyTo: "<priya-1@northwind.vc>", replyToMessageId: "AAMkADm1=" });
const replyDraft = last(M.createReply.id)!;
check("a reply draft is Graph's createReply on the answered message", replyDraft.path === "/v1.0/me/messages/AAMkADm1%3D/microsoft.graph.createReply", replyDraft.path);
check("the draft text goes in `Comment`, as the catalog documents", replyDraft.body?.Comment === "Confirmed: 10 percent.");
check("the saved draft id is the new Outlook draft's", saved.gmailDraftId === "AAMkADdraftReply=");
sent.length = 0;
await mail.createDraft(ctx, { to: ["priya@northwind.vc"], subject: "RE: Term sheet", body: "x", threadId: "AAQkADc1=", inReplyTo: "<priya-1@northwind.vc>" });
check("without the Graph id, the reply target is found by Message-ID in the conversation", last(M.createReply.id)?.path.includes("AAMkADm1") === true);

const composed = await mail.createDraft(ctx, { to: ["sam@globex.com"], subject: "Intro: Acme and Globex", body: "Sam, meet Priya." });
const newDraft = last(M.createMessage.id)!;
check("Compose saves a new message to Outlook Drafts", composed.gmailDraftId === "AAMkADdraftNew=" && newDraft.body?.subject === "Intro: Acme and Globex");
check("Compose writes toRecipients and a text body", newDraft.body?.toRecipients?.[0]?.emailAddress?.address === "sam@globex.com" && newDraft.body?.body?.content === "Sam, meet Priya.");

await mail.send(ctx, { to: ["priya@northwind.vc"], subject: "RE: Term sheet", body: "Confirmed.", threadId: "AAQkADc1=", replyToMessageId: "AAMkADm1=" });
const replySend = last(M.reply.id)!;
check("Send on a reply is Graph's reply, with the text in Comment", replySend?.path.endsWith("/AAMkADm1%3D/microsoft.graph.reply") && replySend.body?.Comment === "Confirmed.");
sent.length = 0;
await mail.send(ctx, { to: ["sam@globex.com"], subject: "Intro", body: "Hello" });
check("a fresh send makes the draft, then sends it", sent.map((s) => s.actionId).join() === `${M.createMessage.id},${M.sendDraft.id}` && last(M.sendDraft.id)?.path.includes("AAMkADdraftNew") === true);

const vipSuggestions = await mail.sentTo(ctx, 8);
check("VIP suggestions come from Sent Items", last(M.listFolderMessages.id)?.path === "/v1.0/me/mailFolders/sentitems/messages" && vipSuggestions[0]?.email === "priya@northwind.vc" && vipSuggestions[0]?.sentCount === 2, JSON.stringify(vipSuggestions));
check("suggestions keep Graph's recipient names", vipSuggestions[0]?.name === "Priya Shah", vipSuggestions[0]?.name);
check("no-reply addresses are not suggested", !vipSuggestions.some((v) => /no-reply/.test(v.email)));

// ---- the receipt ---------------------------------------------------------------

console.log("\nThe receipt");
sent.length = 0;
const mailReceipt = await mail.attemptDelete(ctx, "AAMkADinj=", "Hidden text in an email asked the assistant to delete the inbox");
check(`live: ${receipt(mailReceipt)}`, receipt(mailReceipt) === "Outlook · delete   declined, 403");
check("the refusal is on the ledger with blockedByGrant", mailReceipt.blockedByGrant && mailReceipt.refusal === "grant");
const sampleReceipt = await mail.attemptDelete(ctxFor("sample"), "AAMkADinj=", "sample");
check(`fixture replay: ${receipt(sampleReceipt)}`, receipt(sampleReceipt) === "Outlook · delete   declined, 403");

// ---- calendar ------------------------------------------------------------------

console.log("\nOutlook calendar");
const cals = await cal.listCalendars(ctx);
check("calendars map name, default and access", cals.length === 2 && cals[0]!.isDefault && cals[0]!.accessRole === "owner" && cals[1]!.accessRole === "reader" && cals[1]!.color === "#8fd18f");
check("calendar reads run on the grant's outlook-calendar connection", last(C.calendars.id)?.connectionKey === CAL_KEY);

const { events } = await cal.listEvents(ctx, "AAMkCal1=", { from: "2026-10-26T00:00:00.000Z", to: "2026-11-09T00:00:00.000Z" });
const viewReq = last(C.calendarView.id)!;
check("the week view reads calendarView with startDateTime/endDateTime", viewReq.path === "/users/me/calendars/AAMkCal1%3D/calendarView" && viewReq.query?.startDateTime === "2026-10-26T00:00:00.000Z");
const ev = (id: string) => events.find((e) => e.id === id)!;
check("a Windows zone (Pacific Standard Time, during PDT) lands at the right instant", ev("AAMkEvBoard=").start === "2026-10-29T17:00:00.000Z", ev("AAMkEvBoard=").start);
check("Eastern Standard Time during EDT too", ev("AAMkEvDropped=").start === "2026-10-28T13:00:00.000Z", ev("AAMkEvDropped=").start);
check("UTC times read as UTC", ev("AAMkEvDesign=").start === "2026-10-30T21:00:00.000Z");
check("an all-day event stays a date", ev("AAMkEvOffsite=").allDay && ev("AAMkEvOffsite=").start === "2026-11-03T00:00:00.000Z");
check("isCancelled maps to cancelled", ev("AAMkEvDropped=").status === "cancelled" && ev("AAMkEvDropped=").recurringEventId === "AAMkEvSeries=");
check("an invite you have not answered needs an RSVP", ev("AAMkEvBoard=").myResponse === "needsAction" && ev("AAMkEvBoard=").attendees.find((a) => a.self)?.response === "needsAction");
check("an event you organize is yours to edit", isEditable(ev("AAMkEvDesign=")) && ev("AAMkEvDesign=").attendees.some((a) => a.self && a.organizer));
check("an event someone else organizes is not", !isEditable(ev("AAMkEvBoard=")));
check("the Teams link reads from onlineMeeting.joinUrl", ev("AAMkEvDesign=").joinUrl?.startsWith("https://teams.microsoft.com/") === true);
check("attendee replies map (tentativelyAccepted)", ev("AAMkEvDesign=").attendees.find((a) => a.email === "priya@northwind.vc")?.response === "tentative");
check("the HTML body becomes the description", ev("AAMkEvBoard=").description === "Quarterly board sync. Agenda to follow.");

sent.length = 0;
const rsvped = await cal.rsvp(ctx, "AAMkCal1=", "AAMkEvBoard=", "tentative", "Might run late");
const rsvpReq = last(C.tentativelyAccept.id)!;
check("Maybe is tentativelyAccept on the event's own calendar", rsvpReq?.path === "/v1.0/me/calendars/AAMkCal1%3D/events/AAMkEvBoard%3D/microsoft.graph.tentativelyAccept");
check("RSVP body is SendResponse + Comment, as documented", rsvpReq.body?.SendResponse === true && rsvpReq.body?.Comment === "Might run late");
check("the event is read back with your answer", rsvped.myResponse === "tentative" && last(C.eventsGet.id)?.path === "/v1.0/me/calendars/AAMkCal1%3D/events/AAMkEvBoard%3D");
await cal.rsvp(ctx, "AAMkCal1=", "AAMkEvBoard=", "accepted");
await cal.rsvp(ctx, "AAMkCal1=", "AAMkEvBoard=", "declined");
check("Yes and No are accept and decline", Boolean(last(C.accept.id)) && Boolean(last(C.decline.id)) && last(C.accept.id)?.body?.Comment === undefined);

const offer = await conferencing.available(ctx);
check("an Outlook calendar offers Teams (Zoom only when the grant has it)", offer.available.join() === "teams" && offer.default === "teams", JSON.stringify(offer));
const created = await cal.createEvent(ctx, "AAMkCal1=", { title: "Pilot kickoff", description: "Kickoff for the Globex pilot.", start: "2026-11-05T17:00:00.000Z", end: "2026-11-05T17:45:00.000Z", timeZone: "America/Los_Angeles", attendees: ["sam@globex.com"], attendeeNames: { "sam@globex.com": "Sam Ortiz" }, conferencing: "teams" });
const insert = last(C.eventsInsert.id)!;
check("New event with Teams sets isOnlineMeeting and teamsForBusiness", insert.body?.isOnlineMeeting === true && insert.body?.onlineMeetingProvider === "teamsForBusiness");
check("times go out as a UTC wall clock", insert.body?.start?.dateTime === "2026-11-05T17:00:00" && insert.body?.start?.timeZone === "UTC");
check("attendees go out as emailAddress + required", insert.body?.attendees?.[0]?.emailAddress?.address === "sam@globex.com" && insert.body?.attendees?.[0]?.type === "required");
check("the created event carries the Teams join link", created.joinUrl === "https://teams.microsoft.com/l/meetup-join/19%3ameeting_pilot-kickoff" && created.id === "AAMkEvNew=");
check("and keeps the zone it was made in", created.timeZone === "America/Los_Angeles");

const design = ev("AAMkEvDesign=");
const attendees = mergeAttendees(design.attendees, ["sam@globex.com", "priya@northwind.vc", "lee@initech.example"], {}, "dana@acme.com");
sent.length = 0;
const moved = await cal.patchEvent(ctx, "AAMkCal1=", "AAMkEvDesign=", { title: "Design partner call (moved)", start: "2026-10-30T22:00:00.000Z", end: "2026-10-30T22:45:00.000Z", timeZone: "America/Los_Angeles", allDay: false, attendees, notify: "all", current: design });
const patchReq = last(C.eventsPatch.id)!;
check("Edit is a PATCH of subject, times and attendees", patchReq.body?.subject === "Design partner call (moved)" && patchReq.body?.start?.dateTime === "2026-10-30T22:00:00");
check("you are not sent back as your own attendee", patchReq.body?.attendees?.length === 3 && !patchReq.body.attendees.some((a: { emailAddress: { address: string } }) => a.emailAddress.address === "dana@acme.com"));
check("Graph has no sendUpdates: nothing about notify is sent (Outlook tells guests itself)", !("sendUpdates" in (patchReq.query ?? {})) && !("notify" in patchReq.body));
check("the edited event comes back mapped, new guest included", moved.title === "Design partner call (moved)" && moved.attendees.some((a) => a.email === "lee@initech.example"));

let teamsOff = "";
try { await cal.patchEvent(ctx, "AAMkCal1=", "AAMkEvDesign=", { conferencing: null, current: design }); } catch (e) { teamsOff = (e as Error).message; }
check("taking a Teams link off says Outlook keeps it", /keeps a Teams link/.test(teamsOff));
const teamsOn = await cal.patchEvent(ctx, "AAMkCal1=", "AAMkEvBoard=", { conferencing: "teams", current: { ...ev("AAMkEvBoard="), joinUrl: null } as CalendarEvent });
check("adding Teams to an event is isOnlineMeeting on the PATCH", last(C.eventsPatch.id)?.body?.isOnlineMeeting === true && Boolean(teamsOn));

sent.length = 0;
const cancelled = await cal.patchEvent(ctx, "AAMkCal1=", "AAMkEvDesign=", { status: "cancelled", notify: "all", current: design });
const cancelReq = last(C.eventsCancel.id)!;
check("Cancel is Graph's cancel action, not a PATCH or a delete", cancelReq?.path === "/v1.0/me/calendars/AAMkCal1%3D/events/AAMkEvDesign%3D/microsoft.graph.cancel" && !last(C.eventsPatch.id) && !sent.some((s) => s.method === "DELETE"));
check("the cancellation note is `Comment`", typeof cancelReq.body?.Comment === "string" && cancelReq.body.Comment.length > 0);
check("the event reads cancelled", cancelled.status === "cancelled");

const fb = await cal.freeBusy(ctx, ["AAMkCal1=", "AAMkCal2="], "2026-10-30T15:00:00.000Z", "2026-10-31T03:00:00.000Z");
const fbReq = last(C.getSchedule.id)!;
check("free/busy asks getSchedule for your address, PascalCase body", JSON.stringify(fbReq.body?.Schedules) === '["dana@acme.com"]' && fbReq.body?.StartTime?.timeZone === "UTC" && fbReq.body?.EndTime?.dateTime === "2026-10-31T03:00:00");
const busy = Object.values(fb).flat();
check("busy and tentative count, free does not", busy.length === 2 && busy[0]!.start === "2026-10-30T21:00:00.000Z", JSON.stringify(busy));
// Offer times keeps only slots that do not overlap a busy one (server/src/routes/calendar.ts).
const slots = [{ start: "2026-10-30T18:00:00.000Z", end: "2026-10-30T18:30:00.000Z" }, { start: "2026-10-30T21:15:00.000Z", end: "2026-10-30T21:45:00.000Z" }];
const stillFree = slots.filter((s) => !busy.some((b) => b.start < s.end && b.end > s.start));
check("Offer times drops the slot the Outlook schedule shows as busy", stillFree.length === 1 && stillFree[0]!.start === "2026-10-30T18:00:00.000Z");

const calReceipt = await cal.attemptDelete(ctx, "AAMkCal1=", "AAMkEvBoard=", "Rill never deletes a meeting from your calendar");
check(`calendar: ${receipt(calReceipt)}`, receipt(calReceipt) === "Outlook Calendar · delete   declined, 403");
check("the refused delete names your address as the Graph user, never `me` on /users/", last(C.eventsDelete.id)?.path.startsWith("/users/dana%40acme.com/") === true);

// ---- time zones ----------------------------------------------------------------

console.log("\nGraph time zones");
check("Pacific Standard Time across the 2026-11-01 change", wallClockToUtc("2026-10-30T09:00:00.0000000", "Pacific Standard Time").toISOString() === "2026-10-30T16:00:00.000Z" && wallClockToUtc("2026-11-02T09:00:00.0000000", "Pacific Standard Time").toISOString() === "2026-11-02T17:00:00.000Z");
check("W. Europe Standard Time across the 2026-10-25 change", wallClockToUtc("2026-10-24T11:00:00", "W. Europe Standard Time").toISOString() === "2026-10-24T09:00:00.000Z" && wallClockToUtc("2026-10-26T10:00:00", "W. Europe Standard Time").toISOString() === "2026-10-26T09:00:00.000Z");
check("an IANA name works as is (Doha)", wallClockToUtc("2026-10-30T14:00:00", "Asia/Qatar").toISOString() === "2026-10-30T11:00:00.000Z");
check("an unknown zone reads as UTC", wallClockToUtc("2026-10-30T14:00:00", "tzone://Microsoft/Custom").toISOString() === "2026-10-30T14:00:00.000Z");

check(`every call left a ledger row (${ledgerRows.length})`, ledgerRows.length >= sent.length && ledgerRows.every((r) => r.platform !== undefined));

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
