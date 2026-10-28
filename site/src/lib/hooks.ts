import { useEffect, useRef, useState, useSyncExternalStore } from "react";

export function useReveal<T extends HTMLElement>(threshold = 0.2) {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold, rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, shown] as const;
}

export type Theme = "light" | "dark";

// The theme lives on <html class="dark">, set before first paint by the
// inline script in index.html. The page is prerendered with no theme known,
// so the server snapshot is "dark" (the default) and React swaps in the real
// one right after hydration, without a mismatch warning.
function subscribeTheme(onChange: () => void) {
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => mo.disconnect();
}
const readTheme = (): Theme => (document.documentElement.classList.contains("dark") ? "dark" : "light");
const serverTheme = (): Theme => "dark";

export function useTheme() {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, serverTheme);
  const toggle = () => {
    const next = readTheme() === "dark" ? "light" : "dark";
    localStorage.setItem("forkable-site-theme", next);
    document.documentElement.classList.toggle("dark", next === "dark");
  };
  return [theme, toggle] as const;
}

// Writes --p and --c on the element as it scrolls through the viewport, so
// CSS can move layers without a React render per frame. --p runs 0 to 1 as
// the element's top travels from the bottom of the viewport to `settleAt`
// (a fraction of the viewport height); --c is the element's centre relative
// to the viewport centre, -1 to 1.
export function useScrollVars<T extends HTMLElement>(settleAt = 0.25) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.style.setProperty("--p", "1");
      el.style.setProperty("--c", "0");
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const span = vh * (1 - settleAt);
      const p = Math.min(1, Math.max(0, (vh - r.top) / span));
      const c = Math.min(1, Math.max(-1, (vh / 2 - (r.top + r.height / 2)) / vh));
      el.style.setProperty("--p", p.toFixed(4));
      el.style.setProperty("--c", c.toFixed(4));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [settleAt]);
  return ref;
}
