// Fixture catalog for the New profile flow (SPEC D32): the Zendesk sample,
// shaped like Zendesk's documented list responses, with `sample::` action ids
// the engine refuses outside sample mode. Plus a synthesized profile for each
// built-in source so the Fields tab has something real to show.
import type { CatalogAction, ItemKind, ProposalOutput, SearchProfile } from "@/contract/api-types";
import { logoUrl, platformName } from "@/lib/utils";
import { SOURCES } from "./world";

const H = 3_600_000;
const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * H).toISOString().replace(/\.\d+Z$/, "Z");

export const ZD_USERS = [
  { id: 381001, name: "Ravi Menon", email: "ravi@initech.io", role: "end-user", organization_id: 52001, created_at: iso(900), updated_at: iso(30) },
  { id: 381002, name: "Hannah Cole", email: "hannah.cole@umbrella.co", role: "end-user", organization_id: 52002, created_at: iso(1400), updated_at: iso(50) },
  { id: 381003, name: "Priya Shah", email: "priya@globex.com", role: "end-user", organization_id: 52003, created_at: iso(5000), updated_at: iso(20) },
  { id: 381004, name: "Marco Bellini", email: "marco@globex.com", role: "end-user", organization_id: 52003, created_at: iso(4000), updated_at: iso(70) },
  { id: 381005, name: "Jules Martin", email: "jules@hooli.dev", role: "end-user", organization_id: 52004, created_at: iso(300), updated_at: iso(48) },
  { id: 390001, name: "Sam Okafor", email: "sam@acme.com", role: "agent", organization_id: null, created_at: iso(9000), updated_at: iso(5) },
  { id: 390002, name: "Mia Park", email: "mia@acme.com", role: "agent", organization_id: null, created_at: iso(9000), updated_at: iso(8) },
];
export const ZD_ORGS = [
  { id: 52001, name: "Initech", domain_names: ["initech.io"], created_at: iso(900), updated_at: iso(30) },
  { id: 52002, name: "Umbrella", domain_names: ["umbrella.co"], created_at: iso(1400), updated_at: iso(50) },
  { id: 52003, name: "Globex", domain_names: ["globex.com"], created_at: iso(5000), updated_at: iso(20) },
  { id: 52004, name: "Hooli", domain_names: ["hooli.dev"], created_at: iso(300), updated_at: iso(48) },
];
export const ZD_GROUPS = [
  { id: 7001, name: "Support", created_at: iso(9000), updated_at: iso(900) },
  { id: 7002, name: "Enterprise success", created_at: iso(9000), updated_at: iso(600) },
];

const T = (id: number, subject: string, description: string, status: string, priority: string, requester: number, assignee: number | null, org: number | null, tags: string[], created: number, updated: number, channel = "email") => ({
  id, url: `https://acme.zendesk.com/api/v2/tickets/${id}.json`, subject, description, status, priority, type: "question",
  requester_id: requester, assignee_id: assignee, organization_id: org, tags, created_at: iso(created), updated_at: iso(updated), via: { channel },
});

export const ZD_TICKETS = [
  T(4812, "CSV import times out on large ledger files", "Our 2021 ledger export is 180 MB and the import stops at about 60 MB with a gateway timeout. Chunks of 40 MB work. Is there a fix coming?", "open", "high", 381001, 390002, 52001, ["pilot", "import"], 70, 9),
  T(4813, "Audit log export to our SIEM", "Procurement needs a monthly audit log export in JSON lines. Can Acme push it to an S3 bucket we own?", "pending", "normal", 381002, 390001, 52002, ["enterprise", "audit-log"], 96, 30),
  T(4815, "SAML metadata upload fails", "When I upload our Okta metadata XML the page says the certificate is invalid. The cert is valid until 2028.", "open", "urgent", 381003, 390002, 52003, ["sso", "enterprise"], 30, 6),
  T(4816, "Copy of the signed DPA", "Please send the countersigned data processing addendum with the EU SCCs for our records.", "solved", "low", 381004, 390001, 52003, ["legal"], 140, 100),
  T(4818, "Invoice shows the wrong VAT number", "The October invoice lists our old VAT number. Our EU entity changed it in September.", "open", "normal", 381002, 390001, 52002, ["billing", "vat"], 50, 26),
  T(4820, "Reconciliation takes over 5 minutes", "After the 2023 import, reconciliation for one account takes 5 to 6 minutes. The pilot goal is under 2.", "new", "high", 381001, null, 52001, ["pilot", "performance"], 12, 12, "web"),
  T(4821, "Add three more admins", "Can you give admin rights to three people on our finance team? Names in the attached sheet.", "solved", "low", 381003, 390001, 52003, ["seats"], 200, 180),
  T(4823, "Question about usage-based billing", "We saw the Ledger 2.0 announcement. How will usage be metered for our plan, and when does it start?", "pending", "normal", 381005, 390001, 52004, ["billing", "ledger-2"], 44, 40, "web"),
  T(4824, "Export to Google Sheets breaks dates", "Dates export as text in Google Sheets, so filters do not work. Excel is fine.", "open", "normal", 381001, 390002, 52001, ["export"], 22, 18),
  T(4826, "EU data residency confirmation", "Before our procurement call we need written confirmation that our data stays in the EU region.", "open", "high", 381002, 390001, 52002, ["enterprise", "residency"], 28, 20),
  T(4827, "Password reset email never arrives", "Two of our users do not receive the reset email. Spam folders checked.", "solved", "normal", 381004, 390002, 52003, ["login"], 300, 250, "web"),
  T(4829, "Webhook retries for failed deliveries", "How many times do webhooks retry, and is there a dead letter queue we can read?", "new", "low", 381005, null, 52004, ["api", "webhooks"], 4, 4, "api"),
];

