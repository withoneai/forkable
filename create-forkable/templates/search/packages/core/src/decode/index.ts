// Named decoders (pure). Bump DECODER_VERSION when any output changes: it is part of map_hash.

import type { Decoder } from "../contract.js";
import { toIso } from "../expr/time.js";
import { decodeAddress, decodeDomain, decodeEmail } from "./address.js";
import { decodeNotionBlocks, decodeNotionTitle, decodeProsemirror, decodeTranscript } from "./structured.js";
import { decodeGraphBody, decodeHtml, decodeMailStrip, decodeMarkdown, decodeMimeBody, decodeSlackMrkdwn, decodeText } from "./text.js";

export const DECODER_VERSION = 1;

/** Decoders that take a whole structure rather than one scalar. */
export const STRUCTURAL: ReadonlySet<Decoder> = new Set<Decoder>(["notion-blocks", "notion-title", "prosemirror", "graph-body", "mime-body", "address", "transcript"]);

export function decode(name: Decoder, v: unknown): unknown {
  switch (name) {
    case "text": return decodeText(v);
    case "html": return decodeHtml(v);
    case "markdown": return decodeMarkdown(v);
    case "mail-strip": return decodeMailStrip(v);
    case "graph-body": return decodeGraphBody(v);
    case "mime-body": return decodeMimeBody(v);
    case "notion-blocks": return decodeNotionBlocks(v);
    case "notion-title": return decodeNotionTitle(v);
    case "slack-mrkdwn": return decodeSlackMrkdwn(v);
    case "prosemirror": return decodeProsemirror(v);
    case "transcript": return decodeTranscript(v);
    case "email": return decodeEmail(v);
    case "domain": return decodeDomain(v);
    case "datetime": return toIso(v) ?? undefined;
    case "address": return decodeAddress(v);
    case "number": {
      if (typeof v === "number") return v;
      if (typeof v !== "string" || !v.trim()) return undefined;
      const n = Number(v.replace(/[,\s$€£]/g, ""));
      return Number.isFinite(n) ? n : undefined;
    }
  }
}

export * from "./address.js";
export * from "./text.js";
export * from "./structured.js";
