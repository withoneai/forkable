import { useState } from "react";
import { Frame } from "../../gallery/src/Frame";
import { RillLanes } from "./RillLanes";

export default function Preview() {
  const [picked, setPicked] = useState<string | null>("t01");
  return (
    <Frame>
      <div className="mx-auto flex h-full max-w-xl flex-col border-x border-border">
        <RillLanes className="min-h-0 flex-1" selectedId={picked} onSelect={(t) => setPicked(t.id)} />
      </div>
    </Frame>
  );
}
