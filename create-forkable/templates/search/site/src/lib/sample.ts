// The hero demo's rows, from the app's own Acme Inc sample world
// (search/docs/SPEC.md §11, fixtures/sample/world.md) and its Phase 2 UI
// screens. Dana Oyelaran is the user. Keep the strings in step with the app.
export type SourceSlug =
  | "hubspot"
  | "attio"
  | "gmail"
  | "outlook-mail"
  | "google-calendar"
  | "outlook-calendar"
  | "notion"
  | "linear"
  | "slack"
  | "teams"
  | "granola";

export const SOURCE_NAMES: Record<SourceSlug, string> = {
  hubspot: "HubSpot",
  attio: "Attio",
  gmail: "Gmail",
  "outlook-mail": "Outlook",
  "google-calendar": "Google Calendar",
  "outlook-calendar": "Outlook Calendar",
  notion: "Notion",
  linear: "Linear",
  slack: "Slack",
  teams: "Teams",
  granola: "Granola",
};

export type ResultKind = "Mail" | "Deal" | "Meeting" | "Issue" | "Doc" | "Message" | "Event";

export interface SearchResult {
  id: string;
  source: SourceSlug;
  kind: ResultKind;
  /** Leading bold part, e.g. the sender. */
  who?: string;
  title: string;
  sub: string;
  time: string;
  amount?: string;
  badge?: string;
}

export interface Entity {
  initials: string;
  name: string;
  role: string;
  items: number;
  sources: SourceSlug[];
}

export interface DemoQuery {
  query: string;
  /** Words to bold in titles and snippets. */
  match: string[];
  entities: Entity[];
  results: SearchResult[];
  question: string;
  /** Answer text; `[n]` marks a citation of `cites[n - 1]`. */
  answer: string;
  cites: string[];
}

export const DEMO_QUERIES: DemoQuery[] = [
  {
    query: "globex renewal",
    match: ["Globex", "renewal"],
    entities: [
      { initials: "PS", name: "Priya Shah", role: "VP Partnerships, Globex", items: 11, sources: ["hubspot", "attio", "gmail", "google-calendar", "granola"] },
      { initials: "MB", name: "Marco Bellini", role: "Legal counsel, Globex", items: 6, sources: ["outlook-mail", "hubspot"] },
      { initials: "GL", name: "Globex", role: "globex.com", items: 5, sources: ["hubspot", "attio", "notion"] },
    ],
    results: [
      { id: "g1", source: "gmail", kind: "Mail", who: "Priya Shah", title: "Re: Globex renewal terms (5)", sub: "Dana Oyelaran: Hi Priya, attaching the renewal order form for 2027.", time: "6h" },
      { id: "g2", source: "outlook-mail", kind: "Mail", who: "Marco Bellini", title: "Globex legal redline, final", sub: "Marked-up MSA attached, with the liability cap we discussed.", time: "1d" },
      { id: "g3", source: "hubspot", kind: "Deal", title: "Globex renewal 2027", sub: "Closes Nov 14 · Dana Oyelaran", time: "20h", amount: "$84,000", badge: "Contract sent" },
      { id: "g4", source: "granola", kind: "Meeting", title: "Globex contract review", sub: "Priya asked for a multi-year discount before signing", time: "Mon" },
      { id: "g5", source: "linear", kind: "Issue", title: "ACME-311 SSO for Globex rollout", sub: "Globex needs SAML SSO with Okta before they roll Acme out", time: "Tue" },
      { id: "g6", source: "notion", kind: "Doc", title: "Globex account plan", sub: "Globex is our largest account in enterprise software. 240 seats.", time: "Oct 20" },
      { id: "g7", source: "slack", kind: "Message", who: "#deals", title: "Globex is basically closed", sub: "Dana Oyelaran: waiting on signature, only open item is the discount", time: "1d" },
    ],
    question: "Where are we with Globex?",
    answer:
      "Priya Shah is your champion on the $84,000 renewal [1]. Globex legal sent the final redline yesterday [2], and on Monday's call Priya asked for a multi-year discount before she signs [3]. It closes Nov 14.",
    cites: ["g3", "g2", "g4"],
  },
  {
    query: "initech pilot",
    match: ["Initech", "pilot"],
    entities: [
      { initials: "RM", name: "Ravi Menon", role: "CTO, Initech", items: 7, sources: ["attio", "gmail", "google-calendar", "granola"] },
      { initials: "IN", name: "Initech", role: "initech.io", items: 4, sources: ["attio", "linear"] },
    ],
    results: [
      { id: "i1", source: "attio", kind: "Deal", title: "Initech pilot", sub: "Owner Dana Oyelaran · opened Oct 20", time: "2d", badge: "Discovery" },
      { id: "i2", source: "gmail", kind: "Mail", who: "Ravi Menon", title: "Pilot data import", sub: "Our 2021 ledger export is 180 MB and the import stops partway.", time: "3d" },
      { id: "i3", source: "linear", kind: "Issue", title: "ACME-298 CSV import fails over 50 MB", sub: "In Progress · Mia Park · reported by Initech", time: "1d" },
      { id: "i4", source: "granola", kind: "Meeting", title: "Initech pilot kickoff", sub: "Ravi: the import is the one blocker before we invite the team", time: "Oct 22" },
      { id: "i5", source: "google-calendar", kind: "Event", title: "Initech pilot kickoff", sub: "Wed, Oct 22, 10:00 to 10:45 AM · Dana, Ravi +2", time: "Oct 22" },
      { id: "i6", source: "slack", kind: "Message", who: "#eng", title: "Chunked upload for the Initech pilot", sub: "Mia Park: chunks of 40 MB work, shipping it behind a flag", time: "5h" },
      { id: "i7", source: "notion", kind: "Doc", title: "Pilot playbook", sub: "Week one is the data import. Nothing else starts until it lands.", time: "Oct 12" },
    ],
    question: "What's blocking the Initech pilot?",
    answer:
      "The data import. Ravi's ledger export stops partway through [1], tracked as ACME-298 [2]. Mia's team has chunked uploads working behind a flag [3], and the kickoff notes call it the one blocker [4].",
    cites: ["i2", "i3", "i6", "i4"],
  },
];
