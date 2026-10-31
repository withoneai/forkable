// The profile format as a zod schema (CONTRACT 4.1). profiles/schema/profile-1.json
// is generated from `profileSchema` by `pnpm --filter @search/core gen:schema`.

import { z } from "zod";
import type { SearchProfile, SearchProfilePack, Expr } from "../contract.js";

export const PROFILE_SCHEMA_ID = "https://search.forkable.dev/schema/profile-1.json" as const;
export const PACK_SCHEMA_ID = "https://search.forkable.dev/schema/pack-1.json" as const;

export const DECODERS = [
  "text", "html", "markdown", "mail-strip", "graph-body", "mime-body",
  "notion-blocks", "notion-title", "slack-mrkdwn", "prosemirror", "transcript",
  "email", "domain", "datetime", "address", "number",
] as const;

export const KINDS = [
  "person", "company", "email_thread", "event", "doc", "task",
  "message", "meeting_note", "deal", "note", "record",
] as const;

const path = z.string().min(1).describe("Path: a.b | a.0 | a[0] | a[-1] | a[] | a[name=From]");
const template = z.string().describe("Template: literal text with {{ expr | filter:arg }} parts");
const duration = z.string().min(1).describe("Duration like 10m, 1h, 365d, all, or a template");
const passAs = z.string().regex(/^(query|body|header):.+$/).describe("query:<param> | body:<dot.path> | header:<name>");
const decoder = z.enum(DECODERS);

export const exprSchema: z.ZodType<Expr> = z.lazy(() =>
  z.union([
    path,
    z.strictObject({
      path,
      pick: z.enum(["first", "last", "all", "join", "count"]).optional(),
      sep: z.string().optional(),
      decode: decoder.optional(),
    }),
    z.strictObject({ template }),
    z.strictObject({ coalesce: z.array(exprSchema).min(1) }),
    z.strictObject({ join: z.array(exprSchema).min(1), sep: z.string().optional() }),
    z.strictObject({ test: z.string().min(1) }),
  ]),
);

const requestShape = {
  actionId: z.string().min(1),
  pathVars: z.record(z.string(), template).optional(),
  query: z.record(z.string(), z.union([template, z.array(template)])).optional(),
  body: z.unknown().optional(),
  headers: z.record(z.string(), template).optional(),
};
const requestSchema = z.strictObject(requestShape);

const paginationSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("none") }),
  z.strictObject({ type: z.literal("cursor"), next: path, passAs, hasMore: path.optional(), hasMoreInverted: z.boolean().optional() }),
  z.strictObject({ type: z.literal("offset"), passAs, total: path.optional(), start: z.union([z.literal(0), z.literal(1)]).optional(), nextPath: path.optional(), hasMore: path.optional() }),
  z.strictObject({ type: z.literal("page"), passAs, start: z.union([z.literal(0), z.literal(1)]).optional(), totalPages: path.optional() }),
  z.strictObject({ type: z.literal("lastId"), idPath: path, passAs, hasMore: path.optional() }),
  z.strictObject({ type: z.literal("relay"), endCursor: path, hasNextPage: path, passAs }),
  z.strictObject({ type: z.literal("linkHeader") }),
  z.strictObject({ type: z.literal("nextUrl"), next: path }),
]);

const incrementalSchema = z.discriminatedUnion("strategy", [
  z.strictObject({ strategy: z.literal("full") }),
  z.strictObject({
    strategy: z.literal("watermark"), field: path, order: z.enum(["asc", "desc"]).optional(),
    overlap: duration.optional(), restartOnCap: z.number().int().positive().optional(), initial: duration.optional(),
  }),
  z.strictObject({
    strategy: z.literal("delta"), tokenPath: path, tokenPassAs: z.union([passAs, z.literal("url")]).optional(),
    bootstrap: requestSchema.optional(), resetOn: z.array(z.number().int()).optional(), initial: duration.optional(),
  }),
]);

const listSchema = z.strictObject({
  ...requestShape,
  resultsPath: z.string(),
  idPath: path,
  pagination: paginationSchema,
  pageSize: z.strictObject({ param: z.string().min(1), value: z.number().int().positive(), in: z.enum(["query", "body"]).optional() }).optional(),
});

type PartitionOut = z.infer<typeof partitionBase> & { next?: PartitionOut };
const partitionBase = z.strictObject({
  ...requestShape,
  as: z.string().min(1),
  resultsPath: z.string(),
  idPath: path,
  pagination: paginationSchema,
  keep: z.string().optional(),
  order: z.strictObject({ by: path, dir: z.enum(["asc", "desc"]) }).optional(),
  max: z.union([z.number().int().positive(), template]).optional(),
});
const partitionSchema: z.ZodType<PartitionOut> = z.lazy(() => partitionBase.extend({ next: partitionSchema.optional() }));

const childSchema = z.strictObject({
  as: z.string().min(1),
  request: requestSchema,
  resultsPath: z.string(),
  pagination: paginationSchema.optional(),
  maxPages: z.number().int().positive().optional(),
  when: z.string().optional(),
});

const hydrateSchema = z.strictObject({
  request: requestSchema,
  resultsPath: z.string().optional(),
  fingerprint: template.optional(),
  children: z.array(childSchema).optional(),
  concurrency: z.number().int().min(1).max(16).optional(),
  notFoundIsDelete: z.boolean().optional(),
  when: z.string().optional(),
});

const deletesSchema = z.strictObject({
  when: z.string().optional(),
  reconcile: z.enum(["never", "onFullPass"]).optional(),
  fullPassEvery: duration.optional(),
});

