import { useState } from "react";
import { Frame } from "../../gallery/src/Frame";
import { GoogleCalendarWeek } from "./GoogleCalendarWeek";

export default function Preview() {
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <Frame h="h-[40rem]">
      <GoogleCalendarWeek className="h-full" selectedId={picked} onSelect={(e) => setPicked(e.id)} />
    </Frame>
  );
}
