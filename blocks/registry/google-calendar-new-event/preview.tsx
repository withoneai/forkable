import { Frame } from "../../gallery/src/Frame";
import { GoogleCalendarNewEvent } from "./GoogleCalendarNewEvent";

export default function Preview() {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(15, 0, 0, 0);
  return (
    <Frame center>
      <GoogleCalendarNewEvent initial={{ title: "Pro rata follow-up", start, end: new Date(start.getTime() + 30 * 60_000), guests: ["priya@northwind.vc"] }} />
    </Frame>
  );
}
