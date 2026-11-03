// The style panel's choices: the generated project's own tokens and ladder
// steps (packages/template/src/index.css, design/SPACING.md), grouped so one
// pick replaces the group's current class. The template safelists these, so
// a swap shows in the preview before any file uses the class.

export interface TokenGroup {
  id: string;
  label: string;
  options: { cls: string; label: string }[];
  /** Matches any class of this group already on the element (custom values too). */
  match: RegExp;
}

const steps = (prefix: string, values: string[]) => values.map((v) => ({ cls: `${prefix}-${v}`, label: v }));

export const TOKEN_GROUPS: TokenGroup[] = [
  { id: "size", label: "Text size", options: steps("text", ["11", "13", "15", "28"]), match: /^text-(\d+|xs|sm|base|lg|xl|\dxl|\[.+\])$/ },
  { id: "weight", label: "Weight", options: [{ cls: "font-normal", label: "Regular" }, { cls: "font-medium", label: "Medium" }, { cls: "font-semibold", label: "Semibold" }], match: /^font-(thin|light|normal|medium|semibold|bold|extrabold|black)$/ },
  { id: "color", label: "Text color", options: [{ cls: "text-foreground", label: "Default" }, { cls: "text-muted-foreground", label: "Muted" }, { cls: "text-accent", label: "Accent" }], match: /^text-(foreground|muted-foreground|accent|accent-foreground|faint|white|black|[a-z]+-\d{2,3}|\[#.+\])$/ },
  { id: "bg", label: "Background", options: [{ cls: "bg-transparent", label: "None" }, { cls: "bg-background", label: "Page" }, { cls: "bg-card", label: "Card" }, { cls: "bg-muted", label: "Muted" }, { cls: "bg-accent", label: "Accent" }], match: /^bg-(transparent|background|card|card-hover|muted|accent|white|black|[a-z]+-\d{2,3}|\[.+\])$/ },
  { id: "pad", label: "Padding", options: steps("p", ["0", "2", "3", "4", "6", "8"]), match: /^p-(\d+(\.\d)?|\[.+\])$/ },
  { id: "gap", label: "Gap", options: steps("gap", ["0", "1", "2", "3", "4", "6", "8"]), match: /^gap-(\d+(\.\d)?|\[.+\])$/ },
  { id: "radius", label: "Radius", options: [{ cls: "rounded-none", label: "0" }, { cls: "rounded-sm", label: "sm" }, { cls: "rounded-md", label: "md" }, { cls: "rounded-lg", label: "lg" }, { cls: "rounded-xl", label: "xl" }, { cls: "rounded-full", label: "full" }], match: /^rounded(-(none|sm|md|lg|xl|2xl|3xl|full|\[.+\]))?$/ },
];

export function currentIn(group: TokenGroup, classes: string[]): string[] {
  return classes.filter((c) => group.match.test(c));
}

/** One more swap folded into an element's pending class edit. */
export function fold(prev: { remove: string[]; add: string[] } | undefined, remove: string[], add: string[]): { remove: string[]; add: string[] } {
  const r = new Set(prev?.remove ?? []);
  const a = new Set(prev?.add ?? []);
  for (const c of remove) {
    if (a.has(c)) a.delete(c);
    else r.add(c);
  }
  for (const c of add) {
    if (r.has(c)) r.delete(c);
    else a.add(c);
  }
  return { remove: [...r], add: [...a] };
}
