import { Frame } from "../../gallery/src/Frame";
import { GoogleCalendarOfferTimes } from "./GoogleCalendarOfferTimes";

export default function Preview() {
  return (
    <Frame h="h-[42rem]">
      <div className="mx-auto flex h-full max-w-2xl flex-col py-3">
        <GoogleCalendarOfferTimes className="min-h-0 flex-1" />
      </div>
    </Frame>
  );
}
