import { defineConnectApp } from "@withone/connect/config";

// Search's Connect app as code. `pnpm connect` runs `one connect create` on it:
// you approve the app in the browser, and the CLI writes its ids to .env.
//
// The ask is "everything": each person sees every connection they have, picks
// what Search may use and can narrow any of it, so a new source never needs a
// new version of the app. Search itself only reads (every profile action is
// access "read"); the grant is what One allows, the code is what Search does.
// connect.manifest.json still lists every action the code calls, for the
// Access screen and the profile tests.
export default defineConnectApp({
  name: "Search",
  reason: "Search indexes the tools you connect so you can find anything and ask about it. It only reads.",
  homepageUrl: "https://search.forkable.dev",
  // The Search icon from the Forkable brand kit, uploaded to the public-assets
  // R2 bucket (Buildable account). Re-upload there if the kit changes.
  logoUrl: "https://pub-6fe8ebddc11f4e8cb27fee4200b5bec8.r2.dev/forkable/search/icon-512.png",
  // The server pins this port (server/src/config.ts), so the redirect never floats.
  redirectUris: ["http://localhost:52289/api/one/callback"],
  branding: { panelColor: "#0A0A0A", buttonColor: "#0A0A0A" },
  ask: "everything",
});
