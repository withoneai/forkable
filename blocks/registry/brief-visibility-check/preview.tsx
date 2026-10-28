import { Frame } from "../../gallery/src/Frame";
import { BriefVisibilityCheck } from "./BriefVisibilityCheck";

export default function Preview() {
  return (
    <Frame h="h-[36rem]">
      <div className="mx-auto flex h-full max-w-3xl flex-col">
        <BriefVisibilityCheck className="min-h-0 flex-1" defaultPrompt="What's the best expense management software for a mid-size company right now?" />
      </div>
    </Frame>
  );
}
