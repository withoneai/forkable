import { useEffect, useRef } from "react";

// The closing section's floor: a dot grid seen from just above, drawn on a
// canvas in real perspective so it is sharp at any width and pixel density.
// It drifts toward you, pauses when off screen, and holds still under
// reduced motion. Colors come from the theme tokens (--dot, --rim-glow).
export function DotFloor() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let visible = false;
    let w = 0;
    let h = 0;
    let dpr = 1;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    };
    const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

    const SPACING = 0.22; // world units between dots
    const CAM = 1; // camera height
    const draw = (t: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const horizon = h * 0.34;
      const f = h * 0.55; // focal length in px
      const cx = w / 2;
      const dot = css("--dot");
      const accent = css("--rim-glow");
      const clear = css("--rim-glow-clear");

      const R = Math.min(w * 0.32, 460);
      const gy = horizon + h * 0.02;
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
      g.addColorStop(0, accent);
      g.addColorStop(1, clear);
      ctx.save();
      ctx.translate(cx, gy);
      ctx.scale(1, 0.2);
      ctx.fillStyle = g;
      ctx.fillRect(-R, -R, 2 * R, 2 * R);
      ctx.restore();

      ctx.fillStyle = dot;
      const drift = reduced ? 0 : ((t / 1000) * 0.12) % SPACING;
      const zMax = 9;
      const xSpan = (w / 2 / f) * zMax + 2;
      for (let z = 0.5 + SPACING - drift; z < zMax; z += SPACING) {
        const y = horizon + (f * CAM) / z;
        if (y > h + 4) continue;
        const scale = f / z;
        const r = Math.max(0.4, Math.min(2, scale * 0.0045));
        const fade = Math.min(1, (zMax - z) / (zMax * 0.7)) * Math.min(1, (y - horizon) / (h * 0.12));
        ctx.globalAlpha = Math.max(0, fade);
        for (let x = -Math.ceil(xSpan); x <= Math.ceil(xSpan); x += SPACING) {
          const sx = cx + x * scale;
          if (sx < -4 || sx > w + 4) continue;
          ctx.beginPath();
          ctx.arc(sx, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    };
    const loop = (t: number) => {
      draw(t);
      if (visible && !reduced) raf = requestAnimationFrame(loop);
    };
    resize();
    draw(0);
    const ro = new ResizeObserver(() => {
      resize();
      draw(performance.now());
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      cancelAnimationFrame(raf);
      if (visible) raf = requestAnimationFrame(loop);
    });
    io.observe(canvas);
    const mo = new MutationObserver(() => draw(performance.now()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
    };
  }, []);
  return <canvas ref={ref} className="pointer-events-none absolute inset-x-0 bottom-0 h-[30rem] w-full" aria-hidden />;
}
