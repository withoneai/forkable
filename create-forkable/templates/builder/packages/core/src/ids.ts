import { randomBytes, randomUUID } from "node:crypto";

/** Sortable, URL-safe id: time prefix + randomness ("t_0lq2x9a1b2c3d4"). */
export function newId(prefix = ""): string {
  const time = Date.now().toString(36).padStart(9, "0");
  const rand = randomBytes(6).toString("hex");
  return `${prefix}${prefix ? "_" : ""}${time}${rand}`;
}

export const uuid = (): string => randomUUID();

/** A random token (relay, turn). Only its sha256 is stored. */
export const newToken = (): string => randomBytes(24).toString("base64url");
