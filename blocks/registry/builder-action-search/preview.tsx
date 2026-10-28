import { Frame } from "../../gallery/src/Frame";
import { BuilderActionSearch } from "./BuilderActionSearch";

export default function Preview() {
  return (
    <Frame h="h-[32rem]">
      <BuilderActionSearch className="h-full" onPick={() => {}} />
    </Frame>
  );
}
