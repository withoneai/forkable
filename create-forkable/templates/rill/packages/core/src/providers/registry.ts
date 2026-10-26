import type { CalendarProvider, MailProvider } from "../contract.js";
import type { CalendarProviderKey, MailProviderKey } from "../types.js";
import { googleCalendar } from "./gmail/calendar.js";
import { gmailMail } from "./gmail/mail.js";
import { outlookCalendar } from "./outlook/calendar.js";
import { outlookMail } from "./outlook/mail.js";

// Nothing above this file knows which provider it is talking to: it asks for
// "the mail provider" or "the calendar provider" for a mailbox, by key, and
// gets back something that satisfies MailProvider / CalendarProvider.
// Gmail and Google Calendar are verified on a real grant. Outlook mail and
// calendar are wired from the One catalog and fixture-verified
// (packages/core/scripts/smoke-outlook.ts); `verified` stays false until a
// real Outlook grant has run them (docs/CONTRACT.md).

const MAIL: Record<MailProviderKey, MailProvider> = {
  gmail: gmailMail,
  "outlook-mail": outlookMail,
};

const CALENDAR: Record<CalendarProviderKey, CalendarProvider> = {
  "google-calendar": googleCalendar,
  "outlook-calendar": outlookCalendar,
};

export function getMailProvider(key: MailProviderKey): MailProvider {
  return MAIL[key];
}

export function getCalendarProvider(key: CalendarProviderKey): CalendarProvider {
  return CALENDAR[key];
}
