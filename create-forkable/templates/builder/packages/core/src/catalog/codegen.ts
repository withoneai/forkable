// ioSchema -> TypeScript wrappers in server/one/actions.gen.ts.
//
// Input keeps ioSchema's split as { body?, query?, pathParams?, headers? }
// (the schema's `path` key becomes `pathParams`). What One sets itself is
// dropped: the connection key in a custom action's body, the x-*-secret header and
// Content-Type. A header the schema fixes with `const` is filled in by the
// wrapper (`headers` on the action) and left out of the type.
// allOf/if/then/anyOf-of-required are flattened to the loosest correct type,
// with the conditional requirements written into the doc comment. An action
// with no ioSchema gets loose types and a warning.

import { compile, type JSONSchema } from "json-schema-to-typescript";
import { BRAND } from "../brand.js";
import type { KnowledgeRow } from "../fixtures.js";
import type { InstalledAction } from "../types.js";
import { levelFor, platformIdent, verbFor, wrapperName } from "./naming.js";

type Schema = Record<string, unknown>;

export interface GeneratedWrapper {
  actionId: string;
  platform: string;
  /** `gmail.sendEmail` */
  ref: string;
  name: string;
  title: string;
  method: string;
  path: string;
  /** The TypeScript input type, as written in actions.gen.ts. */
  inputType: string;
  inputTypeName: string;
  outputTypeName: string;
  /** Conditional requirements the type cannot say. */
  conditions: string[];
  /** Fixed headers the wrapper sends. */
  headers: Record<string, string>;
  loose: boolean;
}

export interface CodegenResult {
  code: string;
  wrappers: GeneratedWrapper[];
  warnings: { actionId: string; message: string }[];
}

const ONE_HEADERS = new Set(["content-type", "authorization", "x-one-connection-key"]);
/** One's secret header. Catalog docs name it under more than one vendor prefix. */
const isOneHeader = (name: string): boolean => ONE_HEADERS.has(name) || /^x-[a-z]+-secret$/.test(name);
const ONE_BODY_FIELDS = new Set(["connectionKey"]);
const STRIP_KEYS = new Set(["$schema", "title", "$id", "examples", "default", "format", "pattern", "minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems", "multipleOf", "exclusiveMinimum", "exclusiveMaximum"]);

const isObj = (v: unknown): v is Schema => !!v && typeof v === "object" && !Array.isArray(v);

/** Pull conditional requirements out of a schema, describing them instead. */
function flatten(schema: unknown, at: string, notes: string[]): unknown {
  if (Array.isArray(schema)) return schema.map((s) => flatten(s, at, notes));
  if (!isObj(schema)) return schema;
  const out: Schema = {};
  for (const [k, v] of Object.entries(schema)) {
    if (STRIP_KEYS.has(k)) continue;
    if (k === "if" || k === "then" || k === "else" || k === "not" || k === "dependentRequired" || k === "dependentSchemas" || k === "dependencies") continue;
    if (k === "properties" && isObj(v)) {
      out.properties = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, flatten(pv, at ? `${at}.${pk}` : pk, notes)]));
      continue;
    }
    if ((k === "allOf" || k === "anyOf" || k === "oneOf") && Array.isArray(v)) {
      // Members that only add `required` lists (or if/then) are conditions, not shapes.
      const shapes: unknown[] = [];
      for (const m of v) {
        if (isObj(m) && (m.if || m.then)) {
          const ifReq = isObj(m.if) && Array.isArray(m.if.required) ? (m.if.required as string[]) : [];
          const thenReq = isObj(m.then) && Array.isArray(m.then.required) ? (m.then.required as string[]) : [];
          if (thenReq.length) notes.push(`${at || "input"}: ${ifReq.length ? `when ${ifReq.join(", ")} is set, ` : ""}${thenReq.join(", ")} ${thenReq.length === 1 ? "is" : "are"} required.`);
          else notes.push(`${at || "input"}: has a conditional rule; read the action docs.`);
          continue;
        }
        if (isObj(m) && Object.keys(m).every((x) => x === "required" || x === "description")) continue;
        shapes.push(flatten(m, at, notes));
      }
      const onlyRequired = v.filter((m) => isObj(m) && Object.keys(m).every((x) => x === "required"));
      if (k !== "allOf" && onlyRequired.length) {
        const sets = onlyRequired.map((m) => ((m as Schema).required as string[]).join(" + "));
        notes.push(`${at || "input"}: ${k === "oneOf" ? "exactly one" : "at least one"} of ${sets.join(", ")} is required.`);
      }
      if (shapes.length) out[k] = shapes;
      continue;
    }
    out[k] = flatten(v, at, notes);
  }
  // A schema left with only an empty allOf/anyOf after flattening is just its own properties.
  return out;
}

