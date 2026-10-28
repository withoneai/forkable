import type { OneAction } from "../lib/one-server.js";

// The Google Calendar actions the components call, by their One action id.
// Each component's block.json lists the ones it uses, and `forkable add`
// merges them into connect.manifest.json, which becomes the permission set
// users grant. Ids from One's catalog (`one actions find google-calendar ...`).
export const GCAL = {
  listEvents: { platform: "google-calendar", actionId: "conn_mod_def::GJ6RlnIYK20::YzuWSmaVQgurletRDNJavA", method: "GET", path: "/calendars/{{calendarId}}/events", access: "read" },
  createEvent: { platform: "google-calendar", actionId: "conn_mod_def::GJ6RlnjZAh4::CSya4eHtRbeXRM7PHiXuRA", method: "POST", path: "/v3/calendars/{{calendarId}}/events", access: "write" },
  getEvent: { platform: "google-calendar", actionId: "conn_mod_def::GJ6RlPEQKQw::rxHzaO_TTtKVIcxgFrWUKA", method: "GET", path: "/calendar/v3/calendars/{{calendarId}}/events/{{eventId}}", access: "read" },
  patchEvent: { platform: "google-calendar", actionId: "conn_mod_def::GJ6RlmhNiKo::48w5XxsbRx24lge7XAzN_w", method: "PATCH", path: "/calendar/v3/calendars/{{calendarId}}/events/{{eventId}}", access: "write" },
  freeBusy: { platform: "google-calendar", actionId: "conn_mod_def::GJ6Rlvk1bgM::h5exn4dzTkyhjoA89wddmQ", method: "POST", path: "/freeBusy", access: "read" },
} as const satisfies Record<string, OneAction>;