export const ZD_ACTIONS: CatalogAction[] = [
  { actionId: "sample::zendesk::tickets.list", title: "List tickets", method: "GET", path: "/api/v2/tickets", tags: ["tickets"], listLike: true, readOnly: true, permitted: true },
  { actionId: "sample::zendesk::users.list", title: "List users", method: "GET", path: "/api/v2/users", tags: ["users"], listLike: true, readOnly: true, permitted: true },
  { actionId: "sample::zendesk::organizations.list", title: "List organizations", method: "GET", path: "/api/v2/organizations", tags: ["organizations"], listLike: true, readOnly: true, permitted: true },
  { actionId: "sample::zendesk::groups.list", title: "List groups", method: "GET", path: "/api/v2/groups", tags: ["groups"], listLike: true, readOnly: true, permitted: false },
];

export const ZD_DATA: Record<string, { key: string; rows: unknown[]; total: number }> = {
  "sample::zendesk::tickets.list": { key: "tickets", rows: ZD_TICKETS, total: 12 },
  "sample::zendesk::users.list": { key: "users", rows: ZD_USERS, total: 7 },
  "sample::zendesk::organizations.list": { key: "organizations", rows: ZD_ORGS, total: 4 },
  "sample::zendesk::groups.list": { key: "groups", rows: ZD_GROUPS, total: 2 },
};

const SCHEMA = "https://search.forkable.dev/schema/profile-1.json" as const;

function zdProfile(model: string, kind: ItemKind, actionId: string, key: string, title: string, fields: SearchProfile["fields"], extra: Partial<SearchProfile> = {}): SearchProfile {
  return {
    $schema: SCHEMA, id: `zendesk.${model}`, platform: "zendesk", model, kind, title, author: "user", verified: "fixture", sampleOnly: true,
    list: { actionId, resultsPath: key, idPath: "id", pagination: { type: "cursor", next: "meta.after_cursor", passAs: "query:page[after]", hasMore: "meta.has_more" }, pageSize: { param: "page[size]", value: 100 } },
    incremental: { strategy: "watermark", field: "updated_at", order: "asc", overlap: "10m", initial: "365d" },
    fields, schedule: { every: "15m" }, ...extra,
  };
}

