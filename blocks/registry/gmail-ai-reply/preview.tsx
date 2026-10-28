import { useState } from "react";
import { Frame, SAMPLE_THREADS as SAMPLE } from "../../gallery/src/Frame";
import { GmailAiReply } from "./GmailAiReply";

export default function Preview() {
  const [id, setId] = useState("t06");
  const s = SAMPLE.find((x) => x.id === id)!;
  return (
    <Frame h="h-[34rem]">
      <div className="mx-auto flex h-full max-w-xl flex-col gap-3 overflow-y-auto p-6">
        <div className="flex items-center gap-1">
          {SAMPLE.slice(0, 2).map((x) => (
            <button key={x.id} onClick={() => setId(x.id)} className={`h-6 rounded-md px-2 text-11 ${id === x.id ? "bg-card text-foreground" : "text-muted-foreground"}`}>
              {x.subject.slice(0, 32)}
            </button>
          ))}
        </div>
        <GmailAiReply key={id} threadId={id} replyTo={s.from} subject={s.subject} />
      </div>
    </Frame>
  );
}
