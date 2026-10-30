// @rill/core: the headless brain of Rill. The server imports only from here.

export * from "./types.js";
export * from "./api-types.js";
export * as contacts from "./contacts.js";
export * as conferencing from "./conferencing.js";
export * from "./contract.js";
export * from "./db/index.js";

export { newId } from "./ids.js";
export { ledger, toLedgerRow } from "./ledger.js";
export { one, DELETE_ACTION_ID, grantedConnections, forgetGrant } from "./one.js";
export { getMailProvider, getCalendarProvider } from "./providers/registry.js";
export { gmailMail, GMAIL_ACTIONS, LANE_LABEL_PREFIX } from "./providers/gmail/mail.js";
export { googleCalendar, CALENDAR_ACTIONS } from "./providers/gmail/calendar.js";
export { outlookMail, OUTLOOK_MAIL_ACTIONS } from "./providers/outlook/mail.js";
export { outlookCalendar, OUTLOOK_CALENDAR_ACTIONS } from "./providers/outlook/calendar.js";
export * as sanitize from "./sanitize.js";
export { htmlToText, stripQuoted, hiddenText, parseFrom, parseAddressList, emailOf, domainOf } from "./sanitize.js";
export { jev, screenOf, SYSTEM_ONE_ACTION, DEFAULT_JEV_MODEL, URGENCY_LEGEND, QUESTION_LABELS, KIND_LABELS, BALL_LABELS } from "./jev.js";
export { computeFacts, vipMatch, isCalendarInvite, everWroteTo } from "./facts.js";
export { policy, compileInbox, loadPolicy, decide, effectiveThresholds, type CompiledPolicy } from "./policy.js";
export { writer, fastVariant, meOf, connectConfigured, fixtureWriter, localWriter, oneWriter } from "./writer/index.js";
export { validateDraft, MAX_DRAFT_WORDS } from "./writer/validate.js";
export * as prompts from "./writer/prompts.js";
export { NO_RECORDING, isCanned } from "./writer/engines/fixture.js";
export { LOCAL_MODELS } from "./writer/engines/local.js";
export { ONE_MODELS, ANTHROPIC_ACTION } from "./writer/engines/one.js";
export { agents, resolveBin, probeSignIn, CLI_BIN, prettyPath } from "./agents.js";
export { fixtures, resolveFixtureWhen, isFixtureThreadId, LIST_UNSUBSCRIBE_LABEL, CALENDAR_INVITE_LABEL, inboxPath, calendarPath, recordedDir } from "./fixtures.js";
export { sync, dbId, laneLabel, mapLimit, toMail, toThreadRecord, loadThread, reconcile, followUps, addDays, categoriesOf, inReadTabs, JEV_HOLD_MS } from "./sync.js";
export * from "./categories.js";
export { meetingSoonWith } from "./facts.js";
export { AlreadyCancelled, EditNotAllowed, calendar, calendarReceiptDemo, cancelledProviderIds, conflictsAmong, dbCalendarId, dbEventId, isEditable, mergeAttendees, movedFromOf, stripLink, toApiEvent, toApiCalendar } from "./calendar.js";
export { parseIcs } from "./providers/gmail/mappers.js";
export { brief, buildBriefInput, humanAge, localDayWindowUTC, todaysMeetings } from "./brief.js";
export { ask, askInbox, retrieve, keywordsOf } from "./ask.js";
export { assistant, respond } from "./assistant.js";