export const ZD_PROPOSAL: ProposalOutput = {
  notes: "Tickets are the support history a person searches. Users and organizations mostly resolve who a ticket is from.",
  models: [
    {
      recommended: true, reason: "Support history with your customers, the thing you will search for most.",
      profile: zdProfile("tickets", "task", "sample::zendesk::tickets.list", "tickets", "Zendesk tickets", {
        title: "subject", body: { path: "description", decode: "text" }, occurredAt: "created_at", updatedAt: "updated_at", status: "status", labels: { path: "tags", pick: "all" },
        url: "https://acme.zendesk.com/agent/tickets/{{ item.id }}", facets: { priority: "priority" },
      }, { entities: { refs: [{ role: "from", type: "person", externalId: { template: "zendesk:user:{{ item.requester_id }}" } }] } }),
      fieldNotes: [
        { target: "list.idPath", path: "id", confidence: 0.99, reason: "Numeric, unique on all 12 samples" },
        { target: "fields.title", path: "subject", confidence: 0.97, reason: "Short text present on every ticket" },
        { target: "fields.body", path: "description", confidence: 0.93, reason: "Longest text field, reads as the request" },
        { target: "fields.occurredAt", path: "created_at", confidence: 0.95, reason: "ISO dates, named created" },
        { target: "fields.updatedAt", path: "updated_at", confidence: 0.92, reason: "ISO dates, used as the watermark" },
        { target: "fields.status", path: "status", confidence: 0.88, reason: "Small set: new, open, pending, solved" },
        { target: "fields.labels", path: "tags", confidence: 0.81, reason: "List of short words" },
        { target: "facets.priority", path: "priority", confidence: 0.62, reason: "Words, not numbers; mapped low to urgent" },
        { target: "refs.from", path: "requester_id", confidence: 0.58, reason: "A user id, resolved through Zendesk users" },
        { target: "refs.assignee", path: "assignee_id", confidence: 0.52, reason: "A user id, empty on 2 of 12" },
        { target: "refs.about", path: "organization_id", confidence: 0.47, reason: "Organization id, resolved by name and domain" },
        { target: "fields.container", path: "via.channel", confidence: 0.4, reason: "Channel the ticket came in by; maybe noise" },
      ],
      questions: ["The API url is not a page you can open. Use the agent link template instead?"],
    },
    {
      recommended: true, reason: "The people who write in, merged with the same people in your CRM by email.",
      profile: zdProfile("users", "person", "sample::zendesk::users.list", "users", "Zendesk users", { title: "name", occurredAt: "created_at", updatedAt: "updated_at", url: "https://acme.zendesk.com/agent/users/{{ item.id }}" }, { entities: { is: { type: "person", email: "email", name: "name" }, directory: true } }),
      fieldNotes: [
        { target: "list.idPath", path: "id", confidence: 0.99, reason: "Numeric, unique" },
        { target: "fields.title", path: "name", confidence: 0.96, reason: "A person's name" },
        { target: "is.email", path: "email", confidence: 0.98, reason: "Every value is an email address" },
        { target: "fields.occurredAt", path: "created_at", confidence: 0.9, reason: "ISO dates, named created" },
        { target: "fields.updatedAt", path: "updated_at", confidence: 0.9, reason: "ISO dates" },
        { target: "refs.about", path: "organization_id", confidence: 0.55, reason: "Organization id; agents have none" },
      ],
      questions: [],
    },
    {
      recommended: false, reason: "Four organizations, already in your CRM. Useful only for names.",
      profile: zdProfile("organizations", "company", "sample::zendesk::organizations.list", "organizations", "Zendesk organizations", { title: "name", occurredAt: "created_at", updatedAt: "updated_at" }, { entities: { is: { type: "company", domain: "domain_names[0]", name: "name" }, directory: true } }),
      fieldNotes: [
        { target: "list.idPath", path: "id", confidence: 0.99, reason: "Numeric, unique" },
        { target: "fields.title", path: "name", confidence: 0.97, reason: "Company name" },
        { target: "is.domain", path: "domain_names", confidence: 0.8, reason: "Domains, first one used" },
        { target: "fields.occurredAt", path: "created_at", confidence: 0.9, reason: "ISO dates" },
      ],
      questions: [],
    },
  ],
};

