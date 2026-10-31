import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const target = process.env.VITE_API_TARGET ?? "http://127.0.0.1:52289";
const proxied = ["/api", "/mcp", "/oauth", "/.well-known", "/authorize", "/token", "/register", "/revoke"];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src"), "@search/core": path.resolve(__dirname, "../packages/core/src") } },
  server: {
    port: 5680,
    host: true,
    // In mock mode (VITE_MOCK=1) the browser answers /api itself, so nothing is proxied.
    proxy: process.env.VITE_MOCK === "1" ? undefined : Object.fromEntries(proxied.map((p) => [p, { target, ws: p === "/api" }])),
  },
  preview: { port: 5680 },
  build: { outDir: "dist", emptyOutDir: true },
});
