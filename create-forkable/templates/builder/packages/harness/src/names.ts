// Brand-derived names the harness needs. The harness cannot import
// @builder/core (core imports the harness), so these mirror BRAND in
// packages/core/src/brand.ts and are listed in docs/RENAME.md.

export const HARNESS_NAMES = {
  /** BRAND.slug: MCP server name, shim prefix. */
  slug: "builder",
  /** BRAND.envPrefix */
  envPrefix: "BUILDER_",
} as const;

/** "builder" -> MCP tool prefix "mcp__builder__". */
export const mcpPrefix = (name: string = HARNESS_NAMES.slug): string => `mcp__${name}__`;
