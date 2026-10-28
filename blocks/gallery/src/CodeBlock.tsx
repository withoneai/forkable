import { useMemo } from "react";
import clsx from "clsx";
import { highlightCode, tagHighlighter, tags as t } from "@lezer/highlight";
import { parser as jsParser } from "@lezer/javascript";
import { parser as jsonParser } from "@lezer/json";

// Read-only code with the Builder editor's colors: the same lezer parsers and
// the same tag-to-color map (CodeEditor.tsx there), as classes styled by the
// --code-* variables in index.css, so light and dark follow the theme.
const classes = tagHighlighter([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier], class: "tok-keyword" },
  { tag: [t.string, t.special(t.string), t.regexp], class: "tok-string" },
  { tag: [t.number, t.bool, t.null, t.atom], class: "tok-number" },
  { tag: [t.comment, t.lineComment, t.blockComment], class: "tok-comment" },
  { tag: [t.typeName, t.className, t.namespace], class: "tok-type" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], class: "tok-fn" },
  { tag: [t.tagName, t.angleBracket], class: "tok-tag" },
  { tag: [t.attributeName, t.propertyName], class: "tok-attr" },
]);

export type CodeLang = "ts" | "tsx" | "json" | "text";

export function langOf(path: string): CodeLang {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "tsx" || ext === "jsx") return "tsx";
  if (ext === "ts" || ext === "js" || ext === "mjs") return "ts";
  if (ext === "json") return "json";
  return "text";
}

type Span = { text: string; cls: string };

function tokenize(code: string, lang: CodeLang): Span[][] {
  const lines: Span[][] = [[]];
  if (lang === "text") {
    for (const l of code.split("\n").slice(1)) lines.push([{ text: l, cls: "" }]);
    lines[0] = [{ text: code.split("\n")[0], cls: "" }];
    return lines;
  }
  const parser =
    lang === "json" ? jsonParser : jsParser.configure({ dialect: lang === "tsx" ? "ts jsx" : "ts" });
  highlightCode(
    code,
    parser.parse(code),
    classes,
    (text, cls) => lines[lines.length - 1].push({ text, cls }),
    () => lines.push([]),
  );
  return lines;
}

export function CodeBlock({
  code,
  lang = "ts",
  lineNumbers = false,
  className,
}: {
  code: string;
  lang?: CodeLang;
  lineNumbers?: boolean;
  className?: string;
}) {
  const lines = useMemo(() => tokenize(code, lang), [code, lang]);
  const gutter = String(lines.length).length;
  return (
    <pre
      data-code
      className={clsx(
        "overflow-auto rounded-lg border border-border bg-card py-3 font-mono text-11 leading-relaxed text-foreground",
        className,
      )}
    >
      <code className="block min-w-max">
        {lines.map((spans, i) => (
          <span key={i} className="flex px-3">
            {lineNumbers && (
              <span
                className="mr-4 shrink-0 select-none text-right text-muted-foreground/60"
                style={{ width: `${gutter}ch` }}
              >
                {i + 1}
              </span>
            )}
            <span>
              {spans.length === 0 || (spans.length === 1 && spans[0].text === "")
                ? "\u00a0"
                : spans.map((s, j) => (s.cls ? <span key={j} className={s.cls}>{s.text}</span> : s.text))}
            </span>
          </span>
        ))}
      </code>
    </pre>
  );
}