/** A plausible saved profile for each built-in source, for the Fields tab in mock mode. */
export function builtinProfile(platform: string, model: string, kind: ItemKind, title: string): SearchProfile {
  const def = SOURCES.find((s) => s.platform === platform && s.model === model);
  const action = def?.actions[0] ?? `${platform}.${model}.list`;
  const f: Record<ItemKind, SearchProfile["fields"]> = {
    person: { title: { join: ["properties.firstname", "properties.lastname"], sep: " " }, occurredAt: "createdAt", updatedAt: "updatedAt", facets: { email: "properties.email", jobTitle: "properties.jobtitle", companyName: "properties.company" } },
    company: { title: "properties.name", occurredAt: "createdAt", updatedAt: "updatedAt", facets: { domain: "properties.domain", industry: "properties.industry" } },
    deal: { title: "properties.dealname", occurredAt: "properties.createdate", updatedAt: "updatedAt", status: "properties.dealstage", facets: { amount: "properties.amount", stage: "properties.dealstage", closeDate: "properties.closedate" } },
    note: { title: { template: "Note on {{ item.associations.0.name | default:'a record' }}" }, body: { path: "properties.hs_note_body", decode: "html" }, occurredAt: "properties.hs_timestamp" },
    email_thread: { title: "messages[-1].subject", body: { path: "messages[].body", pick: "join", decode: "mail-strip" }, occurredAt: "messages[-1].internalDate", groupKey: "threadId", facets: { messageCount: { path: "messages", pick: "count" } } },
    event: { title: "summary", body: { path: "description", decode: "html" }, occurredAt: "start.dateTime", url: "{{ item.htmlLink }}", facets: { start: "start.dateTime", end: "end.dateTime", location: "location", joinUrl: "hangoutLink" } },
    doc: { title: { path: "properties.title", decode: "notion-title" }, body: { path: "children", decode: "notion-blocks" }, occurredAt: "created_time", updatedAt: "last_edited_time", url: "{{ item.url }}" },
    task: { title: "title", body: { path: "description", decode: "markdown" }, occurredAt: "createdAt", updatedAt: "updatedAt", status: "state.name", url: "{{ item.url }}", facets: { key: "identifier", priority: "priority", state: "state.name" } },
    message: { title: { path: "text", decode: "slack-mrkdwn" }, occurredAt: { path: "ts", decode: "datetime" }, container: "partition.name", groupKey: "thread_ts", facets: { channel: "partition.name", replyCount: "reply_count" } },
    meeting_note: { title: "title", body: { path: "summary_markdown", decode: "markdown" }, occurredAt: "created_at", facets: { durationMin: "duration_minutes" } },
    record: { title: "name", occurredAt: "created_at" },
  };
  return {
    $schema: SCHEMA, id: `${platform}.${model}`, platform, model, kind, title: `${platformName(platform)} ${title}`, author: "builtin", revision: 1, verified: "fixture", enabledByDefault: true,
    list: { actionId: `conn_mod_def::${platform}::${action}`, resultsPath: "results", idPath: "id", pagination: { type: "cursor", next: "paging.next.after", passAs: "query:after" } },
    incremental: { strategy: "watermark", field: "updatedAt", order: "desc", overlap: "10m", initial: "365d" },
    fields: f[kind], entities: { refs: [{ role: "owner", type: "person", email: "owner.email" }] }, schedule: { every: "15m" },
  };
}

export interface CatalogEntry { platform: string; name: string; category: string; description: string; inGrant: boolean; connectionLabel: string | null; builtin: boolean }

const builtins = [...new Set(SOURCES.map((s) => s.platform))].map((p) => ({
  platform: p, name: platformName(p), category: "Built in", description: `${platformName(p)} is a built-in source.`, inGrant: true,
  connectionLabel: SOURCES.find((s) => s.platform === p)!.connectionLabel, builtin: true,
}));

export const CATALOG: CatalogEntry[] = [
  ...builtins,
  { platform: "zendesk", name: "Zendesk", category: "Support", description: "Tickets, users and organizations from your help desk.", inGrant: true, connectionLabel: "support@acme.zendesk.com", builtin: false },
  { platform: "google-drive", name: "Google Drive", category: "Files", description: "Docs, sheets and files.", inGrant: true, connectionLabel: "dana@acme.com", builtin: false },
  { platform: "intercom", name: "Intercom", category: "Support", description: "Conversations and contacts.", inGrant: false, connectionLabel: null, builtin: false },
  { platform: "jira", name: "Jira", category: "Engineering", description: "Issues and projects.", inGrant: false, connectionLabel: null, builtin: false },
  { platform: "github", name: "GitHub", category: "Engineering", description: "Issues, pull requests and discussions.", inGrant: false, connectionLabel: null, builtin: false },
  { platform: "salesforce", name: "Salesforce", category: "CRM", description: "Accounts, contacts and opportunities.", inGrant: false, connectionLabel: null, builtin: false },
  { platform: "asana", name: "Asana", category: "Projects", description: "Tasks and projects.", inGrant: false, connectionLabel: null, builtin: false },
  { platform: "pipedrive", name: "Pipedrive", category: "CRM", description: "Deals, people and organizations.", inGrant: false, connectionLabel: null, builtin: false },
];

export const catalogRow = (c: CatalogEntry) => ({
  platform: c.platform, name: c.name, title: c.name, description: c.description, category: c.category, image: logoUrl(c.platform), tags: [c.category.toLowerCase()],
  oauth: true, active: true, inGrant: c.inGrant, connectionLabel: c.connectionLabel, builtin: c.builtin,
});
