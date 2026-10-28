import { Glyph } from "./Glyph";

// The Forkable mark, F6: a solid quarter circle with every corner rounded
// and a short diagonal hairline field underneath. Free-standing, it is
// monochrome per the brand rule: black on a white page, the accent green on
// a black one (`--accent-fg` carries that swap). No mascot, no per-product
// hue.
export function Logo({ className, size = 22 }: { className?: string; size?: number | string }) {
  return (
    <Glyph
      id="F6"
      className={`inline-block shrink-0 text-[var(--accent-fg)] ${className ?? ""}`}
      style={{ width: size, height: size }}
    />
  );
}
