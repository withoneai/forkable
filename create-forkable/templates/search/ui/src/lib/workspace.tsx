// The one workspace the results list, the preview and the assistant dock share
// (search-ux-mobbin.md 2.6: "the dock and the list are one workspace"). The
// query itself lives in the URL (/?q=); this holds what the URL cannot.
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { ResultRow, SearchResponse } from "@/contract/api-types";

export interface Workspace {
  /** The box text as the URL has it. */
  query: string;
  /** Rewrites the box (and the URL). The only way the page's query changes. */
  setQuery: (q: string, opts?: { replace?: boolean }) => void;
  /** The last results the list showed, so the dock can cite and count them. */
  results: SearchResponse | null;
  setResults: (r: SearchResponse | null) => void;
  selectedId: string | null;
  /** Selects a row and opens the preview; `quote` scrolls the preview to it. */
  select: (id: string | null, opts?: { quote?: string; open?: boolean }) => void;
  focusQuote: string | null;
  previewOpen: boolean;
  setPreviewOpen: (v: boolean) => void;
  dockOpen: boolean;
  setDockOpen: (v: boolean) => void;
  /** Opens the dock and focuses its composer, optionally pinning items as context. */
  askAbout: (rows?: ResultRow[], question?: string) => void;
  dockPins: ResultRow[];
  setDockPins: (rows: ResultRow[]) => void;
  pendingQuestion: string | null;
  takePendingQuestion: () => string | null;
  composerFocus: React.MutableRefObject<(() => void) | null>;
  boxFocus: React.MutableRefObject<(() => void) | null>;
}

const Ctx = createContext<Workspace | null>(null);

export function WorkspaceProvider({ children, dockOpen, setDockOpen }: { children: ReactNode; dockOpen: boolean; setDockOpen: (v: boolean) => void }) {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const query = params.get("q") ?? "";
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusQuote, setFocusQuote] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [dockPins, setDockPins] = useState<ResultRow[]>([]);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const composerFocus = useRef<(() => void) | null>(null);
  const boxFocus = useRef<(() => void) | null>(null);

  const setQuery = useCallback((q: string, opts?: { replace?: boolean }) => {
    const t = q.trim();
    nav(t ? `/?q=${encodeURIComponent(t)}` : "/", { replace: opts?.replace });
  }, [nav]);

  const select = useCallback((id: string | null, opts?: { quote?: string; open?: boolean }) => {
    setSelectedId(id);
    setFocusQuote(opts?.quote ?? null);
    if (opts?.open) setPreviewOpen(true);
  }, []);

  const askAbout = useCallback((rows?: ResultRow[], question?: string) => {
    if (rows) setDockPins(rows);
    if (question) setPendingQuestion(question);
    setDockOpen(true);
    setTimeout(() => composerFocus.current?.(), 0);
  }, [setDockOpen]);

  const value = useMemo<Workspace>(() => ({
    query, setQuery, results, setResults, selectedId, select, focusQuote, previewOpen, setPreviewOpen, dockOpen, setDockOpen,
    askAbout, dockPins, setDockPins, pendingQuestion, takePendingQuestion: () => { const q = pendingQuestion; setPendingQuestion(null); return q; },
    composerFocus, boxFocus,
  }), [query, setQuery, results, selectedId, select, focusQuote, previewOpen, dockOpen, setDockOpen, askAbout, dockPins, pendingQuestion]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace(): Workspace {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWorkspace outside WorkspaceProvider");
  return v;
}
