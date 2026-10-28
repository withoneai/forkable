import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { App } from "./App";
import { ContributePage } from "./components/contribute/ContributePage";

// Build-time prerender (scripts/prerender.mjs): the HTML an agent or a plain
// fetch gets, with the real copy, template cards and commands in it. The
// client then hydrates the same tree (main.tsx, contribute.tsx).
export function render(page: "home" | "contribute"): string {
  return renderToString(<StrictMode>{page === "home" ? <App /> : <ContributePage />}</StrictMode>);
}
