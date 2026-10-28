import { Frame } from "../../gallery/src/Frame";
import { LeadPeopleSearch } from "./LeadPeopleSearch";

export default function Preview() {
  return (
    <Frame h="h-[34rem]">
      <div className="mx-auto flex h-full max-w-3xl flex-col">
        <LeadPeopleSearch className="min-h-0 flex-1" defaults={{ title: "VP", domain: "acme-inc.example" }} />
      </div>
    </Frame>
  );
}
