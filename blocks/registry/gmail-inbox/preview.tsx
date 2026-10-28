import { useState } from "react";
import { Frame } from "../../gallery/src/Frame";
import { GmailInbox } from "./GmailInbox";

export default function Preview() {
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <Frame>
      <div className="mx-auto flex h-full max-w-md flex-col border-x border-border">
        <GmailInbox className="min-h-0 flex-1" selectedId={picked} onSelect={(t) => setPicked(t.id)} />
      </div>
    </Frame>
  );
}
