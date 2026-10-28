import { useState } from "react";
import { Frame, SAMPLE_THREADS as SAMPLE } from "../../gallery/src/Frame";
import { GmailThread } from "./GmailThread";

export default function Preview() {
  const [id, setId] = useState("t01");
  return (
    <Frame>
      <div className="flex h-full flex-col">
        <div className="flex gap-1 border-b border-border px-3 py-2">
          {SAMPLE.slice(0, 2).map((s) => (
            <button key={s.id} onClick={() => setId(s.id)} className={`h-6 rounded-md px-2 text-11 ${id === s.id ? "bg-card text-foreground" : "text-muted-foreground"}`}>
              {s.subject.slice(0, 28)}
            </button>
          ))}
        </div>
        <GmailThread className="min-h-0 flex-1" threadId={id} />
      </div>
    </Frame>
  );
}
