import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@rill/core": path.resolve(__dirname, "../packages/core/src"),
    },
  },
  server: {
    port: 5180,
    host: true, // LAN too, so an iPad on the same Wi-Fi can open it
    proxy: {
      "/api": { target: process.env.VITE_API_TARGET ?? "http://127.0.0.1:51789", ws: true },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
