import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/harness");
export const lines = (rel: string): string[] => readFileSync(path.join(FIXTURES, rel), "utf8").split("\n").filter(Boolean);
export const text = (rel: string): string => readFileSync(path.join(FIXTURES, rel), "utf8");
