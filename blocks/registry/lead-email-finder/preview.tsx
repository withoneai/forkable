import { Frame } from "../../gallery/src/Frame";
import { LeadEmailFinder } from "./LeadEmailFinder";

export default function Preview() {
  return (
    <Frame h="h-[34rem]">
      <div className="mx-auto flex h-full max-w-2xl flex-col">
        <LeadEmailFinder className="min-h-0 flex-1" defaults={{ name: "Priya Shah", domain: "acme-inc.example" }} />
      </div>
    </Frame>
  );
}
