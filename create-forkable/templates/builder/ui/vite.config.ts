import path from "node:path";
import fs from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const mock = process.env.VITE_MOCK === "1";

/**
 * Mock mode only: requests on the `localhost` host (the editor runs on
 * 127.0.0.1) get a fake preview app, so the iframe is a real second origin
 * and the channel's origin checks run as they do against the 51990 proxy.
 */
function mockPreview(): Plugin {
  return {
    name: "builder-mock-preview",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const host = req.headers.host ?? "";
        if (!host.startsWith("localhost")) return next();
        if (req.url?.startsWith("/@") || req.url?.startsWith("/src/") || req.url?.startsWith("/node_modules/")) return next();
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(fs.readFileSync(path.resolve(__dirname, "mock/preview.html")));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), ...(mock ? [mockPreview()] : [])],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    port: 5380,
    strictPort: true,
    host: mock ? true : "127.0.0.1",
    proxy: mock
      ? undefined
      : { "/api": { target: process.env.VITE_API_TARGET ?? "http://127.0.0.1:51989", changeOrigin: false } },
  },
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 1500 },
});
