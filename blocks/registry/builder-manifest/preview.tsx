import { Frame } from "../../gallery/src/Frame";
import { BuilderManifest } from "./BuilderManifest";

export default function Preview() {
  return (
    <Frame>
      <div className="mx-auto flex h-full max-w-2xl flex-col border-x border-border">
        <BuilderManifest className="min-h-0 flex-1" />
      </div>
    </Frame>
  );
}
