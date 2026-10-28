import type { Goal, Vip } from "./types.js";

// Who the inbox belongs to, what they are working toward and who matters.
// This file is yours: edit it, or load it from your own settings table.
// Until Sign in with One is set up the blocks use the Acme sample's own
// (Dana Reyes, CEO of Acme Inc) and ignore this.
export const rillConfig: { me: string; teamDomain: string | null; goals: Goal[]; vips: Vip[] } = {
  me: "The person who owns this inbox.",
  teamDomain: null,
  goals: [],
  vips: [],
};
