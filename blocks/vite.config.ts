import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: "gallery",
  // Deployed under forkable.dev/blocks; local dev stays at /.
  base: process.env.BLOCKS_BASE ?? "/",
  build: { outDir: "../dist", emptyOutDir: true },
  plugins: [react(), tailwindcss()],
  server: {
    port: 5590,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:52190" },
    fs: { allow: [".."] },
  },
});
