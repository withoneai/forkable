import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Two builds. The client build emits the site into dist/. The SSR build
// (`vite build --ssr src/entry-server.tsx`) emits a Node module that
// scripts/prerender.mjs uses to write the real markup into dist/*.html.
export default defineConfig(({ isSsrBuild }) => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
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
          },
        },
      },
}));
