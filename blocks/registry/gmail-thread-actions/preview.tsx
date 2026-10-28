import { useState } from "react";
import { Frame } from "../../gallery/src/Frame";
import { GmailThreadActions } from "./GmailThreadActions";

export default function Preview() {
  const [log, setLog] = useState<string[]>([]);
  const [starred, setStarred] = useState(false);
  return (
    <Frame h="h-64" center>
      <div className="flex w-full max-w-lg flex-col gap-3">
        <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
          <span className="truncate text-13 text-foreground">Term sheet redlines, need you by Thursday</span>
          <div className="ml-auto">
            <GmailThreadActions
              threadId="t01"
              starred={starred}
              onDone={(op) => {
                if (op === "star" || op === "unstar") setStarred(op === "star");
                setLog((l) => [`POST /api/gmail/threads/t01/modify  ${op}`, ...l].slice(0, 3));
              }}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1 font-mono text-10 text-muted-foreground">
          {log.map((l, i) => (
            <span key={i}>{l}</span>
          ))}
        </div>
      </div>
    </Frame>
  );
}
