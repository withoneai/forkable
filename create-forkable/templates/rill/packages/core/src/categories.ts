import type { MailProviderKey } from "./types.js";

// Which inbox tabs Rill reads. Gmail sorts mail into Primary, Promotions,
// Updates, Social and Forums; Outlook into Focused and Other. Rill reads only
// Primary (Focused) by default, so a newsletter never costs a fetch or a Jev
// call. The same list filters three places: the provider query at import, the
// judging queue, and the inbox rows, so turning a tab off hides it at once.

export const MAIL_CATEGORIES = ["primary", "promotions", "updates", "social", "forums", "other"] as const;
export type MailCategory = (typeof MAIL_CATEGORIES)[number];

export const DEFAULT_MAIL_CATEGORIES: MailCategory[] = ["primary"];

/** The tabs each provider has, in display order. Outlook's Focused is stored as "primary". */
export const CATEGORIES_BY_PROVIDER: Record<MailProviderKey, { key: MailCategory; label: string }[]> = {
  gmail: [
    { key: "primary", label: "Primary" },
    { key: "promotions", label: "Promotions" },
    { key: "updates", label: "Updates" },
    { key: "social", label: "Social" },
    { key: "forums", label: "Forums" },
  ],
  "outlook-mail": [
    { key: "primary", label: "Focused" },
    { key: "other", label: "Other" },
  ],
};

/** Outlook's "Other" pile rides in labelIds as this mark, next to Gmail's own CATEGORY_* labels. */
export const OUTLOOK_OTHER_LABEL = "CATEGORY_OTHER";

export function normalizeCategories(input: unknown): MailCategory[] {
  if (!Array.isArray(input)) return [...DEFAULT_MAIL_CATEGORIES];
  const out = MAIL_CATEGORIES.filter((c) => input.includes(c));
  return out.length ? out : [...DEFAULT_MAIL_CATEGORIES];
}

/** The tab a message sits in, from its labels. No category label means Primary. */
export function categoryOf(labelIds: string[]): MailCategory {
  for (const l of labelIds) {
    switch (l) {
      case "CATEGORY_PROMOTIONS": return "promotions";
      case "CATEGORY_UPDATES": return "updates";
      case "CATEGORY_SOCIAL": return "social";
      case "CATEGORY_FORUMS": return "forums";
      case OUTLOOK_OTHER_LABEL: return "other";
    }
  }
  return "primary";
}

export function categoryAllowed(labelIds: string[], categories: MailCategory[]): boolean {
  return categories.includes(categoryOf(labelIds));
}

/**
 * The search the provider runs. Gmail takes `in:inbox` and `-category:x`
 * directly; the Outlook mapper reads the same words (in:inbox selects the
 * Inbox folder, -category:other filters to Focused).
 */
export function categoryQuery(provider: MailProviderKey, categories: MailCategory[]): string {
  const off = CATEGORIES_BY_PROVIDER[provider].map((c) => c.key).filter((c) => c !== "primary" && !categories.includes(c));
  return ["in:inbox", ...off.map((c) => `-category:${c}`)].join(" ");
}

const LABEL_OF: Record<Exclude<MailCategory, "primary">, string> = {
  promotions: "CATEGORY_PROMOTIONS",
  updates: "CATEGORY_UPDATES",
  social: "CATEGORY_SOCIAL",
  forums: "CATEGORY_FORUMS",
  other: OUTLOOK_OTHER_LABEL,
};

/** The category labels of the tabs that are off. A message carrying any of them is skipped. */
export function excludedLabels(categories: MailCategory[]): string[] {
  return (Object.keys(LABEL_OF) as (keyof typeof LABEL_OF)[]).filter((c) => !categories.includes(c)).map((c) => LABEL_OF[c]);
}
