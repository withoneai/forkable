import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useOneConnect } from "@withone/connect/react";
import type { Lane } from "@rill/core/types";
import { api } from "@/lib/api";
import { useMailbox } from "@/lib/mailbox";
import { keys } from "@/lib/queries";
import { toast } from "@/lib/toast";
import gmail from "@/assets/logos/gmail.svg";
import outlook from "@/assets/logos/outlook-mail.svg";

// The two real actions behind every sign-in prototype, so a prototype can be
// clicked through end to end: Sign in with One, and the Acme sample.
export function useSignIn() {
  const { me, select } = useMailbox();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [sampleBusy, setSampleBusy] = useState(false);
  const connect = useOneConnect({
    authorizeUrl: "/api/one/authorize",
    connector: "gmail",
    onSuccess: () => { void qc.invalidateQueries({ queryKey: keys.me }).then(() => nav("/start")); },
    onError: (message) => toast({ title: "Sign in did not finish", detail: message, tone: "destructive" }),
  });
  const openSample = async () => {
    setSampleBusy(true);
    try {
      const m = await api.createSampleMailbox();
      await qc.invalidateQueries({ queryKey: keys.me });
      select(m.id);
      nav(m.onboarded ? "/inbox/vip" : "/start");
    } catch (e) {
      toast({ title: "Could not open the sample", detail: (e as Error).message, tone: "destructive" });
    } finally {
      setSampleBusy(false);
    }
  };
  return {
    me,
    configured: me?.connect.configured ?? false,
    connecting: connect.status === "connecting",
    signIn: connect.open,
    sampleBusy,
    openSample: () => void openSample(),
  };
}

export function ProviderLogos({ className }: { className?: string }) {
  return (
    <span className={className}>
      <img src={gmail} alt="Gmail" className="size-4" />
      <img src={outlook} alt="Outlook" className="size-4" />
    </span>
  );
}

// A slice of the Acme sample, as the app serves it.
export type Sample = { lane: Lane; from: string; subject: string; time: string; reason: string | null; unread: boolean };
export const SAMPLE: Sample[] = [
  { lane: "vip", from: "Priya Nair", subject: "Term sheet redlines, need you by Thursday", time: "17m", reason: "Goal", unread: true },
  { lane: "vip", from: "Riley Chen", subject: "Offsite date: need a decision today", time: "5m", reason: "Rill drafted", unread: true },
  { lane: "vip", from: "Victor Lang", subject: "Board deck for next week", time: "2h", reason: "Rill drafted", unread: true },
  { lane: "vip", from: "Marcus Lee", subject: "Re: Q4 hiring plan", time: "1h", reason: "Rill drafted", unread: false },
  { lane: "vip", from: "Elena Ruiz", subject: "Pilot results and next steps", time: "3h", reason: "VIP", unread: false },
  { lane: "goals", from: "Rosa Delgado", subject: "Option pool: need your pick before we send", time: "1h", reason: "Rill drafted", unread: true },
  { lane: "goals", from: "Grace Lindqvist", subject: "Data room access", time: "11h", reason: "Goal", unread: true },
  { lane: "goals", from: "Sam Okafor", subject: "Intro: you and Lena from Initech", time: "6h", reason: "Rill drafted", unread: true },
  { lane: "goals", from: "Leo Martins", subject: "SSO timeline before we roll out wider", time: "8h", reason: "Goal", unread: false },
  { lane: "goals", from: "Hannah Brooks", subject: "Two senior profiles for the backend role", time: "18h", reason: "Rill drafted", unread: false },
  { lane: "reply", from: "Wes Carter", subject: "Escalation: exports failing since Monday", time: "3h", reason: "Rill drafted", unread: true },
  { lane: "reply", from: "Ben Adler", subject: "Q3 filing ready for your signature", time: "14h", reason: "Needs reply", unread: true },
  { lane: "reply", from: "Dmitri Volkov", subject: "PO number for invoice 10482", time: "1d", reason: "Rill drafted", unread: false },
  { lane: "reply", from: "Frank Molinari", subject: "Lease renewal for Suite 410", time: "2d", reason: "Needs reply", unread: false },
  { lane: "reply", from: "Tariq Rahman", subject: "Coffee?", time: "2d", reason: "Rill drafted", unread: false },
  { lane: "other", from: "GitHub", subject: "Merged: Rate limit the export endpoint (#412)", time: "4h", reason: null, unread: false },
  { lane: "other", from: "Figma", subject: "Your Figma invoice for October", time: "11h", reason: null, unread: false },
  { lane: "other", from: "The Product Weekly", subject: "How the best PMs run discovery", time: "15h", reason: null, unread: false },
  { lane: "other", from: "Skyline Air", subject: "Your receipt: SFO to AUS, November 6", time: "3d", reason: null, unread: false },
  { lane: "other", from: "Amazon Web Services", subject: "Invoice available", time: "2d", reason: null, unread: false },
  { lane: "screener", from: "Nadia Hassan", subject: "Speaking slot at Umbrella Summit", time: "4h", reason: "New sender", unread: true },
  { lane: "screener", from: "Alex Kim", subject: "Quick question about your onboarding", time: "2h", reason: "New sender", unread: true },
  { lane: "screener", from: "Yusuf Demir", subject: "Partnership between Wonka Labs and Acme", time: "13h", reason: "New sender", unread: false },
  { lane: "screener", from: "Tyler Brooks", subject: "Pipeline for Acme in Q4", time: "5h", reason: "New sender", unread: false },
];
export const LANE_COUNTS: Record<Lane, number> = { vip: 6, goals: 13, reply: 6, other: 9, screener: 6 };