function withoutRequired(schema: Schema, drop: Set<string>): Schema {
  const props = isObj(schema.properties) ? { ...schema.properties } : {};
  for (const k of drop) delete props[k];
  const required = Array.isArray(schema.required) ? (schema.required as string[]).filter((r) => !drop.has(r)) : [];
  return { ...schema, properties: props, required };
}

const hasKeys = (s: Schema | undefined) => !!s && isObj(s.properties) && Object.keys(s.properties).length > 0;

interface InputPlan {
  schema: Schema;
  headers: Record<string, string>;
  conditions: string[];
}

/** The wrapper's input schema from ioSchema.inputSchema. */
export function planInput(inputSchema: unknown): InputPlan {
  const conditions: string[] = [];
  const headers: Record<string, string> = {};
  const root = isObj(inputSchema) ? inputSchema : {};
  const props = isObj(root.properties) ? root.properties : {};
  const rootRequired = new Set(Array.isArray(root.required) ? (root.required as string[]) : []);
  const outProps: Schema = {};
  const outRequired: string[] = [];

  const part = (key: string, as: string, drop: Set<string>) => {
    const raw = props[key];
    if (!isObj(raw)) return;
    let s = flatten(raw, as, conditions) as Schema;
    s = withoutRequired(s, drop);
    if (!hasKeys(s) && s.additionalProperties !== true) return;
    outProps[as] = s;
    if (rootRequired.has(key) && Array.isArray(s.required) && s.required.length > 0) outRequired.push(as);
  };

  part("body", "body", ONE_BODY_FIELDS);
  part("query", "query", new Set());
  part("path", "pathParams", new Set());
  part("pathParams", "pathParams", new Set());

  const h = props.headers;
  if (isObj(h) && isObj(h.properties)) {
    const keep: Schema = {};
    for (const [name, def] of Object.entries(h.properties)) {
      if (isOneHeader(name.toLowerCase())) continue;
      if (isObj(def) && typeof def.const === "string") {
        headers[name] = def.const;
        continue;
      }
      keep[name] = flatten(def, `headers.${name}`, conditions);
    }
    if (Object.keys(keep).length) {
      const req = (Array.isArray(h.required) ? (h.required as string[]) : []).filter((r) => r in keep);
      outProps.headers = { type: "object", properties: keep, required: req, additionalProperties: { type: "string" } };
      if (req.length) outRequired.push("headers");
    }
  }
  // A body that is not an object (raw string or array) passes through as is.
  if (!outProps.body && props.body && !isObj((props.body as Schema).properties) && (props.body as Schema).type && (props.body as Schema).type !== "object") {
    outProps.body = flatten(props.body, "body", conditions);
    if (rootRequired.has("body")) outRequired.push("body");
  }
  return { schema: { type: "object", properties: outProps, required: outRequired, additionalProperties: false }, headers, conditions };
}

async function toType(schema: unknown, name: string): Promise<string> {
  const ts = await compile(schema as JSONSchema, name, {
    bannerComment: "",
    additionalProperties: false,
    declareExternallyReferenced: true,
    enableConstEnums: false,
    strictIndexSignatures: false,
    unknownAny: true,
    format: true,
    style: { semi: true, singleQuote: false, printWidth: 120 },
  });
  return ts.trim();
}

/**
 * The 2xx shape of an output schema. Catalog outputs are often
 * `anyOf: [success, bad request, provider error]`; `r.data` is only the
 * success one (errors come back with ok: false), so the first member wins.
 */
