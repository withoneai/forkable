// Dev probe: index the sample into a scratch schema and run a SQL query. Not part of the product.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { bootDatabase } from "../src/db/boot.js";
import { dropSchema } from "../src/db/client.js";
import { runDemo, DEMO_USER } from "../src/sample/demo.js";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const b = await bootDatabase({ home: "/tmp/search-demo-home", pgPort: 55493, schema: "probe" });
await dropSchema(b.db, "probe");
await b.stop();
const c = await bootDatabase({ home: "/tmp/search-demo-home", pgPort: 55493, schema: "probe" });
await runDemo({ db: c.db, capability: c.capability, root, database: { kind: "embedded", version: "", port: 0 } }, () => {});
for (const q of process.argv.slice(2)) console.log(JSON.stringify((await c.db.execute(sql.raw(q.replaceAll("$U", `'${DEMO_USER}'`)))).rows, null, 0));
await dropSchema(c.db, "probe");
await c.stop();
