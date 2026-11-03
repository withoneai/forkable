import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The type ladder adds text-8 ... text-28 (index.css). Without telling
// tailwind-merge they are font sizes it reads them as colors, so
// cn("text-background", "text-13") would silently drop the color.
const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: ["8", "9", "10", "11", "13", "15", "28"] }] } },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
