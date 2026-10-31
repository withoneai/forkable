import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Search as SearchIcon, Sparkles } from "lucide-react";
import clsx from "clsx";
import { connectorLogo } from "./icons";
import { DEMO_QUERIES, SOURCE_NAMES, type DemoQuery, type Entity, type SearchResult } from "../lib/sample";

type Phase = "typing" | "results" | "asking" | "answering" | "hold" | "deleting";

const TYPE_MS = 55;
const DELETE_MS = 22;
const ANSWER_MS = 16;
const HOLD_MS = 3200;

function bold(text: string, words: string[]): ReactNode {
  const re = new RegExp(`(${words.join("|")})`, "gi");
  return text.split(re).map((part, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-semibold text-foreground">
        {part}
      </strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

type Part = { text: string } | { cite: number };

function parseAnswer(answer: string): Part[] {
  return answer.split(/(\[\d+\])/).filter(Boolean).map((s) => {
    const m = s.match(/^\[(\d+)\]$/);
    return m ? { cite: Number(m[1]) } : { text: s };
  });
}

const answerLength = (parts: Part[]) => parts.reduce((n, p) => n + ("text" in p ? p.text.length : 1), 0);

function Cite({ n }: { n: number }) {
  return (
    <span className="mx-0.5 inline-grid size-4 place-items-center rounded-sm bg-accent-fill align-middle font-mono text-11 font-medium leading-none text-accent-ink">
      {n}
    </span>
  );
}

function Answer({ parts, chars }: { parts: Part[]; chars: number }) {
  let left = chars;
  const out: ReactNode[] = [];
  parts.forEach((p, i) => {
    if (left <= 0) return;
    if ("text" in p) {
      out.push(<Fragment key={i}>{p.text.slice(0, left)}</Fragment>);
      left -= p.text.length;
    } else {
      out.push(<Cite key={i} n={p.cite} />);
      left -= 1;
    }
  });
  return <>{out}</>;
}

function EntityCard({ e }: { e: Entity }) {
  return (
    <div className="flex min-w-[11.5rem] items-center gap-2 rounded-lg border border-border bg-card/60 p-2">
      <span className="grid size-8 shrink-0 place-items-center rounded-full border border-border text-11 font-medium text-muted-foreground">
        {e.initials}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-13 font-medium text-foreground">{e.name}</span>
        <span className="block truncate text-11 text-muted-foreground">{e.role}</span>
        <span className="mt-0.5 flex items-center gap-1">
          <span className="flex -space-x-1">
            {e.sources.slice(0, 4).map((s) => (
              <img key={s} src={connectorLogo(s)} alt="" className="size-3 rounded-full bg-background ring-1 ring-background" />
            ))}
          </span>
          <span className="text-11 text-muted-foreground">{e.items} items</span>
        </span>
      </span>
    </div>
  );
}

function Row({ r, words, cite }: { r: SearchResult; words: string[]; cite?: number }) {
  return (
    <li
      className={clsx(
        "motion-in grid grid-cols-[1rem_3.5rem_minmax(0,1fr)_auto] items-start gap-x-2 border-l-2 py-2 pl-2.5 pr-3 transition-colors duration-300",
        cite ? "border-accent-fill bg-card" : "border-transparent",
      )}
    >
      <img src={connectorLogo(r.source)} alt="" className="mt-0.5 size-4" />
      <span className="mt-px text-11 text-muted-foreground">{r.kind}</span>
      <span className="min-w-0">
        <span className="block truncate text-13 text-muted-foreground">
          {r.who && <span className="font-medium text-foreground">{r.who} · </span>}
          <span className="text-foreground">{bold(r.title, words)}</span>
        </span>
        <span className="mt-0.5 block truncate text-11 text-muted-foreground">{bold(r.sub, words)}</span>
      </span>
      <span className="flex items-center gap-1.5 text-11 text-muted-foreground">
        {r.amount && <span className="font-medium text-foreground">{r.amount}</span>}
        {r.badge && <span className="hidden rounded-md sm:inline border border-border px-1.5 py-px text-foreground">{r.badge}</span>}
        {cite ? <Cite n={cite} /> : !r.amount && <span>{r.time}</span>}
      </span>
    </li>
  );
}

// The hero's demo, built like the app's own search screen: type a query,
// the people and companies it touches, ranked rows from every source, then
// the assistant answers from those rows and numbers each claim back to one.
// All on the Acme Inc sample, no network calls.
export function SearchDemo() {
  const [qIndex, setQIndex] = useState(0);
  const [typed, setTyped] = useState("");
  const [phase, setPhase] = useState<Phase>("typing");
  const [chars, setChars] = useState(0);
  const [still, setStill] = useState(false);
  const demo: DemoQuery = DEMO_QUERIES[qIndex % DEMO_QUERIES.length];
  const parts = parseAnswer(demo.answer);
  const total = answerLength(parts);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) setStill(true);
  }, []);

  useEffect(() => {
    if (still) {
      setTyped(demo.query);
      setChars(total);
      setPhase("hold");
      return;
    }
    let t: ReturnType<typeof setTimeout>;
    if (phase === "typing") {
      t = typed.length < demo.query.length
        ? setTimeout(() => setTyped(demo.query.slice(0, typed.length + 1)), TYPE_MS)
        : setTimeout(() => setPhase("results"), 300);
    } else if (phase === "results") {
      t = setTimeout(() => setPhase("asking"), 1100);
    } else if (phase === "asking") {
      t = setTimeout(() => setPhase("answering"), 700);
    } else if (phase === "answering") {
      t = chars < total ? setTimeout(() => setChars(chars + 2), ANSWER_MS) : setTimeout(() => setPhase("hold"), 200);
    } else if (phase === "hold") {
      t = setTimeout(() => setPhase("deleting"), HOLD_MS);
    } else if (typed.length > 0) {
      t = setTimeout(() => setTyped(typed.slice(0, -1)), DELETE_MS);
    } else {
      setChars(0);
      setQIndex((i) => i + 1);
      setPhase("typing");
    }
    return () => clearTimeout(t);
  }, [typed, phase, chars, demo, total, still]);

  const showResults = phase !== "typing" && phase !== "deleting";
  const showQuestion = phase === "asking" || phase === "answering" || phase === "hold";
  const answerDone = phase === "hold";
  const citeOf = (id: string) => (answerDone ? demo.cites.indexOf(id) + 1 || undefined : undefined);

  return (
    <div className="squircle overflow-hidden rounded-xl border border-border bg-background text-left shadow-[var(--window-shadow)]">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="min-w-0 border-b border-border lg:border-b-0 lg:border-r">
          <div className="p-3">
            <div className="flex items-center gap-2 rounded-lg border border-border bg-card/60 px-3 py-2">
              <SearchIcon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
              <span className="min-w-0 flex-1 truncate text-13 text-foreground">
                {typed || <span className="text-muted-foreground">Search everything, or ask a question</span>}
                {!still && <span className="caret ml-px" aria-hidden />}
              </span>
              <kbd className="rounded-md border border-border px-1.5 font-mono text-11 text-muted-foreground">/</kbd>
            </div>
          </div>
          <div className="h-[23rem] overflow-hidden">
            {showResults ? (
              <>
                <div className="flex gap-2 overflow-hidden px-3">
                  {demo.entities.map((e) => (
                    <EntityCard key={e.name} e={e} />
                  ))}
                </div>
                <div className="flex items-center justify-between px-3 pb-1 pt-3 font-mono text-11 uppercase tracking-wide text-muted-foreground">
                  <span>{demo.results.length} results</span>
                  <span className="normal-case tracking-normal">7 ms · keyword and semantic</span>
                </div>
                <ul className="fade-bottom">
                  {demo.results.map((r) => (
                    <Row key={r.id} r={r} words={demo.match} cite={citeOf(r.id)} />
                  ))}
                </ul>
              </>
            ) : (
              <p className="px-3 pt-2 text-13 text-muted-foreground">
                {phase === "deleting" ? "" : "Searching HubSpot, Gmail, Notion, Linear, Slack and 6 more…"}
              </p>
            )}
          </div>
        </div>

        <div className="hidden min-w-0 flex-col gap-3 p-4 sm:flex">
          <div className="flex items-center gap-1.5 text-11 uppercase tracking-wide text-muted-foreground">
            <Sparkles className="size-3.5 text-accent-fg" strokeWidth={1.75} />
            Ask
            {showResults && <span className="ml-auto normal-case tracking-normal">Looking at {demo.results.length} results</span>}
          </div>
          {showQuestion ? (
            <>
              <p className="motion-in ml-auto max-w-[85%] rounded-lg bg-card px-3 py-2 text-13 text-foreground">{demo.question}</p>
              <p className="min-h-[7.5rem] text-13 leading-relaxed text-foreground">
                <Answer parts={parts} chars={chars} />
                {phase === "answering" && <span className="caret" aria-hidden />}
              </p>
              {answerDone && (
                <ol className="motion-in flex flex-col gap-1">
                  {demo.cites.map((id, i) => {
                    const r = demo.results.find((x) => x.id === id)!;
                    return (
                      <li key={id} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-11 text-muted-foreground">
                        <Cite n={i + 1} />
                        <img src={connectorLogo(r.source)} alt="" className="size-3.5" />
                        <span className="shrink-0">{SOURCE_NAMES[r.source]}</span>
                        <span className="truncate text-foreground">{r.title}</span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </>
          ) : (
            <p className="text-13 text-muted-foreground">
              Ask about what you found. Every claim links back to the result it came from.
            </p>
          )}
          <p className="mt-auto text-11 text-muted-foreground">Answers come only from items Search found.</p>
        </div>
      </div>
    </div>
  );
}
