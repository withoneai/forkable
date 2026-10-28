import { Frame } from "../../gallery/src/Frame";
import { BriefShareOfVoice } from "./BriefShareOfVoice";

export default function Preview() {
  return (
    <Frame h="h-[34rem]">
      <div className="mx-auto flex h-full max-w-2xl flex-col">
        <BriefShareOfVoice className="min-h-0 flex-1" />
      </div>
    </Frame>
  );
}
