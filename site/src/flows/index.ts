import type { ComponentType } from "react";
import data from "./flows.json";
import { ACTIONS, type ActionKey, type FlowAction } from "./actions";
import MorningBrief from "./morning-brief";
import MeetingPrep from "./meeting-prep";
import FollowUpRadar from "./follow-up-radar";
import RevenuePulse from "./revenue-pulse";
import InvestorUpdate from "./investor-update";
import InboxCleanup from "./inbox-cleanup";

export type TrailStep = { tool: string; platform?: string; detail: string; result?: string };

export type Flow = {
  id: string;
  name: string;
  description: string;
  prompt: string;
  platforms: FlowAction["platform"][];
  actions: FlowAction[];
  trail: TrailStep[];
  reply: string;
  Component: ComponentType;
};

const COMPONENTS: Record<string, ComponentType> = {
  "morning-brief": MorningBrief,
  "meeting-prep": MeetingPrep,
  "follow-up-radar": FollowUpRadar,
  "revenue-pulse": RevenuePulse,
  "investor-update": InvestorUpdate,
  "inbox-cleanup": InboxCleanup,
};

export const FLOWS: Flow[] = data.flows.map((f) => ({
  ...f,
  platforms: f.platforms as Flow["platforms"],
  actions: f.actions.map((k) => ACTIONS[k as ActionKey]),
  Component: COMPONENTS[f.id]!,
}));
