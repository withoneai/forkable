// Single source for the FAQ section's copy. Mirrored by hand into the
// FAQPage JSON-LD in index.html, the way the rest of this page's copy is
// mirrored into its meta tags. Keep the two in sync when either changes.
export const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: "What does Search actually index?",
    a: "Whatever you connect: HubSpot, Attio, Gmail, Outlook Mail, Google Calendar, Outlook Calendar, Notion, Linear, Slack, Teams and Granola ship as built-in profiles. Settings can turn any other tool in One into a profile too.",
  },
  {
    q: "Does it read my data, or just index it?",
    a: "It stores a hybrid-searchable copy of what each profile is told to index, scoped to your own Connect grant. Nothing is sent anywhere outside the Postgres you point it at.",
  },
  {
    q: "Can I use Supabase instead of a local database?",
    a: "Yes. Search runs on an embedded local Postgres by default, or any Postgres connection string, Supabase included. Same schema either way.",
  },
  {
    q: "What if a tool I use isn't in the list?",
    a: "Add it from Settings. Pick the platform from One's catalog, Search proposes a mapping profile, you confirm the fields and schedule, and indexing starts as soon as you save.",
  },
  {
    q: "How does the AI panel avoid making things up?",
    a: "It only reasons over the rows your search actually returned, and every answer cites which of those rows it used. Narrowing the question narrows the search behind it.",
  },
];
