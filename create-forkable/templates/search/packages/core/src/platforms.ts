// Display names and logos for platforms Search knows by name. Browser-safe.

export const PLATFORM_NAMES: Record<string, string> = {
  hubspot: "HubSpot", attio: "Attio", gmail: "Gmail", "outlook-mail": "Outlook Mail",
  "google-calendar": "Google Calendar", "outlook-calendar": "Outlook Calendar", notion: "Notion",
  linear: "Linear", slack: "Slack", teams: "Teams", granola: "Granola", zendesk: "Zendesk",
  openai: "OpenAI", gemini: "Gemini", cohere: "Cohere", "mistral-ai": "Mistral", anthropic: "Anthropic", "claude-code": "Claude Code", codex: "Codex",
  typesafe: "TypeSafe", one: "One",
};

export function platformName(platform: string): string {
  return PLATFORM_NAMES[platform] ?? platform.split(/[-_]/).map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w)).join(" ");
}

export function logoUrl(platform: string): string {
  return `https://assets.withone.ai/connectors/${platform}.svg`;
}

export const AI_PLATFORMS = new Set(["openai", "gemini", "cohere", "mistral-ai", "anthropic", "typesafe"]);
