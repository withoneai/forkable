// Writes <repo>/profiles/schema/profile-1.json from the zod schema. Never hand-edit the output.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { profileJsonSchema } from "../src/profile/schema.js";

const out = resolve(dirname(fileURLToPath(import.meta.url)), "../../../profiles/schema/profile-1.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(profileJsonSchema(), null, 2) + "\n");
console.log(`wrote ${out}`);
