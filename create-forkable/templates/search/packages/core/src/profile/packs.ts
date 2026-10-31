// Load and check profile packs from disk (no database). Built-ins live in
// <repo>/profiles/<platform>/pack.json.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { SearchProfilePack } from "../contract.js";
import { packSchema, zodIssues } from "./schema.js";
import type { z } from "zod";

export class PackError extends Error {
  constructor(public file: string, public issues: string[]) {
    super(`${file}: ${issues.slice(0, 5).join("; ")}${issues.length > 5 ? ` (+${issues.length - 5} more)` : ""}`);
  }
}

export function parsePack(json: unknown, file = "(pack)"): SearchProfilePack {
  const r = packSchema.safeParse(json);
  if (!r.success) throw new PackError(file, zodIssues(r.error as z.ZodError));
  for (const p of r.data.profiles) {
    if (p.platform !== r.data.platform) throw new PackError(file, [`profile ${p.id}: platform ${p.platform} differs from pack platform ${r.data.platform}`]);
    if (!p.id.startsWith(`${p.platform}.`)) throw new PackError(file, [`profile ${p.id}: id must start with "${p.platform}."`]);
  }
  return r.data;
}

/** Every `<root>/<dir>/pack.json` (skips `schema/`). Throws PackError on the first invalid pack. */
export function loadBuiltinPacks(root: string): SearchProfilePack[] {
  if (!existsSync(root)) return [];
  const out: SearchProfilePack[] = [];
  for (const dir of readdirSync(root).sort()) {
    const file = join(root, dir, "pack.json");
    if (dir === "schema" || !statSync(join(root, dir)).isDirectory() || !existsSync(file)) continue;
    out.push(parsePack(JSON.parse(readFileSync(file, "utf8")), file));
  }
  return out;
}
