import { useLayoutEffect, useState, type RefObject } from "react";

const EDGE = 8;

/**
 * Keeps a floating element (menu, tooltip, popover) inside the window.
 * Returns a horizontal nudge in px and whether to flip to the other side.
 * The nudge is a margin, so it composes with any transform or translate class
 * already centering the element. Measured with the nudge removed so it never drifts.
 */
export function useKeepInView(ref: RefObject<HTMLElement | null>, open: boolean, side: "top" | "bottom" = "bottom", deps: unknown[] = []) {
  const [shift, setShift] = useState(0);
  const [flip, setFlip] = useState(false);
  useLayoutEffect(() => {
    if (!open) { setShift(0); setFlip(false); return; }
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const prev = el.style.marginLeft;
      el.style.marginLeft = "0px";
      const r = el.getBoundingClientRect();
      el.style.marginLeft = prev;
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      setShift(r.right > vw - EDGE ? Math.max(EDGE - r.left, vw - EDGE - r.right) : r.left < EDGE ? EDGE - r.left : 0);
      setFlip((f) => f || (side === "bottom" ? r.bottom > vh - EDGE && r.top - r.height > EDGE : r.top < EDGE));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, side, ...deps]);
  return { shift, flip, style: { marginLeft: shift } as const };
}
