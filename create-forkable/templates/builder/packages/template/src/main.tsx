import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import App from "./App";
import { Toaster } from "./components/ui/toast";
import { queryClient } from "./lib/api";
import Access from "./routes/Access";
import NotFound from "./routes/NotFound";
import "./index.css";

// Pages. Add a route here when you add a page in src/routes.
const router = createBrowserRouter([
  { path: "/", element: <App /> },
  { path: "/access", element: <Access /> },
  { path: "*", element: <NotFound /> },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Toaster>
        <RouterProvider router={router} />
      </Toaster>
    </QueryClientProvider>
  </StrictMode>,
);
