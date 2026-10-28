import { Frame } from "../../gallery/src/Frame";
import { RillVipSuggestions } from "./RillVipSuggestions";

export default function Preview() {
  return (
    <Frame>
      <div className="mx-auto flex h-full max-w-lg flex-col border-x border-border">
        <RillVipSuggestions className="min-h-0 flex-1" />
      </div>
    </Frame>
  );
}
