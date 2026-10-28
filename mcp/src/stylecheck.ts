// A style check on the TSX an agent sends to render_ui and update_ui. It
// never blocks a save: it returns short warnings the tool result carries back
// to the agent, which fixes them with update_ui. The rules are the kit's
// ladder (design/SPACING.md) and the tokens in view/runner.html.

const MAX = 8;

/** Spacing steps on the ladder: 2, 4, 6, 8, 10, 12, 16, 24px (plus 0 and 1px). */
const SPACE_OK = new Set(["0", "px", "0.5", "1", "1.5", "2", "2.5", "3", "4", "6", "auto", "full"]);
const SPACE = /^-?(?:p|px|py|pt|pb|pl|pr|ps|pe|m|mx|my|mt|mb|ml|mr|ms|me|gap|gap-x|gap-y|space-x|space-y)-(.+)$/;

/** Type sizes on the ladder. 12 and 14 are text-xs and text-sm; 18, 20, 24, 30 are display only. */
const TEXT_OK = new Set(["10", "11", "xs", "13", "sm", "15", "lg", "xl", "2xl", "28", "3xl"]);
const TEXT_SIZE = /^text-(\d+|xs|sm|base|lg|[2-9]?xl)$/;

const PALETTE = "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white";
const PALETTE_CLASS = new RegExp(`^(?:bg|text|border|ring|fill|stroke|from|via|to|divide|outline|decoration|shadow|accent|caret|placeholder)-(?:${PALETTE})(?:-\\d{2,3})?(?:/\\d+)?$`);

const RAW: [RegExp, string][] = [
  [/<table[\s>]/, "Raw <table>: use Table from @forkable/ui (columns + rows)."],
  [/<select[\s>]/, "Raw <select>: use Select from @forkable/ui inside a Field."],
  [/<textarea[\s>]/, "Raw <textarea>: use Textarea from @forkable/ui inside a Field."],
  [/<input(?![^>]*type=["'](?:checkbox|radio|hidden|range|file)["'])[\s/>]/, "Raw <input>: use Input from @forkable/ui inside a Field."],
];

const STYLE_PROPS = /\b(color|background|backgroundColor|borderColor|border|padding\w*|margin\w*|gap|rowGap|columnGap|fontSize|lineHeight|fontFamily|borderRadius|boxShadow)\s*:/;

/** Words in the source's string literals ("...", `...`, '...'): class lists, ternaries and cn() calls alike. */
function classTokens(src: string): string[] {
  const out: string[] = [];
  const strings = /"([^"\n]*)"|`([^`]*)`|(?<![A-Za-z])'([^'\n]*)'/g;
  for (const m of src.matchAll(strings)) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? "").replace(/\$\{[^}]*\}/g, " ");
    for (const t of raw.split(/\s+/)) if (t) out.push(t);
  }
  return out;
}

/** The utility without variants (hover:, md:, dark:) and the ! modifier. */
const base = (t: string) => t.slice(t.lastIndexOf(":") + 1).replace(/^!|!$/g, "");

export function checkStyle(src: string): string[] {
  const warn: string[] = [];
  const seen = new Set<string>();
  const add = (key: string, line: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    warn.push(line);
  };
  const tokens = classTokens(src);
  const list = (xs: string[]) => [...new Set(xs)].slice(0, 4).join(", ");

  const arbitrary = tokens.filter((t) => /^-?[a-z][a-z0-9-]*-\[.+\]$/.test(base(t)));
  if (arbitrary.length) add("arb", `Arbitrary values (${list(arbitrary)}): use ladder steps and tokens, no [...] values.`);

  const space = tokens.filter((t) => {
    const m = SPACE.exec(base(t));
    return m && !SPACE_OK.has(m[1]!) && !m[1]!.startsWith("[") && /^[\d.]+$/.test(m[1]!);
  });
  if (space.length) add("space", `Off-ladder spacing (${list(space)}): use 0.5, 1, 1.5, 2, 2.5, 3, 4 or 6.`);

  const text = tokens.filter((t) => {
    const m = TEXT_SIZE.exec(base(t));
    return m && !TEXT_OK.has(m[1]!);
  });
  if (text.length) add("text", `Off-ladder type (${list(text)}): use text-11, text-13, text-15; text-lg or text-28 for a big number.`);

  const palette = tokens.filter((t) => PALETTE_CLASS.test(base(t)));
  if (palette.length) add("palette", `Palette colors (${list(palette)}): use the tokens (foreground, muted-foreground, card, border, primary, accent, danger).`);

  const hex = src.match(/["'`\[]#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?=["'`\];\s)])/g);
  const fn = src.match(/\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(/g);
  if (hex || fn) add("hex", `Hard-coded colors (${list([...(hex ?? []).map((h) => h.slice(1)), ...(fn ?? []).map((f) => `${f})`)])}): use the token classes, never hex or rgb.`);

  for (const m of src.matchAll(/style\s*=\s*\{\{([^}]*)\}\}/g)) {
    const prop = STYLE_PROPS.exec(m[1]!);
    if (prop) add("style", `Inline style sets ${prop[1]}: use classes for color and spacing (style is fine for a computed width or height).`);
  }

  const emoji = src.match(/(?![©®™])\p{Extended_Pictographic}/gu);
  if (emoji) add("emoji", `Emoji (${[...new Set(emoji)].slice(0, 4).join(" ")}): use lucide-react icons instead.`);

  for (const [re, line] of RAW) if (re.test(src)) add(line, line);

  return warn.slice(0, MAX);
}

/** The lines appended to render_ui / update_ui results, or "" when clean. */
export function styleNote(src: string): string {
  const w = checkStyle(src);
  if (!w.length) return "";
  return `\n\nStyle check, ${w.length} to fix with update_ui (see ui_guide):\n${w.map((l) => `- ${l}`).join("\n")}`;
}
