import type { ConferencingResponse } from "./api-types.js";
import type { Ctx } from "./contract.js";
import { one } from "./one.js";
import { CONFERENCING, type ConferencingProvider } from "./types.js";

// Meeting links. Meet and Teams are made by the calendar itself when the event
// is inserted (Google's conferenceData, Graph's isOnlineMeeting), so they exist
// exactly when that calendar does. Zoom is a separate One connection: the
// server creates the meeting here first, then the provider writes its join
// URL into the event. New event shows only what `available` returns.

/** Zoom action ids from the One catalog (found 2026-10-22 with `one --agent actions find zoom ...`, never executed outside a real grant). */
export const ZOOM_ACTIONS = {
  meetingsCreate: { id: "conn_mod_def::GJ8enHbo9DI::KIWh_FB5RxGPT6sVbu8FTg", method: "POST", path: "/v2/users/{{userId}}/meetings" },
} as const;

export interface MeetingLink { url: string; passcode: string | null; label: string; provider: ConferencingProvider }

export async function available(ctx: Ctx): Promise<ConferencingResponse> {
  const out: ConferencingProvider[] = [];
  if (ctx.mailbox.calendarProvider === "google-calendar") out.push("google-meet");
  if (ctx.mailbox.calendarProvider === "outlook-calendar") out.push("teams");
  // Sample mailboxes answer "fixture" for every platform; the Acme sample has Zoom, so the picker can be tried without a grant.
  const zoom = await one.modeFor(ctx, "zoom", "grant");
  if (zoom === "connect" || zoom === "fixture") out.push("zoom");
  const wanted = ctx.settings.defaultConferencing;
  return { available: out, default: wanted && out.includes(wanted) ? wanted : out[0] ?? null };
}

interface ZoomMeeting { id?: number | string; join_url?: string; password?: string }

/** One scheduled Zoom meeting on the user's grant, sized to the event. Rate limit upstream is 100 a day per host. */
export async function createZoomMeeting(ctx: Ctx, input: { title: string; start: string; end: string; timeZone: string; agenda?: string }): Promise<MeetingLink> {
  const durationMin = Math.max(15, Math.round((new Date(input.end).getTime() - new Date(input.start).getTime()) / 60_000));
  return one.call<ZoomMeeting, MeetingLink>(ctx, {
    platform: "zoom",
    action: "meetings-create",
    level: "write",
    credential: "grant",
    actionId: ZOOM_ACTIONS.meetingsCreate.id,
    method: ZOOM_ACTIONS.meetingsCreate.method,
    path: ZOOM_ACTIONS.meetingsCreate.path,
    pathParams: { userId: "me" },
    body: { topic: input.title, agenda: input.agenda, type: 2, start_time: input.start, duration: durationMin, timezone: input.timeZone, settings: { waiting_room: true, join_before_host: false } },
    summary: `Zoom link for "${input.title}"`,
    fixture: () => ({ url: `https://acme.zoom.us/j/8${String(Date.now()).slice(-9)}?pwd=sample`, passcode: "acme1", label: "Zoom", provider: "zoom" }),
    pick: (d) => {
      if (!d?.join_url) throw new Error("Zoom answered without a join_url");
      return { url: d.join_url, passcode: d.password ?? null, label: "Zoom", provider: "zoom" };
    },
  });
}

/** The first meeting URL in free text (a location or a description), or null. Pure; exported for tests. */
export function meetingUrlIn(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const m of text.matchAll(/https?:\/\/[^\s<>"')\]]+/g)) {
    try {
      const host = new URL(m[0]).hostname;
      if (Object.values(CONFERENCING).some((c) => c.host.test(host))) return m[0].replace(/[.,;:]+$/, "");
    } catch { /* not a URL after all */ }
  }
  return null;
}

/** "zoom" for a zoom.us link, and so on; null for anything else. Pure; exported for tests. */
export function providerOf(url: string | null | undefined): ConferencingProvider | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    return (Object.entries(CONFERENCING).find(([, c]) => c.host.test(host))?.[0] as ConferencingProvider | undefined) ?? null;
  } catch { return null; }
}

/** The block a third-party link gets in an event description, the way Zoom's own calendar add-on writes it. */
export function linkBlock(link: { url: string; passcode: string | null; label: string }): string {
  return [`Join ${link.label} meeting`, link.url, link.passcode ? `Passcode: ${link.passcode}` : null].filter(Boolean).join("\n");
}
