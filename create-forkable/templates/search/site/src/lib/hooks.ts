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
// so the server snapshot is "dark" (the default) and React swaps in the
// real one right after hydration, without a mismatch warning.
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
    localStorage.setItem("search-site-theme", next);
    document.documentElement.classList.toggle("dark", next === "dark");
  };
  return [theme, toggle] as const;
}

type Phase = "typing" | "holding" | "deleting";

// Types out `full`, holds, then deletes back to empty and moves to the next
// string. Used by the hero search demo to cycle through sample queries.
export function useTypewriter(strings: string[], opts: { typeMs?: number; holdMs?: number; deleteMs?: number } = {}) {
  const { typeMs = 38, holdMs = 2200, deleteMs = 22 } = opts;
  const [text, setText] = useState("");
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("typing");
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setText(strings[0] ?? "");
      return;
    }
    const full = strings[index % strings.length] ?? "";
    let timer: ReturnType<typeof setTimeout>;
    if (phase === "typing") {
      if (text.length < full.length) {
        timer = setTimeout(() => setText(full.slice(0, text.length + 1)), typeMs);
      } else {
        timer = setTimeout(() => setPhase("holding"), holdMs);
      }
    } else if (phase === "holding") {
      timer = setTimeout(() => setPhase("deleting"), 10);
    } else {
      if (text.length > 0) {
        timer = setTimeout(() => setText(text.slice(0, -1)), deleteMs);
      } else {
        setIndex((i) => (i + 1) % strings.length);
        setPhase("typing");
      }
    }
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, phase, index, strings, typeMs, holdMs, deleteMs]);
  return text;
}
