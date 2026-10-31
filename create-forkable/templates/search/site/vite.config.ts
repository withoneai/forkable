import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Two builds. The client build emits the site into dist/. The SSR build
// (`vite build --ssr src/entry-server.tsx`) emits a Node module that
// scripts/prerender.mjs uses to write the real markup into dist/index.html.
export default defineConfig(({ isSsrBuild }) => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5690,
    host: true,
  },
  build: isSsrBuild ? { outDir: "dist-ssr", emptyOutDir: true } : { outDir: "dist", emptyOutDir: true },
}));
