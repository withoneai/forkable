import { readFileSync, realpathSync, statSync } from "node:fs";
import type { ModelOption } from "../api-types.js";
import type { DetectedCli } from "../contract.js";

// Which models each engine can be asked for, labeled the provider's way.
// Claude Code carries Anthropic's catalog inside its bundle (ids, families,
// display names, newest per family); there is no `claude models` command, so
// the list is read out of the installed binary the way its own /model picker
// does, and re-read when the binary changes (it auto-updates). The others are
// short static tiers until a listing command exists for them.

const FAMILY_ORDER = ["fable", "opus", "sonnet", "haiku"];
const FAMILY_HINT: Record<string, string> = { fable: "Most capable", opus: "Powerful", sonnet: "Balanced", haiku: "Fastest" };
const MAX_BUNDLE_BYTES = 512 * 1024 * 1024;

const STATIC: Record<string, ModelOption[]> = {
  codex: [
    { id: "default", label: "Codex default" },
    { id: "gpt-5-codex", label: "GPT-5 Codex", hint: "Balanced" },
    { id: "gpt-5", label: "GPT-5", hint: "Powerful" },
    { id: "gpt-5-mini", label: "GPT-5 mini", hint: "Fastest" },
  ],
  "gemini-cli": [
    { id: "default", label: "Gemini default" },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", hint: "Powerful" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", hint: "Fastest" },
  ],
  anthropic: [
    { id: "claude-opus-5-5", label: "Opus 5.5", hint: "Powerful" },
    { id: "claude-sonnet-5-5", label: "Sonnet 5.5", hint: "Balanced" },
    { id: "claude-haiku-5-5", label: "Haiku 5.5", hint: "Fastest" },
  ],
  openai: [
    { id: "gpt-5", label: "GPT-5", hint: "Powerful" },
    { id: "gpt-5-mini", label: "GPT-5 mini", hint: "Fastest" },
  ],
  gemini: [
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", hint: "Powerful" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", hint: "Fastest" },
  ],
};

let claudeCache: { stamp: string; models: ModelOption[] } | null = null;

/** Exported for tests: the catalog literal out of bundle text, newest model per family. */
export function parseClaudeCatalog(text: string): ModelOption[] {
  const latest = /latest_per_family:\{([^}]*)\}/.exec(text)?.[1] ?? "";
  const latestByFamily = new Map<string, string>();
  for (const m of latest.matchAll(/([a-z0-9_]+):"([^"]+)"/g)) latestByFamily.set(m[1]!, m[2]!);
  const names = new Map<string, string>();
  for (const m of text.matchAll(/\{id:"(claude-[^"]+)",family:"[^"]+",display_name:"([^"]+)"/g)) names.set(m[1]!, m[2]!);
  if (!latestByFamily.size || !names.size) return [];
  const families = [...latestByFamily.keys()].sort((a, b) => {
    const ia = FAMILY_ORDER.indexOf(a);
    const ib = FAMILY_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  const out: ModelOption[] = [];
  for (const family of families) {
    const id = latestByFamily.get(family)!;
    const label = names.get(id);
    if (label) out.push({ id, label, hint: FAMILY_HINT[family] ?? "" });
  }
  return out;
}

/** Anthropic's current catalog as the installed `claude` knows it; static tiers when it cannot be read. */
export function claudeModels(bin: string | null): ModelOption[] {
  try {
    if (!bin) throw new Error("no claude binary");
    const real = realpathSync(bin);
    const st = statSync(real);
    const stamp = `${real}:${st.size}:${st.mtimeMs}`;
    if (claudeCache?.stamp === stamp) return claudeCache.models;
    if (st.size > MAX_BUNDLE_BYTES) throw new Error("bundle too large to scan");
    const bytes = readFileSync(real);
    const anchor = bytes.indexOf("latest_per_family:{");
    if (anchor < 0) throw new Error("no catalog in bundle");
    const window = bytes.subarray(Math.max(0, anchor - 128 * 1024), Math.min(bytes.length, anchor + 4096)).toString("latin1");
    const models = parseClaudeCatalog(window);
    if (!models.length) throw new Error("catalog did not parse");
    claudeCache = { stamp, models };
    return models;
  } catch {
    return STATIC.anthropic!;
  }
}

/** Models a local CLI can be asked for. */
export function localModels(id: DetectedCli["id"], bin: string | null): ModelOption[] {
  if (id === "claude-code") return claudeModels(bin);
  return STATIC[id] ?? [];
}

/** Models a provider through One can be asked for (the Anthropic list follows the installed claude when there is one). */
export function oneModels(provider: "anthropic" | "openai" | "gemini", claudeBin: string | null): ModelOption[] {
  if (provider === "anthropic") return claudeModels(claudeBin);
  return STATIC[provider] ?? [];
}
