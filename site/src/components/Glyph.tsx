import type { CSSProperties } from "react";

// The family's marks: F6 (Forkable), R (Rill), B (Brief) and S (Search),
// every corner rounded. Paths lifted straight from design/system/letters.ts
// (F6_ROUNDED, LETTER_R_ROUNDED, LETTER_B_ROUNDED, LETTER_S_ROUNDED) via the
// approved exports (S from design/brand/search/marks/search-mark-current.svg), so
// this is the same geometry Moe signed off on, not a redraw. Single
// `currentColor` fill/stroke: color comes from the CSS class around it.
export type GlyphId = "F6" | "R" | "B" | "S";

const PATHS: Record<GlyphId, string> = {
  F6: `<path d="M10 8L64 8Q66 8 65.96552065808481 9.99960367001639A58 58 0 0 1 9.999603670016384 65.96552065808481Q8.000000000000004 66 8.000000000000004 64L8 10Q8 8 10 8Z" fill="currentColor"/><line x1="8" y1="77.62" x2="17.62" y2="68" stroke="currentColor" stroke-width="1.725" stroke-linecap="round"/><line x1="10.81" y1="84" x2="26.81" y2="68" stroke="currentColor" stroke-width="1.725" stroke-linecap="round"/><line x1="20" y1="84" x2="36" y2="68" stroke="currentColor" stroke-width="1.725" stroke-linecap="round"/><line x1="29.19" y1="84" x2="45.19" y2="68" stroke="currentColor" stroke-width="1.725" stroke-linecap="round"/><line x1="38.38" y1="84" x2="48" y2="74.38" stroke="currentColor" stroke-width="1.725" stroke-linecap="round"/>`,
  R: `<path d="M8 10Q8 8 10 8L26 8Q28 8 28 10L28 90Q28 92 26 92L10 92Q8 92 8 90Z" fill="currentColor"/><path d="M27.999999999999996 8A22 22 0 1 1 28 52L28 30Z" fill="currentColor"/><path d="M28 6A24 24 0 0 1 28 54" fill="none" stroke="currentColor" stroke-width="1.725" stroke-linecap="round"/><path d="M28 1A29 29 0 0 1 28 59" fill="none" stroke="currentColor" stroke-width="1.725" stroke-linecap="round"/><path d="M28 -4A34 34 0 0 1 28 64" fill="none" stroke="currentColor" stroke-width="1.725" stroke-linecap="round"/><path d="M28.21982659219661 64.16024481101655L76.21982659219661 98.16024481101655A10 10 0 0 0 87.78017340780339 81.83975518898345L39.78017340780339 47.839755188983446A10 10 0 0 0 28.21982659219661 64.16024481101655Z" fill="currentColor"/>`,
  B: `<path d="M8 10Q8 8 10 8L26 8Q28 8 28 10L28 90Q28 92 26 92L10 92Q8 92 8 90Z" fill="currentColor"/><path d="M34 8A6 6 0 0 1 28 14" fill="none" stroke="currentColor" stroke-width="1.725" stroke-linecap="round"/><path d="M40 8A12 12 0 0 1 28 20" fill="none" stroke="currentColor" stroke-width="1.725" stroke-linecap="round"/><path d="M46 8A18 18 0 0 1 28 26" fill="none" stroke="currentColor" stroke-width="1.725" stroke-linecap="round"/><path d="M52 8A24 24 0 0 1 28 32" fill="none" stroke="currentColor" stroke-width="1.725" stroke-linecap="round"/><path d="M58 8A30 30 0 0 1 28 38" fill="none" stroke="currentColor" stroke-width="1.725" stroke-linecap="round"/><path d="M64 8A36 36 0 0 1 28 44" fill="none" stroke="currentColor" stroke-width="1.725" stroke-linecap="round"/><path d="M34 50A6 6 0 0 1 28 56" fill="none" stroke="currentColor" stroke-width="1.725" stroke-linecap="round"/><path d="M40 50A12 12 0 0 1 28 62" fill="none" stroke="currentColor" stroke-width="1.725" stroke-linecap="round"/><path d="M46 50A18 18 0 0 1 28 68" fill="none" stroke="currentColor" stroke-width="1.725" stroke-linecap="round"/><path d="M52 50A24 24 0 0 1 28 74" fill="none" stroke="currentColor" stroke-width="1.725" stroke-linecap="round"/><path d="M58 50A30 30 0 0 1 28 80" fill="none" stroke="currentColor" stroke-width="1.725" stroke-linecap="round"/><path d="M64 50A36 36 0 0 1 28 86" fill="none" stroke="currentColor" stroke-width="1.725" stroke-linecap="round"/>`,
  S: `<path d="M40 10Q40 8 42 8L58 8Q60 8 60 10L60 90Q60 92 58 92L42 92Q40 92 40 90Z" fill="currentColor"/><path d="M60 34A6 6 0 0 1 66 40" fill="none" stroke="currentColor" stroke-width="1.725" stroke-linecap="round"/><path d="M60 28A12 12 0 0 1 72 40" fill="none" stroke="currentColor" stroke-width="1.725" stroke-linecap="round"/><path d="M60 22A18 18 0 0 1 78 40" fill="none" stroke="currentColor" stroke-width="1.725" stroke-linecap="round"/><path d="M60 16A24 24 0 0 1 84 40" fill="none" stroke="currentColor" stroke-width="1.725" stroke-linecap="round"/><path d="M60 10A30 30 0 0 1 90 40" fill="none" stroke="currentColor" stroke-width="1.725" stroke-linecap="round"/><path d="M40 66A6 6 0 0 1 34 60" fill="none" stroke="currentColor" stroke-width="1.725" stroke-linecap="round"/><path d="M40 72A12 12 0 0 1 28 60" fill="none" stroke="currentColor" stroke-width="1.725" stroke-linecap="round"/><path d="M40 78A18 18 0 0 1 22 60" fill="none" stroke="currentColor" stroke-width="1.725" stroke-linecap="round"/><path d="M40 84A24 24 0 0 1 16 60" fill="none" stroke="currentColor" stroke-width="1.725" stroke-linecap="round"/><path d="M40 90A30 30 0 0 1 10 60" fill="none" stroke="currentColor" stroke-width="1.725" stroke-linecap="round"/>`,
};

export function Glyph({
  id,
  className,
  style,
}: {
  id: GlyphId;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      style={style}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: PATHS[id] }}
    />
  );
}
