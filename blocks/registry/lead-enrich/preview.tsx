import { Frame } from "../../gallery/src/Frame";
import { LeadEnrich } from "./LeadEnrich";

export default function Preview() {
  return (
    <Frame h="h-[32rem]">
      <div className="mx-auto flex h-full max-w-xl flex-col">
        <LeadEnrich className="min-h-0 flex-1" defaultEmail="jane.doe@acme-inc.example" />
      </div>
    </Frame>
  );
}
