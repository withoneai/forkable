import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { App } from "./App";

// Build-time prerender (scripts/prerender.mjs): the HTML an agent or a
// plain fetch gets, with the real copy and the search demo's first frame
// in it. The client then hydrates the same tree (main.tsx).
export function render(): string {
  return renderToString(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
