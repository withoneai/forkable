// Which environment variables a project's code reads (Node only).
//
// A plain text pass over server/, src/ and api/ (the files the manifest
// reader sees), for `process.env.X`, `process.env["X"]`, `c.env.X`,
// `c.env["X"]`, `const { X } = c.env` and `import.meta.env.VITE_X`. The
// template's own Connect client (server/one/) is left out: the platform
// knows what it reads. Names the platform or the host sets are dropped.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { reservedAppVar } from "./envvars.js";

export interface EnvSite {
  file: string;
  line: number;
}

export interface EnvRef {
  name: string;
  sites: EnvSite[];
  /** Read in browser code (import.meta.env), so the value ends up in the page. */
  client: boolean;
}

function walk(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".") || name === "dist") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(tsx?|mts|cts|jsx?|mjs)$/.test(name) && !/\.d\.ts$/.test(name) && st.size < 1_000_000) out.push(p);
  }
}

const OBJ = String.raw`(?:process|c|ctx|context)\.env`;
const DIRECT = new RegExp(String.raw`\b${OBJ}\s*(?:\.\s*([A-Z][A-Z0-9_]*)\b|\[\s*["'\x60]([A-Z][A-Z0-9_]*)["'\x60]\s*\])`, "g");
const DESTRUCT = new RegExp(String.raw`\{([^{}]{1,600})\}\s*=\s*${OBJ}\b`, "g");
const VITE = /\bimport\.meta\.env\.(VITE_[A-Z0-9_]+)\b/g;

/** Every env name the code reads, with file:line for each read. Sorted by name. */
export function scanEnvRefs(projectDir: string): EnvRef[] {
  const files: string[] = [];
  for (const d of ["server", "src", "api"]) walk(join(projectDir, d), files);
  const refs = new Map<string, EnvRef>();
  const add = (name: string, file: string, line: number, client: boolean) => {
    if (reservedAppVar(name)) return;
    const r = refs.get(name) ?? { name, sites: [], client: false };
    if (!r.sites.some((s) => s.file === file && s.line === line)) r.sites.push({ file, line });
    r.client ||= client;
    refs.set(name, r);
  };
  for (const abs of files) {
    const rel = relative(projectDir, abs).split("\\").join("/");
    if (rel.startsWith("server/one/")) continue;
    let text: string;
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const lineAt = (i: number) => text.slice(0, i).split("\n").length;
    // A mention in a line comment (`// reads c.env.X`) is not a read.
    const inComment = (i: number) => /\/\/|^\s*\*/.test(text.slice(text.lastIndexOf("\n", i) + 1, i));
    for (const m of text.matchAll(DIRECT)) if (!inComment(m.index!)) add((m[1] ?? m[2])!, rel, lineAt(m.index!), false);
    for (const m of text.matchAll(DESTRUCT)) {
      for (const part of m[1]!.split(",")) {
        const n = /^\s*([A-Z][A-Z0-9_]*)\s*(?::|=|$)/.exec(part)?.[1];
        if (n) add(n, rel, lineAt(m.index!), false);
      }
    }
    for (const m of text.matchAll(VITE)) add(m[1]!, rel, lineAt(m.index!), true);
  }
  return [...refs.values()].sort((a, b) => a.name.localeCompare(b.name));
}
