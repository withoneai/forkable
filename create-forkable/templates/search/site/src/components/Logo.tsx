import markSvg from "../assets/brand/search-mark-current.svg?raw";

// The Search mark from the Forkable brand kit, copied by scripts/sync-brand.mjs
// (never hand-edited). It takes currentColor, so it follows the site's
// free-standing mark color in each theme.
const MARK = markSvg
  .replace(/width="\d+" height="\d+"/, 'width="100%" height="100%"')
  // The kit draws the mark in a padded 512 box; crop to the mark's own bounds.
  .replace('viewBox="0 0 512 512"', 'viewBox="132 132 248 248"');

export function Logo({ className, size = 22 }: { className?: string; size?: number | string }) {
  return (
    <span
      className={`inline-flex shrink-0 text-[var(--accent-fg)] ${className ?? ""}`}
      style={{ width: size, height: size }}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: MARK }}
    />
  );
}
