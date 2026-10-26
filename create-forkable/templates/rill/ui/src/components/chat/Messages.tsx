import type { ReactNode } from "react";
import type { ApiChatMessage } from "@rill/core/api-types";
import type { ChatBlocks, ChatCitation } from "@rill/core/types";
import { Markdown } from "./Markdown";
import { ProposalCard } from "./ProposalCard";

function Row({ role, children }: { role: "user" | "assistant" | "system"; children: ReactNode }) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[90%] rounded-xl rounded-br-sm bg-muted px-3 py-2">{children}</div>
      </div>
    );
  }
  return (
    <div className="flex" aria-live="polite">
      <div className="min-w-0 max-w-full flex-1">{children}</div>
    </div>
  );
}

function CitationChip({ citation, onOpen }: { citation: ChatCitation; onOpen: (threadId: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(citation.threadId)}
      className="flex w-full flex-col gap-0.5 rounded-md border border-border bg-faint px-2.5 py-1.5 text-left transition-colors hover:bg-card-hover"
    >
      <span className="truncate text-xs font-medium">{citation.subject}</span>
      {citation.quote && <span className="truncate text-11 text-muted-foreground">&ldquo;{citation.quote}&rdquo;</span>}
    </button>
  );
}

function AssistantMessage({ content, blocks, mailboxId, onSendMessage, onOpenThread }: {
  content: string;
  blocks: ChatBlocks;
  mailboxId: string;
  onSendMessage: (text: string) => void;
  onOpenThread: (threadId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Markdown text={content} />
      {!!blocks.citations?.length && (
        <div className="flex flex-col gap-1.5">
          {blocks.citations.map((c) => <CitationChip key={c.threadId} citation={c} onOpen={onOpenThread} />)}
        </div>
      )}
      {!!blocks.proposals?.length && (
        <div className="flex flex-col gap-1.5">
          {blocks.proposals.map((p, i) => (
            <ProposalCard key={i} proposal={p} mailboxId={mailboxId} onSendMessage={onSendMessage} onOpenThread={onOpenThread} />
          ))}
        </div>
      )}
    </div>
  );
}

export function MessageList({ messages, pendingUser, streaming, mailboxId, onSendMessage, onOpenThread }: {
  messages: ApiChatMessage[];
  pendingUser: string | null;
  streaming: { text: string; blocks: ChatBlocks } | null;
  mailboxId: string;
  onSendMessage: (text: string) => void;
  onOpenThread: (threadId: string) => void;
}) {
  if (messages.length === 0 && !pendingUser && !streaming) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
        <p className="text-13 font-medium">Ask about your inbox</p>
        <p className="text-xs text-muted-foreground">Summarize a thread, find an old email, or clean up a lane. Nothing happens until you click a proposal.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4 px-3 py-3">
      {messages.map((m) => (
        <Row key={m.id} role={m.role}>
          {m.role === "assistant" ? (
            <AssistantMessage content={m.content} blocks={m.blocks} mailboxId={mailboxId} onSendMessage={onSendMessage} onOpenThread={onOpenThread} />
          ) : (
            <p className="whitespace-pre-wrap text-13">{m.content}</p>
          )}
        </Row>
      ))}
      {pendingUser && (
        <Row role="user">
          <p className="whitespace-pre-wrap text-13">{pendingUser}</p>
        </Row>
      )}
      {streaming && (
        <Row role="assistant">
          {streaming.text ? (
            <AssistantMessage content={streaming.text} blocks={streaming.blocks} mailboxId={mailboxId} onSendMessage={onSendMessage} onOpenThread={onOpenThread} />
          ) : (
            <span className="inline-flex gap-1 py-1" aria-label="Thinking">
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:-0.2s]" />
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:-0.1s]" />
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50" />
            </span>
          )}
        </Row>
      )}
    </div>
  );
}
