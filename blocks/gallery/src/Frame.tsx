import type { ReactNode } from "react";

/** The box a preview sits in. Gallery only, never copied into a fork. */
export function Frame({ children, h = "h-[30rem]", center }: { children: ReactNode; h?: string; center?: boolean }) {
  return <div className={`${h} ${center ? "preview-ground flex items-center justify-center p-6" : ""} overflow-hidden`}>{children}</div>;
}

export const SAMPLE_THREADS = [
  { id: "t01", subject: "Term sheet redlines, need you by Thursday", from: "priya@northwind.vc" },
  { id: "t06", subject: "Offsite date: need a decision today", from: "riley@acme.com" },
];
