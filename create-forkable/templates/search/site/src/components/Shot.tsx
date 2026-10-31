import clsx from "clsx";
import { useReveal } from "../lib/hooks";

const light = import.meta.glob<string>("../assets/shots/light/*.png", { eager: true, import: "default" });
const dark = import.meta.glob<string>("../assets/shots/dark/*.png", { eager: true, import: "default" });

export type ShotName = "dock-answer" | "new-profile-check" | "integrations";

// Intrinsic sizes, so the page reserves the right space before each loads.
const SIZE: Record<ShotName, [number, number]> = {
  "dock-answer": [1280, 820],
  integrations: [1280, 820],
  "new-profile-check": [1280, 800],
};

// A real app screenshot of the Acme sample (search/docs/qa/phase2-ui, and
// docs/qa/assistant for the New profile Check step), in
// a light and a dark copy that follow the page theme.
export function Shot({ name, alt, className }: { name: ShotName; alt: string; className?: string }) {
  const [ref, shown] = useReveal<HTMLDivElement>(0.15);
  const src = {
    light: light[`../assets/shots/light/${name}.png`],
    dark: dark[`../assets/shots/dark/${name}.png`],
  };
  return (
    <div
      ref={ref}
      className={clsx(
        "squircle overflow-hidden rounded-xl border border-border bg-background shadow-[var(--window-shadow)] transition-[opacity,transform] duration-700 ease-out",
        shown ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0",
        "motion-reduce:translate-y-0 motion-reduce:opacity-100 motion-reduce:transition-none",
        className,
      )}
    >
      <img src={src.light} alt={alt} width={SIZE[name][0]} height={SIZE[name][1]} loading="lazy" decoding="async" className="block w-full dark:hidden" />
      <img src={src.dark} alt={alt} width={SIZE[name][0]} height={SIZE[name][1]} loading="lazy" decoding="async" className="hidden w-full dark:block" />
    </div>
  );
}
