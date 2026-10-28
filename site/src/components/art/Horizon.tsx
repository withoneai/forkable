// The hero's horizon. See `.horizon` in index.css.
export function Horizon() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0" aria-hidden>
      <div className="horizon-halo" />
      <div className="horizon" />
    </div>
  );
}
