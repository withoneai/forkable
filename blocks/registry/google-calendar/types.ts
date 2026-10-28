// The shapes the Google Calendar routes return and the calendar components
// render. Shared by server and browser, so a component and its route never drift.

export type Rsvp = "accepted" | "declined" | "tentative" | "needsAction";

export interface Attendee {
  name: string | null;
  email: string;
  self: boolean;
  organizer: boolean;
  response: Rsvp;
}

export interface CalEvent {
  id: string;
  title: string;
  /** ISO instants. All-day events start and end at midnight UTC of their dates. */
  start: string;
  end: string;
  allDay: boolean;
  status: "confirmed" | "tentative" | "cancelled";
  location: string | null;
  description: string | null;
  joinUrl: string | null;
  organizer: { name: string | null; email: string } | null;
  attendees: Attendee[];
  /** The signed-in user's own answer. */
  myResponse: Rsvp;
}

export interface NewEventInput {
  title: string;
  start: string;
  end: string;
  /** IANA zone the times were picked in, for example "America/Los_Angeles". */
  timeZone: string;
  guests: string[];
  description?: string;
  location?: string;
  /** Add a Google Meet link. */
  meet?: boolean;
  /** Email the guests an invite. Off unless the user turns it on. */
  notifyGuests?: boolean;
}

export interface BusySlot {
  start: string;
  end: string;
}

export interface FreeBusyInput {
  from: string;
  to: string;
  /** Used by the sample to place its events in your zone. */
  timeZone?: string;
}
