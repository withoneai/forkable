import markSvg from "@/assets/brand/builder-mark-current.svg?raw";
import { cn } from "@/lib/utils";

// The Builder B from the Forkable brand kit, copied by scripts/sync-brand.mjs
// (never hand-edited). It takes currentColor; cropped to the mark's own bounds.
const MARK = markSvg
  .replace(/width="\d+" height="\d+"/, 'width="100%" height="100%"')
  .replace('viewBox="0 0 512 512"', 'viewBox="124 124 264 264"');

export function Logo({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 text-foreground", className)}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: MARK }}
    />
  );
}
