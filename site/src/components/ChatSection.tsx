import { useState } from "react";
import { ArrowUp, BookmarkCheck, Check, Copy, MousePointerClick, Search, ShieldCheck } from "lucide-react";
import { SectionHead } from "./SectionHead";
import { LearnMore } from "./LearnMore";
import { AppWindow } from "./AppWindow";
import { Glyph } from "./Glyph";
import { connectorLogo } from "./icons";
import { useReveal } from "../lib/hooks";

const MCP_URL = "https://blocks.forkable.dev/mcp";

const CELLS = [
  { icon: Search, title: "It finds the actions", body: "The agent looks up what it needs on your accounts and nothing else." },
  { icon: MousePointerClick, title: "A screen you can click", body: "Real buttons, tables and forms on Forkable's kit. Reads run at once." },
  { icon: ShieldCheck, title: "Writes wait for you", body: "Nothing sends or changes until you press Confirm." },
  { icon: BookmarkCheck, title: "Saved for next time", body: "Open it again in the other chat app, or at blocks.forkable.dev." },
];

// Acme Inc sample threads, the same ones Rill and the blocks gallery show.
const ROWS = [
  { from: "Riley Chen", subject: "Offsite date, need a decision today", due: "Today" },
  { from: "Priya Nair", subject: "Term sheet redlines, need you by Thursday", due: "Thu" },
  { from: "Rosa Delgado", subject: "Option pool, need your pick", due: "Fri" },
];

function CopyUrl() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(MCP_URL).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="group flex items-center gap-3 rounded-full border border-border bg-card/80 px-5 py-3 font-mono text-13 text-foreground backdrop-blur-xl transition-colors hover:border-foreground/20"
    >
      <span className="select-all">{MCP_URL}</span>
      <span className="t-icon-swap shrink-0" data-state={copied ? "b" : "a"}>
        <span className="t-icon" data-icon="a">
          <Copy className="size-3.5 text-muted-foreground transition-colors group-hover:text-foreground" strokeWidth={2} />
        </span>
        <span className="t-icon" data-icon="b">
          <Check className="size-3.5 text-accent-fg" strokeWidth={2.5} />
        </span>
      </span>
    </button>
  );
}

// A chat, with the screen the agent made inside it. Reply opens the Confirm
// step the real canvas shows before any write.
function ChatWindow() {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [sent, setSent] = useState<Record<string, boolean>>({});
  return (
    <AppWindow className="flex flex-col">
      <div className="flex flex-col gap-4 p-4">
        <div className="ml-auto max-w-[80%] rounded-2xl bg-foreground/[0.06] px-3.5 py-2 text-13">
          Show me the threads that need a reply from me this week, with a quick yes button.
        </div>
        <p className="text-13 text-muted-foreground">
          I found two Gmail actions on your account and built this. Replies wait for your Confirm.
        </p>

        <div className="relative overflow-hidden rounded-lg border border-border bg-background/60">
          <header className="flex items-center gap-2 border-b border-border px-3 py-2">
            <img src={connectorLogo("gmail")} alt="" className="size-3.5" />
            <span className="text-13 font-medium">Needs a reply this week</span>
            <span className="flex-1" />
            <span className="text-11 text-muted-foreground">Acme Inc sample</span>
          </header>
          <ul className="flex flex-col p-1.5">
            {ROWS.map((r) => (
              <li key={r.from} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-13">
                <span className="w-24 shrink-0 truncate font-medium">{r.from}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{r.subject}</span>
                <span className="hidden shrink-0 text-11 text-muted-foreground sm:inline">{r.due}</span>
                {sent[r.from] ? (
                  <span className="flex shrink-0 items-center gap-1 text-11 text-accent-fg">
                    <Check className="size-3" strokeWidth={2.5} />
                    Sent
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirming(r.from)}
                    className="shrink-0 rounded-md bg-accent-fill px-2.5 py-1 text-11 font-medium text-accent-ink transition-transform active:scale-[0.97]"
                  >
                    Reply yes
                  </button>
                )}
              </li>
            ))}
          </ul>
          <footer className="flex items-center gap-1.5 border-t border-border px-3 py-2 text-11 text-muted-foreground">
            <Glyph id="F6" className="size-3 text-accent-fg" />
            Saved to your blocks
          </footer>

          {confirming && (
            <div className="absolute inset-0 grid place-items-center bg-background/70 p-4 backdrop-blur-sm">
              <div className="w-full max-w-xs rounded-lg border border-border bg-card p-4 shadow-[var(--window-shadow)]">
                <p className="text-13 font-medium">Send an email to {confirming}?</p>
                <p className="mt-1.5 text-11 text-muted-foreground">
                  Gmail · Send an email. Written by the server, not the screen.
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    className="rounded-md px-2.5 py-1 text-11 text-muted-foreground hover:text-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSent((s) => ({ ...s, [confirming]: true }));
                      setConfirming(null);
                    }}
                    className="rounded-md bg-foreground px-2.5 py-1 text-11 font-medium text-background"
                  >
                    Confirm
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-border px-4 py-3">
        <span className="flex-1 text-13 text-muted-foreground">Reply…</span>
        <span className="grid size-6 place-items-center rounded-full bg-foreground/[0.08]">
          <ArrowUp className="size-3.5 text-muted-foreground" strokeWidth={2} />
        </span>
      </div>
    </AppWindow>
  );
}

export function ChatSection() {
  const [ref, shown] = useReveal<HTMLDivElement>(0.15);
  return (
    <section id="chat" className="relative px-6 pb-24 pt-12 sm:pb-36">
      <SectionHead index="04" label="In chat" title={<>Build a real interface<br />in the conversation</>}>
        Add Forkable as a connector in Claude or ChatGPT and sign in with One. Ask for what you need, and the agent
        builds a working screen right in the chat.{" "}
        <span className="text-foreground">It runs on your own accounts.</span>
      </SectionHead>

      <div className="mt-8 flex justify-center">
        <CopyUrl />
      </div>

      <div ref={ref} className={`t-stagger mx-auto mt-12 max-w-6xl ${shown ? "is-shown" : ""}`}>
        <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[3fr_2fr]">
          <div className="t-stagger-line t-stagger-line--1">
            <ChatWindow />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
            {CELLS.map((c, i) => (
              <div
                key={c.title}
                className={`t-stagger-line t-stagger-line--${Math.min(i + 1, 4)} flex flex-col gap-1.5 rounded-xl border border-border bg-card/50 p-4`}
              >
                <span className="flex items-center gap-2">
                  <c.icon className="size-4 text-accent-fg" strokeWidth={1.75} />
                  <h3 className="text-13 font-medium">{c.title}</h3>
                </span>
                <p className="text-13 text-muted-foreground">{c.body}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="t-stagger-line t-stagger-line--4 mt-3 flex flex-col gap-4 rounded-xl border border-border bg-card/50 p-4 sm:flex-row sm:items-center">
          <div className="flex-1">
            <h3 className="text-15 font-medium">Build your own MCP</h3>
            <p className="mt-1.5 max-w-xl text-13 text-muted-foreground">
              Start from the same open source code. Sign in with One is its login, so every tool call runs on the
              person's own accounts.
            </p>
          </div>
          <LearnMore href="https://github.com/withoneai/forkable/tree/main/mcp">
            Read the code
          </LearnMore>
        </div>
      </div>

      <div className="mt-6 flex justify-center">
        <LearnMore href="https://blocks.forkable.dev">Open blocks.forkable.dev</LearnMore>
      </div>
    </section>
  );
}
