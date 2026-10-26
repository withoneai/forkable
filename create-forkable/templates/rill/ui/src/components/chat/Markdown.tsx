import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// The assistant's replies are plain prose plus the occasional list or bold
// word, never a full document, so a tiny renderer beats a markdown dependency:
// paragraphs, **bold**, "- " lists and `code`, nothing else.

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`/g;
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] !== undefined) nodes.push(<strong key={`${keyPrefix}-${i}`}>{m[1]}</strong>);
    else nodes.push(<code key={`${keyPrefix}-${i}`} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">{m[2]}</code>);
    last = re.lastIndex;
    i++;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  if (blocks.length === 0) return null;
  return (
    <div className={cn("flex flex-col gap-2 text-13", className)}>
      {blocks.map((block, bi) => {
        const lines = block.split("\n").filter((l) => l.trim().length > 0);
        const isList = lines.length > 0 && lines.every((l) => /^[-*]\s+/.test(l.trim()));
        if (isList) {
          return (
            <ul key={bi} className="flex flex-col gap-1 pl-4">
              {lines.map((l, li) => (
                <li key={li} className="list-disc">
                  {renderInline(l.trim().replace(/^[-*]\s+/, ""), `${bi}-${li}`)}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={bi}>
            {lines.flatMap((l, li) =>
              li === 0 ? renderInline(l, `${bi}-${li}`) : [<br key={`br-${bi}-${li}`} />, ...renderInline(l, `${bi}-${li}`)],
            )}
          </p>
        );
      })}
    </div>
  );
}
