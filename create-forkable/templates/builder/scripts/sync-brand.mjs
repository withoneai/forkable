// Copies the Builder brand kit from the Forkable brand system into the app and
// the landing page. The kit is generated in the Forkable repo (design/system).
// Point BUILDER_BRAND_KIT at its design/brand/builder folder (default: a
// checkout at ~/projects/forkable). Never hand-edit the copies, re-run this:
// node scripts/sync-brand.mjs
import { cpSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const kit = process.env.BUILDER_BRAND_KIT ?? join(homedir(), "projects/forkable/design/brand/builder");
if (!existsSync(kit)) throw new Error(`Brand kit not found at ${kit}`);
const root = new URL("..", import.meta.url).pathname;

for (const app of ["ui", "site"]) {
  const pub = join(root, app, "public");
  const assets = join(root, app, "src/assets/brand");
  mkdirSync(assets, { recursive: true });
  for (const f of ["builder-mark-current.svg", "builder-mark-on-dark.svg", "builder-mark-on-light.svg"])
    copyFileSync(join(kit, "marks", f), join(assets, f));
  copyFileSync(join(kit, "lockups/builder-lockup-horizontal-current.svg"), join(assets, "builder-lockup-horizontal-current.svg"));
  copyFileSync(join(kit, "favicon.svg"), join(pub, "favicon.svg"));
  copyFileSync(join(kit, "favicon.ico"), join(pub, "favicon.ico"));
  copyFileSync(join(kit, "apple-touch-icon.png"), join(pub, "apple-touch-icon.png"));
}
// The landing page links these sizes from index.html and its manifest.
const sitePub = join(root, "site/public");
cpSync(join(kit, "icon"), join(sitePub, "brand/icon"), { recursive: true });
for (const s of [16, 32, 512]) copyFileSync(join(kit, `icon/builder-icon-on-dark-${s}.png`), join(sitePub, `icon-${s}.png`));
for (const s of [48, 192])
  execFileSync("sips", ["-z", String(s), String(s), join(kit, "icon/builder-icon-on-dark-512.png"), "--out", join(sitePub, `icon-${s}.png`)], { stdio: "ignore" });
// The kit's card sits on the deep brand green; the site is near black, so the
// share card is the kit's og.svg on the site's dark tokens.
const og = readFileSync(join(kit, "og.svg"), "utf8").replace('fill="#172e25"', 'fill="#000000"').replace('fill="#627b6f"', 'fill="#779084"');
if (!og.includes('fill="#000000"')) throw new Error("og.svg background not found; check the kit");
const ogSvg = join(tmpdir(), "builder-og.svg");
writeFileSync(ogSvg, og);
execFileSync("rsvg-convert", ["-w", "1200", "-h", "630", ogSvg, "-o", join(sitePub, "og.png")]);
console.log(`Synced the Builder brand kit from ${kit}`);
