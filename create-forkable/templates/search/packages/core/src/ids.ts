import { randomUUID } from "node:crypto";

export type IdPrefix = "usr" | "src" | "prf" | "pfv" | "run" | "raw" | "itm" | "chk" | "ent" | "chat" | "msg" | "led" | "drf" | "imp" | "mat" | "q" | "sav" | "rec";

/** A random id with a prefix: newId("itm") -> "itm_5f3a…" (24 hex chars). */
export function newId(prefix: IdPrefix): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}