const fieldsSchema = z.strictObject({
  title: exprSchema,
  body: exprSchema.optional(),
  snippet: exprSchema.optional(),
  occurredAt: exprSchema,
  updatedAt: exprSchema.optional(),
  url: template.optional(),
  container: exprSchema.optional(),
  groupKey: exprSchema.optional(),
  status: exprSchema.optional(),
  labels: exprSchema.optional(),
  facets: z.record(z.string(), exprSchema).optional(),
});

const refRole = z.enum(["from", "to", "cc", "attendee", "organizer", "owner", "assignee", "author", "mentioned", "about"]);
const entityType = z.enum(["person", "company"]);
const entitiesSchema = z.strictObject({
  is: z.strictObject({
    type: entityType, email: exprSchema.optional(), domain: exprSchema.optional(), name: exprSchema.optional(),
    externalId: exprSchema.optional(), title: exprSchema.optional(), companyName: exprSchema.optional(),
    allEmails: z.boolean().optional(),
  }).optional(),
  refs: z.array(z.strictObject({
    role: refRole, type: entityType, email: exprSchema.optional(), name: exprSchema.optional(), address: exprSchema.optional(),
    domain: exprSchema.optional(), externalId: exprSchema.optional(), response: exprSchema.optional(),
    each: path.optional(),
  })).optional(),
  ignoreDomains: z.array(z.string()).optional(),
  directory: z.boolean().optional(),
});

const chunkSchema = z.strictObject({
  strategy: z.enum(["whole", "paragraph", "message", "heading"]),
  unit: path.optional(),
  unitBody: exprSchema.optional(),
  maxTokens: z.number().int().min(50).max(2000).optional(),
  overlapTokens: z.number().int().min(0).max(500).optional(),
  header: template.optional(),
});

const classifySchema = z.strictObject({
  key: z.string().min(1),
  jev: z.strictObject({
    question: template, output: z.enum(["labels", "boolean", "score"]),
    labels: z.array(z.string()).optional(), into: z.string().regex(/^facets\.x_[A-Za-z0-9_]+$/),
  }),
  when: z.string().optional(),
});

const limitsSchema = z.strictObject({
  requestsPerMinute: z.number().positive().optional(),
  perAction: z.record(z.string(), z.strictObject({ requestsPerMinute: z.number().positive(), pageSize: z.number().int().positive().optional() })).optional(),
  maxPagesPerRun: z.number().int().positive().optional(),
  maxItemsPerRun: z.number().int().positive().optional(),
});

const settingSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("duration"), default: z.string(), label: z.string(), help: z.string().optional() }),
  z.strictObject({ type: z.literal("string"), default: z.string(), label: z.string(), help: z.string().optional() }),
  z.strictObject({ type: z.literal("number"), default: z.number(), label: z.string(), min: z.number().optional(), max: z.number().optional(), help: z.string().optional() }),
  z.strictObject({ type: z.literal("boolean"), default: z.boolean(), label: z.string(), help: z.string().optional() }),
  z.strictObject({ type: z.literal("choice"), default: z.string(), options: z.array(z.strictObject({ value: z.string(), label: z.string() })).min(1), label: z.string(), help: z.string().optional() }),
]);

const accountSchema = z.strictObject({
  request: requestSchema,
  vars: z.record(z.string(), path),
  self: z.array(z.strictObject({ kind: z.enum(["email", "domain", "ext"]), var: z.string() })).optional(),
  optional: z.boolean().optional(),
});

const profileObject = z.strictObject({
  $schema: z.literal(PROFILE_SCHEMA_ID),
  id: z.string().regex(/^[a-z0-9-]+\.[a-z0-9-]+$/),
  platform: z.string().regex(/^[a-z0-9-]+$/),
  model: z.string().regex(/^[a-z0-9-]+$/),
  kind: z.enum(KINDS),
  title: z.string().min(1),
  description: z.string().optional(),
  author: z.string().optional(),
  revision: z.number().int().optional(),
  verified: z.enum(["none", "fixture", "real"]).optional(),
  proposal: z.strictObject({ by: z.string(), draftId: z.string(), at: z.string() }).optional(),
  sampleOnly: z.boolean().optional(),
  enabledByDefault: z.boolean().optional(),
  account: accountSchema.optional(),
  settings: z.record(z.string(), settingSchema).optional(),
  partitions: partitionSchema.optional(),
  list: listSchema,
  incremental: incrementalSchema,
  hydrate: hydrateSchema.optional(),
  deletes: deletesSchema.optional(),
  keep: z.string().optional(),
  fields: fieldsSchema,
  entities: entitiesSchema.optional(),
  chunk: chunkSchema.optional(),
  classify: z.array(classifySchema).optional(),
  limits: limitsSchema.optional(),
  schedule: z.strictObject({ every: duration }).optional(),
});

export const profileSchema = profileObject as unknown as z.ZodType<SearchProfile>;

export const packSchema = z.strictObject({
  $schema: z.literal(PACK_SCHEMA_ID),
  name: z.string().min(1),
  platform: z.string().regex(/^[a-z0-9-]+$/),
  profiles: z.array(profileObject).min(1),
}) as unknown as z.ZodType<SearchProfilePack>;

/** JSON Schema for one profile (profiles/schema/profile-1.json). */
export function profileJsonSchema(): Record<string, unknown> {
  const js = z.toJSONSchema(profileObject, { target: "draft-2020-12", unrepresentable: "any", reused: "ref" }) as Record<string, unknown>;
  return { $schema: js.$schema, $id: PROFILE_SCHEMA_ID, title: "Search profile", ...js };
}

/** Short, human error lines from a zod error. */
export function zodIssues(err: z.ZodError): string[] {
  return err.issues.map((i) => `${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`);
}
