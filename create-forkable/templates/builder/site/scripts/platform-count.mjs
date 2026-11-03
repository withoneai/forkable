// The app and action counts in the copy are never typed by hand: they are
// fetched from One's public count endpoints at build time and written to
// src/generated/platform-count.json. Offline, the last fetched values stay.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const file = fileURLToPath(new URL("../src/generated/platform-count.json", import.meta.url));
async function count(kind) {
  const res = await fetch(`https://api.withone.ai/open/count/${kind}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`${kind}: HTTP ${res.status}`);
  const { message } = await res.json();
  if (!/^[\d,]+$/.test(message)) throw new Error(`${kind}: unexpected count ${message}`);
  return message;
}
try {
  const [platforms, tools] = await Promise.all([count("platforms"), count("tools")]);
  writeFileSync(file, `${JSON.stringify({ platforms, tools, fetchedAt: new Date().toISOString() }, null, 2)}\n`);
  console.log(`counts: ${platforms} platforms, ${tools} actions`);
} catch (e) {
  const last = JSON.parse(readFileSync(file, "utf8"));
  console.warn(`count fetch failed (${e.message}); keeping ${last.platforms} / ${last.tools} from ${last.fetchedAt}`);
}
