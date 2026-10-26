import { and, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import type { AskResponse } from "./api-types.js";
import type { AskEvidence, Ctx, Writer } from "./contract.js";
import { messages as messagesTable, threads as threadsTable } from "./db/schema.js";
import { writer as writerLayer } from "./writer/index.js";

// Ask your inbox. Retrieval is code: keyword search over what is already in
// Postgres. The writer only answers from the evidence it is handed, with
// citations code checks against that evidence.

const STOP = new Set(
  "a an the and or but if then of to in on at for from by with about into over after before between out up down off as is are was were be been being am do does did doing have has had having i me my mine we our us you your yours he she it its they them their what which who whom whose this that these those when where why how all any both each few more most other some such no nor not only own same so than too very can will just should would could did say said says tell told ask asked email emails mail inbox thread message messages did anything something someone anyone last week month today yesterday recent recently please show find".split(
    /\s+/,
  ),
);

export function keywordsOf(q: string): string[] {
  const words = q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}@.\s-]/gu, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[.-]+|[.-]+$/g, ""))
    .filter((w) => w.length >= 3 && !STOP.has(w));
  return [...new Set(words)].slice(0, 8);
}

function excerptAround(body: string, keywords: string[], width = 600): string {
  const text = body.replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  let at = -1;
  for (const k of keywords) {
    const i = lower.indexOf(k);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0 || text.length <= width) return text.slice(0, width);
  const start = Math.max(0, at - Math.floor(width / 3));
  return `${start > 0 ? "…" : ""}${text.slice(start, start + width)}${start + width < text.length ? "…" : ""}`;
}

export async function retrieve(ctx: Ctx, q: string, max = 8): Promise<AskEvidence[]> {
  const keywords = keywordsOf(q);
  if (keywords.length === 0) return [];
  const clauses: SQL[] = [];
  for (const k of keywords) {
    const like = `%${k.replace(/[%_]/g, "")}%`;
    clauses.push(ilike(messagesTable.subject, like), ilike(messagesTable.body, like), ilike(messagesTable.fromName, like), ilike(messagesTable.fromEmail, like));
  }
  const rows = await ctx.db
    .select({ m: messagesTable, gmailThreadId: threadsTable.gmailId })
    .from(messagesTable)
    .innerJoin(threadsTable, eq(messagesTable.threadId, threadsTable.id))
    .where(and(eq(messagesTable.mailboxId, ctx.mailbox.id), or(...clauses)))
    .orderBy(desc(messagesTable.date))
    .limit(60);
  const scored = rows.map(({ m, gmailThreadId }) => {
    const hay = `${m.subject} ${m.fromName} ${m.fromEmail} ${m.body}`.toLowerCase();
    const hits = keywords.filter((k) => hay.includes(k)).length;
    const subjectHits = keywords.filter((k) => m.subject.toLowerCase().includes(k)).length;
    return { m, gmailThreadId, score: hits * 2 + subjectHits + (m.isFromMe ? 0 : 0.5) };
  });
  scored.sort((a, b) => b.score - a.score || b.m.date.getTime() - a.m.date.getTime());
  return scored.slice(0, max).map(({ m, gmailThreadId }) => ({
    threadId: gmailThreadId,
    subject: m.subject,
    from: m.isFromMe ? "me" : `${m.fromName} <${m.fromEmail}>`,
    date: m.date.toISOString(),
    excerpt: excerptAround(m.body, keywords),
  }));
}

export async function askInbox(ctx: Ctx, w: Writer, q: string): Promise<AskResponse> {
  const evidence = await retrieve(ctx, q);
  return writerLayer.ask(ctx, w, q, evidence);
}

export const ask = { keywordsOf, retrieve, askInbox };
