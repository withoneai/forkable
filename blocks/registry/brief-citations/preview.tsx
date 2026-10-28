import { Frame } from "../../gallery/src/Frame";
import { BriefCitations } from "./BriefCitations";

export default function Preview() {
  return (
    <Frame>
      <div className="mx-auto flex h-full max-w-xl flex-col border-x border-border">
        <BriefCitations className="min-h-0 flex-1" />
      </div>
    </Frame>
  );
}
