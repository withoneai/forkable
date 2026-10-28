import sample from "../../fixtures/rill.json" with { type: "json" };
import type { Goal, Vip } from "./types.js";
import type { JevAnswers } from "./jev.js";

// The Acme Inc sample inbox Rill ships (Dana Reyes, CEO of Acme Inc), with
// the Jev answers Rill recorded for each thread (`rill record`, a real Jev
// run) and Rill's own one-line summaries. Times are relative, so the sample
// always looks like this morning. The sent-mail counts are made up for the
// VIP suggestions.

export interface SampleMessage { id: string; from: { name: string; email: string }; to: string[]; minutesAgo: number; body: string; labelIds: string[]; hiddenText?: string }
export interface SampleThread { id: string; subject: string; messages: SampleMessage[]; jev: JevAnswers; summary: { summary: string; ask: string | null } | null; firstTimeSender: boolean; expectLane: string }

export const RILL_SAMPLE = sample as unknown as {
  me: string;
  address: string;
  teamDomain: string;
  goals: Goal[];
  vips: Vip[];
  sent: { email: string; name: string; count: number }[];
  threads: SampleThread[];
};
