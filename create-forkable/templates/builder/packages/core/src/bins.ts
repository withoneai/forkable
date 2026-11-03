import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Small resolver for the tools the platform itself runs (pnpm, git). The
// harness package owns the full resolver for coding agents.

const cache = new Map<string, string>();

function executable(p: string): boolean {
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function findBin(name: string): Promise<string | null> {
  if (cache.has(name)) return cache.get(name)!;
  const dirs = [
    ...(process.env.PATH ?? "").split(":"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    join(homedir(), ".local", "bin"),
    join(homedir(), "Library", "pnpm"),
  ];
  for (const d of dirs) {
    if (!d) continue;
    const p = join(d, name);
    if (executable(p)) {
      cache.set(name, p);
      return p;
    }
  }
  const viaShell = await new Promise<string | null>((resolve) => {
    execFile(process.env.SHELL || "/bin/zsh", ["-ilc", `command -v ${name}`], { timeout: 4000 }, (_e, out) => {
      const last = String(out ?? "").trim().split("\n").pop() ?? "";
      resolve(last.startsWith("/") && executable(last) ? last : null);
    });
  });
  if (viaShell) cache.set(name, viaShell);
  return viaShell;
}
