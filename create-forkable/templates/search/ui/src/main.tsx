import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { applyTheme } from "./lib/theme";
import { applyScale } from "./lib/scale";

applyTheme();
applyScale();

async function boot() {
  // VITE_MOCK=1 answers every /api route in the browser (ui/src/mock). Unset,
  // the same calls go through Vite's proxy to the server on 52289.
  if (import.meta.env.VITE_MOCK === "1") {
    const { installMockServer } = await import("./mock/server");
    installMockServer();
  }
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 5_000 },
      mutations: { retry: 0 },
    },
  });
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <QueryClientProvider client={qc}>
        <BrowserRouter>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}

void boot();
