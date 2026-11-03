import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Bundles server/src/preview/client/ into the script the preview proxy serves
// at /__<slug>/client.js. The brand slug and the editor origins are baked in.

const here = dirname(fileURLToPath(import.meta.url));

export interface PreviewClientOptions {
  /** BRAND.slug */
  slug: string;
  /** Origins the client posts to and accepts messages from, e.g. http://127.0.0.1:51989. */
  editorOrigins: string[];
  minify?: boolean;
}

export async function buildPreviewClient(opts: PreviewClientOptions): Promise<string> {
  const result = await build({
    entryPoints: [join(here, "client", "index.ts")],
    bundle: true,
    write: false,
    format: "iife",
    target: "es2020",
    platform: "browser",
    minify: opts.minify ?? true,
    legalComments: "none",
    define: {
      __PREVIEW_SLUG__: JSON.stringify(opts.slug),
      __PREVIEW_EDITOR_ORIGINS__: JSON.stringify(opts.editorOrigins),
    },
    logLevel: "silent",
  });
  const out = result.outputFiles[0];
  if (!out) throw new Error("The preview client did not build");
  return out.text;
}
