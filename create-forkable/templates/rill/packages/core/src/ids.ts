import { randomUUID } from "node:crypto";

/** A random id, optionally prefixed: newId("draft") -> "draft_5f3a…". */
export function newId(prefix?: string): string {
  const id = randomUUID().replace(/-/g, "");
  return prefix ? `${prefix}_${id}` : id;
}
