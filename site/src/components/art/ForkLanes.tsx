import { useId } from "react";

// One lane enters from the left, forks at the centre into three lanes that
// diverge outward and leave at different heights: the Forkable mark's
// glyph stretched to the page width. Smooth cubic bends, not the mark's
// concentric arcs, since here the three paths end at different heights
// rather than staying parallel. Straight runs reach 3000 units each way
// from the centre, so they meet both edges of any screen; the inner svg
// sits at x=50% and never scales.
const SPREAD = 46; // half the vertical spread of the outer branches
const BEND = 900; // how far the fork takes to finish diverging
const f = (n: number) => n.toFixed(2);

function branch(y: number) {
  if (y === 0) return "M -3000 0 L 3000 0";
  return [`M -3000 0`, `L 0 0`, `C ${f(BEND * 0.35)} 0, ${f(BEND * 0.75)} ${f(y)}, ${f(BEND)} ${f(y)}`, `L 3000 ${f(y)}`].join(" ");
}
const LANES = [-SPREAD, 0, SPREAD].map(branch);

export function ForkLanes({ className }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className={className} width="100%" height="100%" overflow="visible" aria-hidden>
      <defs>
        <filter id={`g${id}`} x="-3200" y="-200" width="6400" height="400" filterUnits="userSpaceOnUse">
          <feGaussianBlur stdDeviation="7" />
        </filter>
        <linearGradient id={`f${id}`} x1="-1600" x2="1600" y1="0" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="white" stopOpacity="0" />
          <stop offset="0.25" stopColor="white" stopOpacity="1" />
          <stop offset="0.75" stopColor="white" stopOpacity="1" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <mask id={`m${id}`} maskUnits="userSpaceOnUse" x="-3200" y="-200" width="6400" height="400">
          <rect x="-3200" y="-200" width="6400" height="400" fill={`url(#f${id})`} />
        </mask>
      </defs>
      <svg x="50%" y="50%" overflow="visible">
        <g mask={`url(#m${id})`} fill="none" strokeLinecap="round">
          <g filter={`url(#g${id})`} opacity="0.9">
            {LANES.map((d, i) => (
              <path key={d} d={d} stroke={i === 1 ? "var(--lane-accent)" : "var(--lane-glow)"} strokeWidth={i === 1 ? 10 : 12} opacity={i === 1 ? 0.55 : 1} />
            ))}
          </g>
          {LANES.map((d, i) => (
            <path key={d} d={d} stroke={i === 1 ? "var(--lane-accent)" : "var(--lane)"} strokeWidth="2.5" />
          ))}
          {LANES.map((d, i) => (
            <path
              key={d}
              d={d}
              pathLength={1000}
              className="lane-pulse"
              stroke={i === 1 ? "var(--lane-accent)" : "var(--lane)"}
              strokeWidth="4"
              style={{ animationDelay: `${-i * 2.3}s` }}
            />
          ))}
        </g>
      </svg>
    </svg>
  );
}
