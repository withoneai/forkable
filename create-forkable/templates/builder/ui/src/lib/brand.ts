// Mirror of packages/core/src/brand.ts for the browser bundle. The ui imports
// only types from core, so the two values it needs are repeated here. Listed
// in docs/RENAME.md; keep in sync with BRAND.
export const BRAND_NAME = "Builder";
export const BRAND_SLUG = "builder";

/** postMessage source tags (docs/CONTRACT.md section 6). */
export const PREVIEW_SOURCE = `${BRAND_SLUG}-preview`;
export const EDITOR_SOURCE = `${BRAND_SLUG}-editor`;
