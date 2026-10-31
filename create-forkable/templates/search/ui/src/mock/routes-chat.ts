// Mock routes: the assistant (SPEC 14, CONTRACT 7.1). POST /chat streams the
// same events the server will (chat, step, results, answer, proposal,
// followups, done). A few questions have fixture answers like
// fixtures/sample/chat.json; anything else gets the extractive answerer, which
// quotes the top results and says it used no model.
import type { ChatContext, ChatEvent, ChatMessage, ChatStep, ChatTurnInput, Citation, QueryProposal, ResultRow } from "@/contract/api-types";
import { parseQuery } from "@/contract/query";
import { fail, noContent, route, sleep } from "./http";
import { search, toRow } from "./search";
import { chats, recent } from "./state";
import { ITEMS, type MockItem } from "./world";

/** search() without leaving a trace in Recent: the assistant's own searches are not the user's. */
function quietSearch(q: string, limit = 30) {
  const before = recent.length;
  const r = search(q, "all", "best", limit);
  recent.splice(0, recent.length - before);
  return r;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const find = (platform: string, title: string): MockItem => {
  const it = ITEMS.find((i) => i.platform === platform && (i.title === title || i.title.startsWith(title)));
  if (!it) throw new Error(`mock chat fixture: no ${platform} item "${title}"`);
  return it;
};

function quoteFrom(it: MockItem, needle?: string): string {
  // Mail bodies are "Author: text" per message; a quote is the words, not the label.
  const text = it.body.replace(/\s+/g, " ").replace(/(^|\. )[A-Z][\w.]*(?: [A-Z][\w.]*)?: /g, "$1");
  if (needle) {
    const i = text.toLowerCase().indexOf(needle.toLowerCase());
    if (i >= 0) {
      const start = text.lastIndexOf(". ", i) + 1;
      const end = text.indexOf(". ", i + needle.length);
      return text.slice(start, end < 0 ? undefined : end + 1).trim();
    }
  }
  const first = text.split(/(?<=[.?])\s/)[0] ?? text;
  return first.length > 220 ? `${first.slice(0, 217)}...` : first;
}

function cite(n: number, it: MockItem, needle?: string): Citation {
  return { n, itemId: it.id, chunkId: null, kind: it.kind, title: it.title, platform: it.platform, url: it.url, quote: quoteFrom(it, needle), occurredAt: it.occurredAt };
}

/** The diff between the page's query and the proposed one, clause by clause. */
function proposalFor(current: string, proposed: string, reason: string): QueryProposal {
  const a = new Set(parseQuery(current).clauses.map((c) => (c.kind === "op" ? c.raw : c.kind === "or" ? "OR" : c.kind === "phrase" ? `"${c.value}"` : `${c.negate ? "-" : ""}${c.value}`)));
  const bList = parseQuery(proposed).clauses.map((c) => (c.kind === "op" ? c.raw : c.kind === "or" ? "OR" : c.kind === "phrase" ? `"${c.value}"` : `${c.negate ? "-" : ""}${c.value}`));
  const b = new Set(bList);
  const diff: QueryProposal["diff"] = [
    ...bList.filter((x) => !a.has(x)).map((clause) => ({ op: "+" as const, clause })),
    ...[...a].filter((x) => !b.has(x)).map((clause) => ({ op: "-" as const, clause })),
  ];
  return { query: proposed, diff, count: quietSearch(proposed, 500).total, reason };
}

interface Answer { text: string; citations: Citation[]; grounded: boolean; model: string; searches: string[]; proposal: QueryProposal | null; followups: string[] }

function fixture(question: string, ctx: ChatContext): Answer | null {
  const q = norm(question);
  const current = (ctx.query ?? "").trim();
  if (q === "where are we with globex") {
    const c = [cite(1, find("hubspot", "Globex renewal 2027"), "Priya Shah is the champion"), cite(2, find("outlook-mail", "Globex legal redline, final"), "final redline"), cite(3, find("granola", "Globex contract review"), "multi-year discount")];
    return {
      text: "Priya Shah is your champion on the $84,000 renewal [1]. Globex legal sent the final redline two days ago [2], and on Thursday's call Priya asked for a multi-year discount before signing [3].",
      citations: c, grounded: true, model: "fixture", searches: ["with:globex.com after:30d"],
      proposal: proposalFor(current, `${current ? `${current} ` : ""}with:globex.com after:14d`.trim(), "Narrows to the last two weeks of Globex, where the open questions are."),
      followups: ["What did Marco change in the redline?", "Draft the two-year pricing question for Sam", "When does the Globex deal close?"],
    };
  }
  if (q === "what is blocking the initech pilot" || q === "what s blocking the initech pilot") {
    const c = [cite(1, find("gmail", "Pilot data import"), "60 MB"), cite(2, find("linear", "CSV import fails over 50 MB"), "PR up"), cite(3, find("slack", "Streaming CSV import"), "41 seconds")];
    return {
      text: "Large CSV imports. Initech's first import of the 2023 ledger failed at about 60 MB [1]. The fix, a streaming parser with server-side chunking, is in review [2], and Mia's 180 MB test file went through in 41 seconds [3]. Ravi is waiting on it before importing 2021 and 2022.",
      citations: c, grounded: true, model: "fixture", searches: ["initech import", "ACME-298"],
      proposal: proposalFor(current, "with:initech.io after:14d", "Everything with Initech in the last two weeks, across mail, Linear and Slack."),
      followups: ["Who owns the import fix?", "What are the pilot's success criteria?"],
    };
  }
  if (q === "who is priya shah" || q === "who is priya") {
    const c = [cite(1, find("hubspot", "Priya Shah"), "Champion"), cite(2, find("attio", "Priya Shah"), "Prefers email"), cite(3, find("gmail", "Re: Globex renewal terms"), "answer by Thursday")];
    return {
      text: "Priya Shah is VP Partnerships at Globex and your champion on the renewal [1]. She is in both CRMs since the move to Attio, which notes she prefers email over calls [2]. Her latest email asks for an answer on a two-year price hold by Thursday [3].",
      citations: c, grounded: true, model: "fixture", searches: ['about:"Priya Shah"'],
      proposal: proposalFor(current, "from:priya after:30d type:mail", "Only her own emails from the last 30 days."),
      followups: ["What did Priya ask for most recently?", "Show every meeting with Priya"],
    };
  }
  return null;
}

/** No fixture: quote the top three results and say no model wrote it. */
function extractive(question: string, ctx: ChatContext): Answer {
  const searchFor = /^search (for|in chat)?:?\s*/i.test(question) ? question.replace(/^search (for|in chat)?:?\s*/i, "") : question;
  let res = quietSearch(searchFor, 12);
  let searched = searchFor;
  if (res.results.length === 0 && ctx.query) { res = quietSearch(ctx.query, 12); searched = ctx.query; }
  const top = res.results.slice(0, 3);
  if (!top.length) {
    return { text: "I could not find that in your sources.", citations: [], grounded: true, model: "extractive", searches: [searched], proposal: null, followups: [] };
  }
  const citations = top.map((r, i) => cite(i + 1, ITEMS.find((it) => it.id === r.id)!, undefined));
  const lines = citations.map((c) => `${c.title}: "${c.quote}" [${c.n}]`);
  return {
    text: `Here is what your sources say.\n\n${lines.join("\n\n")}`,
    citations, grounded: true, model: "extractive", searches: [searched], proposal: null,
    followups: top[0] ? [`Tell me more about ${top[0].title}`] : [],
  };
}

function answerFor(question: string, ctx: ChatContext): Answer {
  return fixture(question, ctx) ?? extractive(question, ctx);
}

const title = (m: string) => (m.length > 48 ? `${m.slice(0, 46)}...` : m);
let seq = 0;
const nid = (p: string) => `${p}_${Date.now().toString(36)}${(++seq).toString(36)}`;

route("GET", "/chats", () => [...chats].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(({ id, title, updatedAt }) => ({ id, title, updatedAt })));
route("GET", "/chats/:id", ({ params }) => {
  const c = chats.find((x) => x.id === params.id);
  if (!c) fail(404, "not_found", "No such chat.");
  return { id: c!.id, title: c!.title, messages: c!.messages };
});
route("DELETE", "/chats/:id", ({ params }) => { const i = chats.findIndex((x) => x.id === params.id); if (i >= 0) chats.splice(i, 1); return noContent(); });

route("POST", "/answer", async ({ body }) => {
  const b = body as { q: string };
  await sleep(700);
  const a = answerFor(b.q, { query: b.q });
  return { text: a.text, citations: a.citations, grounded: a.grounded, model: a.model };
});

route("POST", "/chat", ({ body, signal }) => {
  const input = body as ChatTurnInput;
  if (!input?.message?.trim()) fail(400, "bad_request", "Empty message.");
  // A switch for testing the "needs Anthropic" state: localStorage search.mock.noAnthropic = 1.
  try { if (localStorage.getItem("search.mock.noAnthropic") === "1") fail(409, "model_unavailable", "The assistant needs Anthropic in your grant."); } catch (e) { if (e instanceof Error && "code" in e) throw e; }
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: ChatEvent) => controller.enqueue(enc.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
      const aborted = () => !!signal?.aborted;
      const wait = async (ms: number) => { await sleep(ms); if (aborted()) throw new DOMException("aborted", "AbortError"); };
      try {
        let chat = input.chatId ? chats.find((c) => c.id === input.chatId) : undefined;
        if (!chat) { chat = { id: nid("chat"), title: title(input.message.trim()), updatedAt: new Date().toISOString(), messages: [] }; chats.push(chat); }
        const userMsg: ChatMessage = { id: nid("msg"), role: "user", content: input.message.trim(), citations: [], steps: [], proposal: null, followups: [], grounded: true, model: "", createdAt: new Date().toISOString() };
        chat.messages.push(userMsg);
        const messageId = nid("msg");
        send({ type: "chat", chatId: chat.id, messageId });
        const ctxCount = input.context?.itemIds?.length ?? (input.context?.query ? Math.min(12, quietSearch(input.context.query, 12).results.length) : 0);
        const steps: ChatStep[] = [];
        const step = (s: ChatStep) => { const i = steps.findIndex((x) => x.id === s.id); if (i >= 0) steps[i] = s; else steps.push(s); send({ type: "step", step: s }); };
        if (ctxCount > 0) {
          step({ id: "read", label: `Reading ${ctxCount} results`, state: "running", count: ctxCount });
          await wait(450);
          step({ id: "read", label: `Read ${ctxCount} results`, state: "done", count: ctxCount });
        }
        const a = answerFor(input.message.trim(), input.context ?? {});
        let n = 0;
        for (const [i, q] of a.searches.entries()) {
          step({ id: `s${i}`, label: `Searching "${q}"`, state: "running", query: q });
          await wait(650);
          const r = quietSearch(q, 6);
          step({ id: `s${i}`, label: `Searched "${q}"`, state: "done", query: q, count: r.total });
          const fromCites = i === 0 ? a.citations.map((c) => ITEMS.find((it) => it.id === c.itemId)!).map((it) => toRow(it)) : [];
          const rows: ResultRow[] = [...fromCites, ...r.results.filter((x) => !fromCites.some((f) => f.id === x.id))].slice(0, i === 0 ? Math.max(3, fromCites.length) : 3);
          send({ type: "results", items: rows.map((row) => ({ ...row, n: ++n })) });
        }
        step({ id: "write", label: "Writing", state: "running" });
        await wait(900);
        step({ id: "write", label: "Wrote the answer", state: "done" });
        send({ type: "answer", text: a.text, citations: a.citations, grounded: a.grounded, model: a.model });
        if (a.proposal) { await wait(150); send({ type: "proposal", proposal: a.proposal }); }
        if (a.followups.length) send({ type: "followups", items: a.followups });
        chat.messages.push({ id: messageId, role: "assistant", content: a.text, citations: a.citations, steps, proposal: a.proposal, followups: a.followups, grounded: a.grounded, model: a.model, createdAt: new Date().toISOString() });
        chat.updatedAt = new Date().toISOString();
        send({ type: "done", messageId });
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          send({ type: "error", error: { code: "internal", message: (e as Error).message } });
          send({ type: "done" });
        }
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
});
