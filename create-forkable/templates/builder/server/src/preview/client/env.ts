// Values injected at build time by clientBuild.ts (esbuild define).
declare const __PREVIEW_SLUG__: string;
declare const __PREVIEW_EDITOR_ORIGINS__: string[];

export const SLUG: string = __PREVIEW_SLUG__;
export const EDITOR_ORIGINS: string[] = __PREVIEW_EDITOR_ORIGINS__;
export const LOC_ATTR = `data-${SLUG}-loc`;
export const ROUTE = `/__${SLUG}`;
export const SOURCE_PREVIEW = `${SLUG}-preview`;
export const SOURCE_EDITOR = `${SLUG}-editor`;
