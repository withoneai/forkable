import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "vite";

// Workers Static Assets serves dist/mcp/index.html at /mcp (and /contribute
// the same way). vite preview does not, and falls back to the home page, so
// links from the home page looked broken locally. Mirror the Worker here.
function pageDirs(): Plugin {
  return {
    name: "page-dirs",
    configurePreviewServer(server) {
      server.middlewares.use((req, _res, next) => {
        const m = req.url?.match(/^\/(mcp|contribute)(\?.*)?$/);
        if (m) req.url = `/${m[1]}/${m[2] ?? ""}`;
        next();
      });
    },
  };
}

// Two builds. The client build emits the site into dist/. The SSR build
// (`vite build --ssr src/entry-server.tsx`) emits a Node module that
// scripts/prerender.mjs uses to write the real markup into dist/*.html.
export default defineConfig(({ isSsrBuild }) => ({
  plugins: [react(), tailwindcss(), pageDirs()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Flow sources import the MCP kit by the name render_ui gives it.
      "@forkable/ui": path.resolve(__dirname, "./src/flows/kit.tsx"),
    },
  },
  server: {
    port: 5191,
    host: true,
    // The template catalog lives in ../create-forkable/catalog.json.
    fs: { allow: [__dirname, path.resolve(__dirname, "../create-forkable")] },
  },
  build: isSsrBuild
    ? { outDir: "dist-ssr", emptyOutDir: true }
    : {
        outDir: "dist",
        emptyOutDir: true,
        rollupOptions: {
          input: {
            main: path.resolve(__dirname, "index.html"),
            contribute: path.resolve(__dirname, "contribute/index.html"),
            mcp: path.resolve(__dirname, "mcp/index.html"),
          },
        },
      },
}));
