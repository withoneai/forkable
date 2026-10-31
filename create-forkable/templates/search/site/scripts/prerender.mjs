// Writes the real markup into dist/index.html, so a plain fetch (an agent,
// a crawler, curl) gets the copy and the search demo's first frame instead
// of an empty <div id="root">. Runs after `vite build` and `vite build
// --ssr src/entry-server.tsx`; the client then hydrates the same tree.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const site = fileURLToPath(new URL("..", import.meta.url));
const { render } = await import(pathToFileURL(`${site}dist-ssr/entry-server.js`).href);

const file = `${site}dist/index.html`;
const html = readFileSync(file, "utf8");
const empty = '<div id="root"></div>';
if (!html.includes(empty)) throw new Error("dist/index.html: no empty #root to fill (already prerendered?)");
const body = render();
writeFileSync(file, html.replace(empty, `<div id="root">${body}</div>`));
console.log(`prerendered dist/index.html (${(body.length / 1024).toFixed(1)} kB of markup)`);

rmSync(`${site}dist-ssr`, { recursive: true, force: true });
