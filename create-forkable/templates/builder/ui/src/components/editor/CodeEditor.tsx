import { useEffect, useRef } from "react";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, HighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { javascript } from "@codemirror/lang-javascript";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { html } from "@codemirror/lang-html";
import { tags as t } from "@lezer/highlight";

// Colors come from CSS variables (index.css), so light and dark follow the
// theme class without rebuilding the editor.
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier], color: "var(--code-keyword)" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "var(--code-string)" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "var(--code-number)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--code-comment)", fontStyle: "italic" },
  { tag: [t.typeName, t.className, t.namespace], color: "var(--code-type)" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--code-fn)" },
  { tag: [t.tagName, t.angleBracket], color: "var(--code-tag)" },
  { tag: [t.attributeName, t.propertyName], color: "var(--code-attr)" },
  { tag: [t.heading], fontWeight: "600", color: "var(--foreground)" },
  { tag: [t.link, t.url], color: "var(--accent)", textDecoration: "underline" },
  { tag: t.invalid, color: "var(--destructive-text)" },
]);

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "var(--text-13)", backgroundColor: "var(--card)", color: "var(--foreground)" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.6" },
  ".cm-content": { padding: "0.75rem 0", caretColor: "var(--foreground)" },
  ".cm-gutters": { backgroundColor: "var(--card)", color: "color-mix(in oklch, var(--muted-foreground) 70%, transparent)", border: "none", paddingLeft: "0.25rem" },
  ".cm-activeLine": { backgroundColor: "color-mix(in oklch, var(--muted) 55%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--foreground)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "color-mix(in oklch, var(--accent) 22%, transparent) !important" },
  ".cm-cursor": { borderLeftColor: "var(--foreground)" },
  "&.cm-focused": { outline: "none" },
  ".cm-foldGutter span": { color: "var(--muted-foreground)" },
  ".cm-matchingBracket": { backgroundColor: "color-mix(in oklch, var(--accent) 18%, transparent)", outline: "none" },
  ".cm-flash-line": { backgroundColor: "color-mix(in oklch, var(--warning-text) 18%, transparent)" },
  ".cm-panels": { backgroundColor: "var(--faint)", color: "var(--foreground)", borderColor: "var(--border)" },
});

function language(path: string): Extension {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts": return javascript({ typescript: true });
    case "tsx": return javascript({ typescript: true, jsx: true });
    case "js": case "mjs": case "cjs": return javascript();
    case "jsx": return javascript({ jsx: true });
    case "css": return css();
    case "json": case "jsonc": return json();
    case "md": case "mdx": return markdown();
    case "html": return html();
    default: return [];
  }
}

export function CodeEditor({ path, value, readOnly, onChange, onSave, line }: {
  path: string;
  value: string;
  readOnly: boolean;
  onChange: (v: string) => void;
  onSave: () => void;
  /** Scroll to and flash this 1-based line. */
  line?: number | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const lang = useRef(new Compartment());
  const ro = useRef(new Compartment());
  const cbs = useRef({ onChange, onSave });
  cbs.current = { onChange, onSave };

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(), foldGutter(), highlightActiveLineGutter(), highlightSpecialChars(), history(), drawSelection(),
          indentOnInput(), bracketMatching(), highlightActiveLine(), highlightSelectionMatches(),
          syntaxHighlighting(highlight), theme, EditorState.tabSize.of(2),
          keymap.of([
            { key: "Mod-s", preventDefault: true, run: () => { cbs.current.onSave(); return true; } },
            ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab,
          ]),
          lang.current.of(language(path)),
          ro.current.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
          EditorView.updateListener.of((u) => { if (u.docChanged) cbs.current.onChange(u.state.doc.toString()); }),
        ],
      }),
    });
    view.current = v;
    return () => { v.destroy(); view.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // New file or new content from the server: replace the doc without firing onChange.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    v.dispatch({ effects: [lang.current.reconfigure(language(path)), ro.current.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)])] });
    if (v.state.doc.toString() !== value) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value }, annotations: [] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, readOnly, value]);

  useEffect(() => {
    const v = view.current;
    if (!v || !line) return;
    const n = Math.min(Math.max(1, line), v.state.doc.lines);
    const l = v.state.doc.line(n);
    v.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: "center" }) });
    v.focus();
  }, [line, path]);

  return <div ref={host} className="h-full min-h-0 overflow-hidden" data-testid="code-editor" />;
}
