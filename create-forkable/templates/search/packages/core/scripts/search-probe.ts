// Dev probe: index the sample, then print ranks for queries. Not part of the product.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bootDatabase } from "../src/db/boot.js";
import { dropSchema } from "../src/db/client.js";
import { runDemo, DEMO_USER } from "../src/sample/demo.js";
import { hybridSearch } from "../src/search/hybrid.js";
import { SAMPLE_SETTINGS } from "../src/settings.js";
import { vipIdsForKeys } from "../src/classify/jev.js";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const c = await bootDatabase({ home: "/tmp/search-demo-home", pgPort: 55493, schema: "probe2" });
await dropSchema(c.db, "probe2"); await c.stop();
const b = await bootDatabase({ home: "/tmp/search-demo-home", pgPort: 55493, schema: "probe2" });
await runDemo({ db: b.db, capability: b.capability, root, database: { kind: "embedded", version: "", port: 0 } }, () => {});
const ctx = { db: b.db, oneConnect: null, capability: b.capability, transport: null, settingsFor: async () => SAMPLE_SETTINGS, emit() {}, log() {}, now: () => new Date() };
void vipIdsForKeys;
for (const q of process.argv.slice(2)) {
  const r = await hybridSearch(ctx as never, DEMO_USER, { q, limit: 8 });
  console.log(q, r.total);
  for (const x of r.results) console.log(" ", x.score.toFixed(5), JSON.stringify(x.ranks), x.importance, x.platform, x.title.slice(0, 50));
}
await dropSchema(b.db, "probe2"); await b.stop();
