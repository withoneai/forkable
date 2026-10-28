import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// One self-contained HTML file per view: hosts load a ui:// resource as a
// single document, with no other requests. VIEW picks which one, in order:
//   runner  the sandboxed frame that runs the agent's code (Tailwind in the page)
//   canvas  the trusted shell around it; embeds runner.html as a string
const view = process.env.VIEW ?? "canvas";

export default defineConfig({
  root: "view",
  build: { outDir: "../dist-view", emptyOutDir: false, rollupOptions: { input: `view/${view}.html` } },
  plugins: [react(), ...(view === "runner" ? [] : [tailwindcss()]), viteSingleFile()],
});
