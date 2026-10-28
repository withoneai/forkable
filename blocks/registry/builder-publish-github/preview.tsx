import { Frame } from "../../gallery/src/Frame";
import { BuilderPublishGithub } from "./BuilderPublishGithub";

// A small Acme app to publish. Gallery only.
const FILES = [
  { path: "README.md", content: "# Acme standup\n\nPosts the daily standup to Slack and files it in Notion.\n" },
  { path: "server/routes/standup.ts", content: "export const standup = 'route';\n".repeat(40) },
  { path: "ui/src/App.tsx", content: "export function App() { return null; }\n".repeat(30) },
  { path: "connect.manifest.json", content: '{ "actions": [] }\n' },
];

export default function Preview() {
  return (
    <Frame h="h-[34rem]">
      <div className="mx-auto flex h-full max-w-lg flex-col">
        <BuilderPublishGithub className="min-h-0 flex-1" defaultRepo="acme-standup" files={FILES} />
      </div>
    </Frame>
  );
}
