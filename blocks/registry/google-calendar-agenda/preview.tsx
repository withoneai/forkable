import { useState } from "react";
import { Frame } from "../../gallery/src/Frame";
import { GoogleCalendarAgenda } from "./GoogleCalendarAgenda";

export default function Preview() {
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <Frame h="h-[36rem]">
      <div className="mx-auto flex h-full max-w-xl flex-col border-x border-border">
        <GoogleCalendarAgenda className="min-h-0 flex-1" selectedId={picked} onSelect={(e) => setPicked(e.id)} />
      </div>
    </Frame>
  );
}
