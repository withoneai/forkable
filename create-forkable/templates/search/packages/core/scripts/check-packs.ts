// Loads every built-in pack and runs static validation. Exit 1 on any error.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBuiltinPacks } from "../src/profile/packs.js";
import { validateProfile } from "../src/profile/validate.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../profiles");
let bad = 0;
for (const pack of loadBuiltinPacks(root)) {
  for (const p of pack.profiles) {
    const r = validateProfile(p);
    const errs = r.issues.filter((i) => i.level !== "ok");
    console.log(`${r.ok ? "ok  " : "FAIL"} ${p.id}${errs.length ? "\n     " + errs.map((e) => `${e.level}: ${e.message}`).join("\n     ") : ""}`);
    if (!r.ok) bad++;
  }
}
process.exit(bad ? 1 : 0);
