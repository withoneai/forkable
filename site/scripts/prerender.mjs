// Writes the real markup into dist/index.html and dist/contribute/index.html,
// so a plain fetch (an agent, a crawler, curl) gets the copy, the template
// cards and the commands instead of an empty <div id="root">. Runs after
// `vite build` and `vite build --ssr src/entry-server.tsx`; the client then
// hydrates the same tree.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const site = fileURLToPath(new URL("..", import.meta.url));
const { render } = await import(pathToFileURL(`${site}dist-ssr/entry-server.js`).href);

const pages = [
  { file: "dist/index.html", page: "home" },
  { file: "dist/contribute/index.html", page: "contribute" },
  { file: "dist/mcp/index.html", page: "mcp" },
];

for (const { file, page } of pages) {
  const path = site + file;
  const html = readFileSync(path, "utf8");
  const empty = '<div id="root"></div>';
  if (!html.includes(empty)) throw new Error(`${file}: no empty #root to fill (already prerendered?)`);
  const body = render(page);
  writeFileSync(path, html.replace(empty, `<div id="root">${body}</div>`));
  console.log(`prerendered ${file} (${(body.length / 1024).toFixed(1)} kB of markup)`);
}

rmSync(`${site}dist-ssr`, { recursive: true, force: true });
