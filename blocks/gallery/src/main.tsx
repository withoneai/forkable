import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";
import { installBrowserApi } from "./browser-api";

if (import.meta.env.VITE_BROWSER_API === "1") installBrowserApi();

createRoot(document.getElementById("root")!).render(<App />);
