// Receipt lines, one format per source. Browser-safe.
// The One line ("declined, 403") is only ever built for source "one" (live)
// and "sample" (fixtures, badged Sample). A Local or Paused row never says it.

import type { Receipt, ReceiptSource } from "./types.js";

export const BADGE: Record<ReceiptSource, string> = { one: "One", local: "Local", held: "Paused", sample: "Sample" };

export interface ReceiptInput {
  platformName: string;
  verb: string;
  source: ReceiptSource;
  /** The refusal code: not_in_manifest, not_connected, signed_out, connect_off, visitors_off, visitor_not_allowed, version_preview, held_during_build, blocked_by_grant. */
  code?: string;
}

const PAD = "   ";

export function receiptLine(r: ReceiptInput): string {
  const head = `${r.platformName} · ${r.verb}`;
  switch (r.source) {
    case "one":
    case "sample":
      return `${head}${PAD}declined, 403`;
    case "held":
      return `${head}${PAD}paused while the agent works`;
    case "local":
      if (r.code === "not_connected") return `${head}${PAD}held locally, ${r.platformName} is not in your grant to this app`;
      if (r.code === "signed_out") return `${head}${PAD}held locally, sign in with One to run it`;
      if (r.code === "connect_off") return `${head}${PAD}held locally, One Connect is off for this app`;
      if (r.code === "visitors_off" || r.code === "visitor_not_allowed") return `${head}${PAD}held locally, not allowed for visitors`;
      if (r.code === "version_preview") return `${head}${PAD}held locally, previewing an older version`;
      return `${head}${PAD}held locally, not in this app's manifest`;
  }
}

export function receiptCaption(r: ReceiptInput): string {
  switch (r.source) {
    case "one":
      return `One refused this call. ${r.platformName} was never called.`;
    case "sample":
      return "Replayed from fixtures in the shape One returns. Not a live call.";
    case "held":
      return "Writes pause while the agent works. Try again when the step ends.";
    case "local":
      if (r.code === "not_connected") return `Stopped on your computer before it reached One. Sign in to the preview again and grant ${r.platformName} to this app.`;
      if (r.code === "signed_out") return "Stopped on your computer before it reached One. Sign in with One in the preview: calls run on your own sign-in to this app.";
      if (r.code === "connect_off") return "Stopped on your computer before it reached One. Turn on One Connect in this project's Settings to give the app its own Sign in with One.";
      if (r.code === "visitors_off") return "Stopped on your computer before it reached One. Visitors can't trigger actions on your grant in this app. Turn it on per action in Access, under Runs on your grant for visitors.";
      if (r.code === "version_preview") return "Stopped on your computer before it reached One. A version preview runs reads only, so an older version cannot send or change anything. Restore it to run its writes.";
      if (r.code === "visitor_not_allowed") return "Stopped on your computer before it reached One. You haven't allowed visitors to trigger this action on your grant. Tick it in Access, under Runs on your grant for visitors.";
      return "Stopped on your computer before it reached One. Your published app's ask won't include it.";
  }
}

export function makeReceipt(r: ReceiptInput & { actionId?: string | null; at?: string; platform: string }): Receipt {
  return { line: receiptLine(r), source: r.source, badge: BADGE[r.source], caption: receiptCaption(r), platform: r.platform, actionId: r.actionId ?? null, at: r.at ?? new Date().toISOString() };
}

/** Line plus badge, padded for the terminal: "Gmail · delete   declined, 403   [Sample]". */
export function receiptTerminal(r: ReceiptInput, width = 0): string {
  const line = receiptLine(r);
  return `${line.padEnd(width)}   [${BADGE[r.source]}]`;
}
