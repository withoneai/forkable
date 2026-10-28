import { Frame } from "../../gallery/src/Frame";
import { RillMorningBrief } from "./RillMorningBrief";

export default function Preview() {
  return (
    <Frame h="h-[34rem]">
      <div className="mx-auto flex h-full max-w-2xl flex-col">
        <RillMorningBrief className="min-h-0 flex-1" />
      </div>
    </Frame>
  );
}
