import { useEffect, useState } from "react";
import { Frame } from "../../gallery/src/Frame";
import { GoogleCalendarEvent } from "./GoogleCalendarEvent";
import type { CalEvent } from "../google-calendar/types";

export default function Preview() {
  const [event, setEvent] = useState<CalEvent | null>(null);
  useEffect(() => {
    const from = new Date();
    fetch(`/api/calendar/events?from=${from.toISOString()}&days=7&tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`)
      .then((r) => r.json())
      .then((r: { data: CalEvent[] }) => setEvent(r.data.find((e) => e.myResponse === "needsAction" && e.joinUrl) ?? r.data.find((e) => e.myResponse === "needsAction") ?? r.data[0] ?? null));
  }, []);
  return (
    <Frame h="h-[36rem]">
      <div className="mx-auto h-full max-w-sm border-x border-border">{event && <GoogleCalendarEvent event={event} onChange={setEvent} />}</div>
    </Frame>
  );
}
