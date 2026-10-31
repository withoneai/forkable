import { cn } from "@/lib/utils";
import markSvg from "@/assets/brand/search-mark-current.svg?raw";

// The Search mark from the Forkable brand kit (copied by scripts/sync-brand.mjs,
// never hand-edited). The kit SVG takes currentColor. Free-standing it is black
// on light and lime on dark; on the tile it is black on lime.
const FULL = markSvg.replace(/width="\d+" height="\d+"/, 'width="100%" height="100%"');
// The mark sits in a padded 512 box; crop to its own bounds when it stands alone.
const TIGHT = FULL.replace('viewBox="0 0 512 512"', 'viewBox="132 132 248 248"');

export function Logo({ size = 18, className, tile = true }: { size?: number; className?: string; tile?: boolean }) {
  if (!tile) {
    return (
      <span
        aria-hidden
        className={cn("inline-flex shrink-0 text-black dark:text-primary", className)}
        style={{ width: size, height: size }}
        dangerouslySetInnerHTML={{ __html: TIGHT }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn("squircle inline-flex shrink-0 select-none bg-primary p-px text-primary-foreground", className)}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: FULL }}
    />
  );
}
