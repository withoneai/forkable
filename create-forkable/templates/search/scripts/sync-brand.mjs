// Copies the Search brand kit from the Forkable brand system into the app and
// the landing page. The kit is generated in the Forkable repo (design/system).
// Point SEARCH_BRAND_KIT at its design/brand/search folder (default: a checkout
// at ~/projects/forkable). Never hand-edit the copies, re-run this instead:
// node scripts/sync-brand.mjs
import { cpSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const kit = process.env.SEARCH_BRAND_KIT ?? join(homedir(), "projects/forkable/design/brand/search");
if (!existsSync(kit)) throw new Error(`Brand kit not found at ${kit}`);
const root = new URL("..", import.meta.url).pathname;

for (const app of ["ui", "site"]) {
  const pub = join(root, app, "public");
  const assets = join(root, app, "src/assets/brand");
  mkdirSync(assets, { recursive: true });
  for (const f of ["search-mark-current.svg", "search-mark-on-dark.svg", "search-mark-on-light.svg"])
    copyFileSync(join(kit, "marks", f), join(assets, f));
  copyFileSync(join(kit, "lockups/search-lockup-horizontal-current.svg"), join(assets, "search-lockup-horizontal-current.svg"));
  copyFileSync(join(kit, "favicon.svg"), join(pub, "favicon.svg"));
  copyFileSync(join(kit, "favicon.ico"), join(pub, "favicon.ico"));
  copyFileSync(join(kit, "apple-touch-icon.png"), join(pub, "apple-touch-icon.png"));
  cpSync(join(kit, "icon"), join(pub, "brand/icon"), { recursive: true });
}
// The landing page links these sizes from index.html and its manifest.
const sitePub = join(root, "site/public");
for (const s of [16, 32, 512]) copyFileSync(join(kit, `icon/search-icon-on-dark-${s}.png`), join(sitePub, `icon-${s}.png`));
copyFileSync(join(kit, "og.png"), join(sitePub, "og.png"));
// 48 and 192 aren't in the kit; scale them from the 512 (sips ships with macOS).
for (const s of [48, 192])
  execFileSync("sips", ["-z", String(s), String(s), join(kit, "icon/search-icon-on-dark-512.png"), "--out", join(sitePub, `icon-${s}.png`)], { stdio: "ignore" });
console.log(`Synced the Search brand kit from ${kit}`);
