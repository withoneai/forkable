// The platform count in the "add any other tool" copy is never typed by
// hand: it is fetched from One's public count endpoint at build time and
// written to src/generated/platform-count.json. Offline, the last fetched
// value stays.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const file = fileURLToPath(new URL("../src/generated/platform-count.json", import.meta.url));
try {
  const res = await fetch("https://api.withone.ai/open/count/platforms", { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { message } = await res.json();
  if (!/^[\d,]+$/.test(message)) throw new Error(`unexpected count ${message}`);
  writeFileSync(file, `${JSON.stringify({ platforms: message, fetchedAt: new Date().toISOString() }, null, 2)}\n`);
  console.log(`platform count ${message}`);
} catch (e) {
  const last = JSON.parse(readFileSync(file, "utf8"));
  console.warn(`platform count fetch failed (${e.message}); keeping ${last.platforms} from ${last.fetchedAt}`);
}
