import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { devTagger } from "./tools/dev-tagger";

// One dev server for the whole app: React with HMR, and the Hono API in
// server/ running inside workerd through the Cloudflare plugin, on one origin.
// When __BRAND_NAME__ runs the preview it sets the env below; without it this is a
// plain Vite app. `vite build --mode vercel` (pnpm build:vercel) builds the
// React app alone into dist/client; tools/build-vercel.mjs bundles the API.

const P = "__ENV_PREFIX__";
const env = process.env;
const root = dirname(fileURLToPath(import.meta.url));
const managed = Boolean(env[`${P}PROJECT_ID`]);
const tagger = devTagger({ root });
// The app's own values from its Environment in __BRAND_NAME__, handed to the
// Worker as vars (c.env.NAME). They arrive in this process's env only.
const appVars = (() => {
  try {
    return JSON.parse(env[`${P}APP_ENV`] ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
})();

export default defineConfig(({ command, mode }) => ({
  plugins: [
    react({ babel: { plugins: command === "serve" && managed ? [tagger.babel] : [] } }),
    tailwindcss(),
    mode === "vercel" ? null : cloudflare({ inspectorPort: false, config: (c) => ({ vars: { ...c.vars, ...appVars } }) }),
    tagger.plugin,
  ],
  resolve: { alias: { "@": `${root}/src` } },
  build: mode === "vercel" ? { outDir: "dist/client", emptyOutDir: true } : undefined,
  // Bundled at startup, so the first page load does not stop to optimize and reload.
  optimizeDeps: {
    include: [
      "react",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "react-router",
      "@tanstack/react-query",
      "lucide-react",
      "radix-ui",
      "clsx",
      "tailwind-merge",
      "class-variance-authority",
      "@withone/connect/react",
    ],
  },
  server: managed
    ? {
        host: "127.0.0.1",
        port: Number(env[`${P}DEV_PORT`] ?? 5173),
        strictPort: true,
        allowedHosts: [".localhost"],
        hmr: env[`${P}HMR_PORT`] ? { clientPort: Number(env[`${P}HMR_PORT`]) } : undefined,
      }
    : undefined,
  clearScreen: false,
}));