export function successShape(out: Schema): Schema {
  const members = (Array.isArray(out.anyOf) ? out.anyOf : Array.isArray(out.oneOf) ? out.oneOf : null) as unknown[] | null;
  if (!members?.length || !isObj(members[0])) return out;
  const { anyOf: _a, oneOf: _o, ...rest } = out;
  return { ...rest, ...members[0], description: (members[0] as Schema).description ?? rest.description };
}

const pascal = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const docLine = (s: string) => s.replace(/\*\//g, "* /").replace(/\s+/g, " ").trim();

/** Wrapper names for a list of actions: title-derived, alias on collision. */
export function assignNames(actions: InstalledAction[], titles: Map<string, string>): Map<string, string> {
  const used = new Map<string, Set<string>>();
  const out = new Map<string, string>();
  for (const a of actions) {
    const taken = used.get(a.platform) ?? new Set<string>();
    used.set(a.platform, taken);
    let name = a.alias ?? wrapperName(titles.get(a.actionId) ?? a.actionId);
    if (taken.has(name)) {
      let i = 2;
      while (taken.has(`${name}${i}`)) i++;
      name = `${name}${i}`;
    }
    taken.add(name);
    out.set(a.actionId, name);
  }
  return out;
}

/** Generate server/one/actions.gen.ts for the installed actions. */
export async function generateActions(installed: InstalledAction[], knowledge: (actionId: string) => KnowledgeRow | null): Promise<CodegenResult> {
  const rows = installed.map((a) => ({ a, k: knowledge(a.actionId) }));
  const names = assignNames(installed, new Map(rows.map(({ a, k }) => [a.actionId, k?.title ?? a.actionId])));
  const wrappers: GeneratedWrapper[] = [];
  const warnings: CodegenResult["warnings"] = [];
  const typeBlocks: string[] = [];

  for (const { a, k } of rows) {
    const name = names.get(a.actionId)!;
    const base = `${pascal(platformIdent(a.platform))}${pascal(name)}`;
    const inName = `${base}Input`;
    const outName = `${base}Output`;
    if (!k) {
      warnings.push({ actionId: a.actionId, message: "This action is not in the catalog cache; its wrapper was left out." });
      continue;
    }
    const io = k.ioSchema;
    let inputType: string;
    let headers: Record<string, string> = {};
    let conditions: string[] = [];
    let loose = false;
    if (io && isObj(io.inputSchema)) {
      const plan = planInput(io.inputSchema);
      headers = plan.headers;
      conditions = plan.conditions;
      inputType = await toType(plan.schema, inName);
      typeBlocks.push(inputType);
      if (isObj(io.outputSchema)) typeBlocks.push(await toType(flatten(successShape(io.outputSchema), "", []), outName));
      else typeBlocks.push(`export type ${outName} = unknown;`);
    } else {
      loose = true;
      inputType = `export type ${inName} = ActionInput;`;
      typeBlocks.push(inputType, `export type ${outName} = unknown;`);
      warnings.push({ actionId: a.actionId, message: "No schema for this action; types are loose." });
    }
    wrappers.push({
      actionId: a.actionId,
      platform: a.platform,
      ref: `${platformIdent(a.platform)}.${name}`,
      name,
      title: k.title,
      method: k.method.toUpperCase(),
      path: k.path,
      inputType,
      inputTypeName: inName,
      outputTypeName: outName,
      conditions,
      headers,
      loose,
    });
  }

  const byPlatform = new Map<string, GeneratedWrapper[]>();
  for (const w of wrappers) byPlatform.set(w.platform, [...(byPlatform.get(w.platform) ?? []), w]);

  const objects = [...byPlatform.entries()].map(([platform, ws]) => {
    const entries = ws.map((w) => {
      const lines = [`${w.title}. ${w.method} ${w.path}`, ...(w.loose ? ["No schema for this action; types are loose. Read the docs with one_load_action."] : []), ...w.conditions];
      const doc = lines.length === 1 ? `  /** ${docLine(lines[0]!)} */` : `  /**\n${lines.map((l) => `   * ${docLine(l)}`).join("\n")}\n   */`;
      const hdr = Object.keys(w.headers).length ? `\n    headers: ${JSON.stringify(w.headers)},` : "";
      return `${doc}
  ${w.name}: action<${w.inputTypeName}, ${w.outputTypeName}>({
    platform: ${JSON.stringify(w.platform)},
    actionId: ${JSON.stringify(w.actionId)},
    method: ${JSON.stringify(w.method)},
    path: ${JSON.stringify(w.path)},
    title: ${JSON.stringify(w.title)},${hdr}
  }),`;
    });
    return `export const ${platformIdent(platform)} = {\n${entries.join("\n")}\n};`;
  });

  const code = `// Generated by ${BRAND.name} from One's catalog. Do not edit.
// Add an action with one_add_action <actionId>; it regenerates this file.
/* eslint-disable */

import { action, type ActionInput } from "./index";

void action;
export type { ActionInput };

${objects.join("\n\n")}

// ---- Types from each action's ioSchema --------------------------------

${typeBlocks.join("\n\n")}
`;
  return { code, wrappers, warnings };
}

/** One wrapper's signature and docs for the agent (one_add_action's answer). */
export function describeWrapper(w: GeneratedWrapper, k: KnowledgeRow | null, granted: boolean): string {
  const level = levelFor({ method: w.method, title: w.title, tags: k?.tags });
  const lines = [
    `Added \`${w.ref}\` (${w.title}, ${w.method} ${w.path}, level ${level}) to server/one/actions.gen.ts.`,
    "",
    "Call it from an API route in server/, after requireUser(c):",
    "",
    "```ts",
    `import { one, requireUser } from "./one";`,
    `import { ${platformIdent(w.platform)} } from "./one/actions.gen";`,
    "",
    `await requireUser(c);`,
    `const r = await one(c).run(${w.ref}, { ${exampleInput(w)} });`,
    `if (!r.ok) return c.json(r, r.status as 403);`,
    `// r.data is ${w.outputTypeName}`,
    "```",
    "",
    "Input type:",
    "",
    "```ts",
    w.inputType,
    "```",
  ];
  if (w.conditions.length) lines.push("", "Conditional requirements the type cannot express:", ...w.conditions.map((c) => `- ${c}`));
  if (Object.keys(w.headers).length) lines.push("", `The wrapper sends ${Object.keys(w.headers).join(", ")} itself.`);
  if (w.loose) lines.push("", "No schema for this action; types are loose. Read the docs below for the fields.");
  lines.push("", `Receipt verb: ${verbFor({ method: w.method, path: w.path, platform: w.platform })}.`);
  if (!granted) lines.push("", `Each person grants ${w.platform} to the app when they sign in with One. Keep writing the feature.`);
  if (k?.knowledge) lines.push("", "## Docs", "", digest(k.knowledge, 5000));
  return lines.join("\n");
}

function exampleInput(w: GeneratedWrapper): string {
  const parts: string[] = [];
  if (/\bbody\??:/.test(w.inputType)) parts.push("body: { /* ... */ }");
  if (/\bpathParams\??:/.test(w.inputType)) parts.push("pathParams: { /* ... */ }");
  if (/\bquery\??:/.test(w.inputType)) parts.push("query: { /* ... */ }");
  return parts.join(", ") || "";
}

/** The first part of an action's Markdown docs, cut at a heading when it is long. */
export function digest(md: string, max = 4000): string {
  const cleaned = md.replace(/http:\/\/one-medley/g, "");
  if (cleaned.length <= max) return cleaned;
  const cut = cleaned.lastIndexOf("\n## ", max);
  return `${cleaned.slice(0, cut > max / 2 ? cut : max).trimEnd()}\n\n(Truncated. one_load_action <id> with a section name, such as "Response", gives the rest.)`;
}

/** One section of an action's docs by heading text, case-insensitive. */
export function section(md: string, name: string): string | null {
  const lines = md.split("\n");
  const want = name.toLowerCase();
  const start = lines.findIndex((l) => /^#{1,4}\s/.test(l) && l.toLowerCase().includes(want));
  if (start < 0) return null;
  const level = lines[start]!.match(/^#+/)![0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i]!.match(/^(#+)\s/);
    if (m && m[1]!.length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trim();
}
