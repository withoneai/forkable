// The one path grammar (ported from the One CLI's resolveIdentityPath, mem-writer.ts:484-549,
// plus negative indexes and quoted keys): a.b | a.0 | a[0] | a[-1] | a[] | a[name=From] |
// a["@odata.nextLink"] (a key that contains dots). Browser-safe.

export type PathToken =
  | { type: "field"; name: string }
  | { type: "index"; i: number }
  | { type: "wild" }
  | { type: "filter"; field: string; value: string };

const cache = new Map<string, PathToken[]>();

export class PathSyntaxError extends Error {}

export function tokenizePath(path: string, strict = false): PathToken[] {
  const hit = cache.get(path);
  if (hit && !strict) return hit;
  const tokens: PathToken[] = [];
  const re = /([^.[\]]+)|\[([^\]]*)\]|(\.)/g;
  let m: RegExpExecArray | null;
  let consumed = 0;
  while ((m = re.exec(path)) !== null) {
    consumed += m[0].length;
    if (m[3] !== undefined) continue;
    if (m[1] !== undefined) {
      tokens.push({ type: "field", name: m[1] });
    } else {
      const inner = (m[2] ?? "").trim();
      if (/^(["']).*\1$/.test(inner)) tokens.push({ type: "field", name: inner.slice(1, -1) });
      else if (inner === "") tokens.push({ type: "wild" });
      else if (/^-?\d+$/.test(inner)) tokens.push({ type: "index", i: Number(inner) });
      else {
        const eq = inner.indexOf("=");
        if (eq > 0) {
          tokens.push({ type: "filter", field: inner.slice(0, eq).trim(), value: inner.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "") });
        } else if (strict) throw new PathSyntaxError(`bad bracket [${inner}] in ${path}`);
      }
    }
  }
  if (strict && (consumed !== path.length || tokens.length === 0)) throw new PathSyntaxError(`cannot parse path "${path}"`);
  if (strict && /\[[^\]]*$/.test(path)) throw new PathSyntaxError(`unclosed [ in ${path}`);
  if (!strict) cache.set(path, tokens);
  return tokens;
}

/** Returns true when `path` parses. */
export function isValidPath(path: string): boolean {
  try { tokenizePath(path, true); return true; } catch { return false; }
}

/** Resolve a path to a flat list of values (undefined and null dropped). */
export function resolvePath(root: unknown, path: string): unknown[] {
  if (path === "" || path === "$" || path === ".") return root === undefined || root === null ? [] : [root];
  let frontier: unknown[] = [root];
  for (const tok of tokenizePath(path)) {
    const next: unknown[] = [];
    for (const cur of frontier) {
      if (cur === null || cur === undefined) continue;
      if (tok.type === "field") {
        if (Array.isArray(cur)) {
          if (/^-?\d+$/.test(tok.name)) next.push(at(cur, Number(tok.name)));
        } else if (typeof cur === "object") {
          next.push((cur as Record<string, unknown>)[tok.name]);
        }
      } else if (tok.type === "index") {
        if (Array.isArray(cur)) next.push(at(cur, tok.i));
      } else if (tok.type === "wild") {
        if (Array.isArray(cur)) next.push(...cur);
        else if (typeof cur === "object") next.push(...Object.values(cur as Record<string, unknown>));
      } else if (Array.isArray(cur) || typeof cur === "object") {
        // [k=v] filters array elements, or an object's values (Notion properties keyed by column)
        for (const el of Array.isArray(cur) ? cur : Object.values(cur as Record<string, unknown>)) {
          if (el && typeof el === "object" && String((el as Record<string, unknown>)[tok.field] ?? "").toLowerCase() === tok.value.toLowerCase()) next.push(el);
        }
      }
    }
    frontier = next;
  }
  return frontier.filter((v) => v !== undefined && v !== null);
}

function at(arr: unknown[], i: number): unknown {
  return i < 0 ? arr[arr.length + i] : arr[i];
}

/** First value of a path, or undefined. */
export function getPath(root: unknown, path: string): unknown {
  return resolvePath(root, path)[0];
}

/** One value: undefined for none, the value for one, the list for many. */
export function pathValue(root: unknown, path: string): unknown {
  const v = resolvePath(root, path);
  return v.length === 0 ? undefined : v.length === 1 ? v[0] : v;
}

/** Writes `value` at a plain dot path (a.b.c), creating objects. Used for body:<path> pagination. */
export function setPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur: Record<string, unknown> = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]!;
    if (typeof cur[k] !== "object" || cur[k] === null) cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}
