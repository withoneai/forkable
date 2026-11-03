// The preview runs inside __BRAND_NAME__, which owns the dev server. When a coding
// agent started by __BRAND_NAME__ tries `pnpm dev`, stop it with a clear message.
if (process.env["__ENV_PREFIX__AGENT"] === "1") {
  console.error("The preview runs inside __BRAND_NAME__. Use project_add_dependency to add a package.");
  process.exit(1);
}
