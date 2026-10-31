// The keyboard table (search-ux-mobbin.md Part 3 plus SPEC 15.5). The ? sheet
// and the palette both render from this list, so a key shown is a key that works.
// Browser copy until @search/core ships keymap.ts.

export interface KeyBinding { id: string; keys: string; label: string }
export interface KeyGroup { group: string; items: KeyBinding[] }

export const KEYMAP: KeyGroup[] = [
  { group: "Global", items: [
    { id: "focus-box", keys: "/", label: "Focus the search box" },
    { id: "palette", keys: "⌘ K", label: "Command palette" },
    { id: "dock", keys: "⌘ J", label: "Toggle the assistant" },
    { id: "dock-focus", keys: "⌘ ⇧ J", label: "Ask about the selected result" },
    { id: "sheet", keys: "?", label: "This sheet" },
    { id: "go-home", keys: "G H", label: "Home" },
    { id: "go-integrations", keys: "G I", label: "Integrations" },
    { id: "go-access", keys: "G A", label: "Access" },
    { id: "go-settings", keys: "G ,", label: "Settings" },
    { id: "go-people", keys: "G P", label: "People" },
    { id: "go-saved", keys: "G 1-9", label: "Saved search n" },
  ] },
  { group: "Search box", items: [
    { id: "accept", keys: "Tab", label: "Accept the suggestion, or ask" },
    { id: "search", keys: "↵", label: "Search" },
    { id: "ask-results", keys: "⌘ ↵", label: "Ask about these results" },
    { id: "into-list", keys: "↓", label: "Move into the results" },
    { id: "clear", keys: "Esc", label: "Clear, then leave the box" },
  ] },
  { group: "Results", items: [
    { id: "next", keys: "J", label: "Next result" },
    { id: "prev", keys: "K", label: "Previous result" },
    { id: "open-preview", keys: "↵", label: "Open the preview" },
    { id: "open-source", keys: "O", label: "Open in the source app" },
    { id: "toggle-preview", keys: "Space", label: "Toggle the preview" },
    { id: "copy", keys: "Y", label: "Copy link" },
    { id: "scope", keys: "1-9", label: "Scope tab n" },
    { id: "filter", keys: "F", label: "Add a filter" },
    { id: "clear-filters", keys: "⇧ F", label: "Clear all filters" },
    { id: "save", keys: "S", label: "Save this search" },
    { id: "refresh", keys: "⇧ R", label: "Refresh, skipping saved results" },
    { id: "about", keys: "P", label: "Everything about this person" },
    { id: "lane", keys: "L V", label: "Lane: VIPs (N, W, F, L for the others)" },
    { id: "close-preview", keys: "Esc", label: "Close the preview, then the box" },
  ] },
  { group: "Assistant", items: [
    { id: "send", keys: "⌘ ↵", label: "Send, or Apply a proposal" },
    { id: "cite", keys: "⌥ 1-9", label: "Open citation n" },
    { id: "back", keys: "Esc", label: "Back to the results" },
  ] },
  { group: "Sources", items: [
    { id: "new-profile", keys: "N", label: "New profile" },
    { id: "sync", keys: "R", label: "Sync now (source detail)" },
    { id: "move", keys: "J/K", label: "Move through sources" },
  ] },
  { group: "New profile", items: [
    { id: "continue", keys: "↵", label: "Continue" },
    { id: "save-profile", keys: "⌘ ↵", label: "Save and start indexing" },
    { id: "skip", keys: "S", label: "Skip the field" },
    { id: "reset", keys: "R", label: "Reset to the AI proposal" },
    { id: "leave", keys: "Esc", label: "Leave (asks first)" },
  ] },
];

export const keyFor = (id: string): string | undefined => KEYMAP.flatMap((g) => g.items).find((b) => b.id === id)?.keys;
