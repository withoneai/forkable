// Images for a prompt (paste, drop, attach). In the editor they go straight
// to the project's ignored .builder/attachments. On Home no project exists
// yet, so they are staged in the home's state dir and the create call moves
// them into the new project before its first turn is submitted. A prompt
// saved for after setup (pendingPrompt) keeps its staged names in
// pendingImages, and the staged files stay until then (or a day passes).

import { existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { BRAND } from "./brand.js";
import type { Home } from "./home.js";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const IMAGE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
/** How long a staged image waits for its project. */
export const STAGED_TTL_MS = 24 * 60 * 60_000;

const NAME = /^[a-z0-9-]+\.(png|jpe?g|webp|gif)$/i;

/** A file name the platform made (never a path). */
export const isAttachmentName = (f: unknown): f is string => typeof f === "string" && NAME.test(f);

export const projectAttachmentsDir = (projectPath: string): string => join(projectPath, BRAND.projectDir, "attachments");
export const stagedDir = (home: Home): string => join(home.state, "staged-attachments");

export const contentTypeOf = (file: string): string => {
  const ext = file.split(".").pop()!.toLowerCase();
  return ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
};

export type SaveResult = { ok: true; file: string } | { ok: false; status: 413 | 415; code: "too_big" | "not_image"; message: string };

/** Same limits as the composer: PNG, JPEG, WebP or GIF, 8 MB. */
export function saveAttachment(dir: string, contentType: string, buf: Buffer): SaveResult {
  const ext = IMAGE_TYPES[contentType.split(";")[0]!.trim().toLowerCase()];
  if (!ext) return { ok: false, status: 415, code: "not_image", message: "Attach a PNG, JPEG, WebP or GIF." };
  if (buf.length > MAX_IMAGE_BYTES) return { ok: false, status: 413, code: "too_big", message: "Images up to 8 MB." };
  mkdirSync(dir, { recursive: true });
  const file = `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
  writeFileSync(join(dir, file), buf);
  return { ok: true, file };
}

/** The staged names that still exist, in order, without repeats. */
export function stagedExisting(home: Home, names: unknown): string[] {
  if (!Array.isArray(names)) return [];
  const dir = stagedDir(home);
  return [...new Set(names.filter(isAttachmentName))].filter((f) => existsSync(join(dir, f)));
}

/**
 * Move staged images into a new project's attachments; returns their
 * absolute paths for the first turn. Names that are not staged are skipped.
 */
export function adoptStaged(home: Home, projectPath: string, names: unknown): string[] {
  const from = stagedDir(home);
  const to = projectAttachmentsDir(projectPath);
  const out: string[] = [];
  for (const f of stagedExisting(home, names).slice(0, 6)) {
    mkdirSync(to, { recursive: true });
    const dest = join(to, f);
    try {
      try {
        renameSync(join(from, f), dest);
      } catch {
        copyFileSync(join(from, f), dest);
        unlinkSync(join(from, f));
      }
      out.push(dest);
    } catch {
      /* gone meanwhile */
    }
  }
  return out;
}

/** Remove staged images older than the TTL, except the ones a pending prompt still holds. */
export function sweepStaged(home: Home, keep: string[] = [], now = Date.now(), ttl = STAGED_TTL_MS): number {
  const dir = stagedDir(home);
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const f of readdirSync(dir)) {
    if (keep.includes(f)) continue;
    try {
      if (now - statSync(join(dir, f)).mtimeMs > ttl) {
        unlinkSync(join(dir, f));
        n++;
      }
    } catch {
      /* gone */
    }
  }
  return n;
}
