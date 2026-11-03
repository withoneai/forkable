import markSvg from "../assets/brand/builder-mark-current.svg?raw";

// The Builder B from the Forkable brand kit, copied by scripts/sync-brand.mjs
// (never hand-edited). --mark-paint decides what fills it: the free-standing
// accent by default, three sharp bands under a palette that sets them. They
// run in the mark's own 100-unit grid, so it spans the whole letter.
const MARK = markSvg
  .replace(/width="\d+" height="\d+"/, 'width="100%" height="100%"')
  // The kit draws the mark in a padded 512 box; crop to the mark's own bounds.
  .replace('viewBox="0 0 512 512"', 'viewBox="124 124 264 264"')
  .replaceAll('fill="currentColor"', 'style="fill:var(--mark-paint)"')
  .replaceAll('stroke="currentColor"', 'style="stroke:var(--mark-paint)"')
  .replace(
    "<g ",
    '<defs><linearGradient id="mark-flag" gradientUnits="userSpaceOnUse" x1="0" y1="8" x2="0" y2="92"><stop offset="0.3333" style="stop-color:var(--flag-1)"/><stop offset="0.3333" style="stop-color:var(--flag-2)"/><stop offset="0.6667" style="stop-color:var(--flag-2)"/><stop offset="0.6667" style="stop-color:var(--flag-3)"/></linearGradient></defs><g ',
  );

export function Logo({ className, size = 22 }: { className?: string; size?: number | string }) {
  return (
    <span
      className={`inline-flex shrink-0 ${className ?? ""}`}
      style={{ width: size, height: size }}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: MARK }}
    />
  );
}
