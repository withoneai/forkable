import { Frame } from "../../gallery/src/Frame";
import { RillAskInbox } from "./RillAskInbox";

export default function Preview() {
  return (
    <Frame>
      <div className="mx-auto flex h-full max-w-xl flex-col">
        <RillAskInbox className="min-h-0 flex-1" />
      </div>
    </Frame>
  );
}
