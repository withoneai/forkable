import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Agent replies are
// prose with the odd list, heading or code block, so a tiny renderer beats a
// markdown dependency: paragraphs, **bold**, `code`, - and 1. lists, #
// headings and fenced code.

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`/g;
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] !== undefined) nodes.push(<strong key={`${keyPrefix}-${i}`} className="font-semibold">{m[1]}</strong>);
    else nodes.push(<code key={`${keyPrefix}-${i}`} className="rounded-sm bg-muted px-1 py-px font-mono text-xs">{m[2]}</code>);
    last = re.lastIndex;
    i++;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

type Block = { kind: "code"; text: string } | { kind: "text"; text: string };

function split(text: string): Block[] {
  const out: Block[] = [];
  const parts = text.split(/^```[^\n]*\n?/m);
  parts.forEach((p, i) => {
    if (i % 2 === 1) out.push({ kind: "code", text: p.replace(/\n$/, "") });
    else for (const b of p.split(/\n{2,}/)) if (b.trim()) out.push({ kind: "text", text: b.trim() });
  });
  return out;
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = split(text);
  if (blocks.length === 0) return null;
  return (
    <div className={cn("flex flex-col gap-2 text-13 leading-relaxed", className)}>
      {blocks.map((block, bi) => {
        if (block.kind === "code") {
          return <pre key={bi} className="overflow-x-auto rounded-md border border-border bg-faint px-3 py-2 font-mono text-xs leading-5">{block.text}</pre>;
        }
        const lines = block.text.split("\n").filter((l) => l.trim().length > 0);
        const bullets = lines.every((l) => /^\s*[-*]\s+/.test(l));
        const numbers = lines.every((l) => /^\s*\d+[.)]\s+/.test(l));
        if (bullets || numbers) {
          const Tag = numbers ? "ol" : "ul";
          return (
            <Tag key={bi} className={cn("flex flex-col gap-1 pl-5", numbers ? "list-decimal" : "list-disc")}>
              {lines.map((l, li) => <li key={li}>{renderInline(l.trim().replace(/^([-*]|\d+[.)])\s+/, ""), `${bi}-${li}`)}</li>)}
            </Tag>
          );
        }
        const h = /^(#{1,4})\s+(.*)$/.exec(lines[0] ?? "");
        if (h && lines.length === 1) return <p key={bi} className="font-semibold">{renderInline(h[2]!, `${bi}`)}</p>;
        return (
          <p key={bi}>
            {lines.flatMap((l, li) => (li === 0 ? renderInline(l, `${bi}-${li}`) : [<br key={`br-${bi}-${li}`} />, ...renderInline(l, `${bi}-${li}`)]))}
          </p>
        );
      })}
    </div>
  );
}
