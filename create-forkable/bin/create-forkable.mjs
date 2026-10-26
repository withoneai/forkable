#!/usr/bin/env node
// npm create forkable@latest <name> [--for "<who>"] [--in "<where>"] [--template <id>]
//
// Copies a template (the forkable-starter by default), fills in
// local/profile.md, makes a fresh git history, installs, and runs the
// keyless demo. No account and no keys needed for any of that.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

function printHelp() {
  console.log(`Usage: npm create forkable@latest <name> [options]

  <name>              Directory and project name for the new fork.

Options:
  --for <who>         Who this fork is for, e.g. "real estate agents".
  --in <where>        Where, e.g. "Los Angeles". Written into local/profile.md.
  --template <id>     Template to copy. Default: forkable-starter.
  -h, --help          Show this help.

Example:
  npm create forkable@latest rill --for "real estate agents" --in "Los Angeles"`);
}

function slugify(input) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "forkable-app";
}

function parseArgs(argv) {
  const out = { name: null, for: null, in: null, template: "forkable-starter" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") {
      printHelp();
      process.exit(0);
    } else if (a === "--for") {
      out.for = argv[++i] ?? null;
    } else if (a === "--in") {
      out.in = argv[++i] ?? null;
    } else if (a === "--template") {
      out.template = argv[++i] ?? out.template;
    } else if (!a.startsWith("-") && !out.name) {
      out.name = a;
    } else {
      console.error(`create-forkable: unknown argument "${a}"\n`);
      printHelp();
      process.exit(1);
    }
  }
  return out;
}

function run(command, args, options) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function fillPlaceholders(content, values) {
  let out = content;
  for (const [key, value] of Object.entries(values)) {
    out = out.replaceAll(`{{${key}}}`, value);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.name) {
    printHelp();
    process.exit(1);
  }

  const slug = slugify(args.name);
  const targetDir = resolve(process.cwd(), slug);
  if (existsSync(targetDir)) {
    console.error(`create-forkable: ${targetDir} already exists. Pick a different name or remove it first.`);
    process.exit(1);
  }

  const templateDir = join(packageRoot, "templates", args.template);
  if (!existsSync(templateDir)) {
    console.error(`create-forkable: no template named "${args.template}". Available: forkable-starter.`);
    process.exit(1);
  }

  console.log(`Forking ${args.template} into ./${slug}\n`);
  mkdirSync(targetDir, { recursive: true });
  cpSync(templateDir, targetDir, { recursive: true });

  // package.json: rename.
  const pkgPath = join(targetDir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.name = slug;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

  // forkable.json: rename, and record lineage.
  const forkableJsonPath = join(targetDir, "forkable.json");
  let starterVersion = "0.0.0";
  if (existsSync(forkableJsonPath)) {
    const forkableJson = JSON.parse(readFileSync(forkableJsonPath, "utf8"));
    starterVersion = forkableJson.starter ?? starterVersion;
    forkableJson.name = slug;
    forkableJson.forkedFrom = `${args.template}@${starterVersion}`;
    writeFileSync(forkableJsonPath, `${JSON.stringify(forkableJson, null, 2)}\n`);
  }

  // local/profile.md: fill in who this fork is for, and where.
  const profilePath = join(targetDir, "local", "profile.md");
  if (existsSync(profilePath)) {
    const forValue = args.for ?? '(not set - rerun with --for "<who this is for>")';
    const inValue = args.in ?? '(not set - rerun with --in "<where>")';
    const filled = fillPlaceholders(readFileSync(profilePath, "utf8"), { FOR: forValue, IN: inValue });
    writeFileSync(profilePath, filled);
  }

  // A fresh git history, so a fork never carries the starter's own commits.
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME ?? "Forkable",
    GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL ?? "noreply@forkable.dev",
    GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME ?? "Forkable",
    GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL ?? "noreply@forkable.dev",
  };
  run("git", ["init", "-q"], { cwd: targetDir });
  run("git", ["add", "-A"], { cwd: targetDir });
  run("git", ["commit", "-q", "-m", `Forked from ${args.template}@${starterVersion}`], { cwd: targetDir, env: gitEnv });

  console.log("\nInstalling dependencies...\n");
  const installStatus = run(npmCmd, ["install"], { cwd: targetDir });
  if (installStatus !== 0) {
    console.error("\ncreate-forkable: npm install failed. Fix that, then run `npm start` in the new directory.");
    process.exit(installStatus);
  }

  console.log("\nRunning the keyless demo...\n");
  const demoStatus = run(npmCmd, ["start"], { cwd: targetDir });
  if (demoStatus !== 0) {
    console.error(`\ncreate-forkable: the demo exited ${demoStatus}. The fork is still at ./${slug}; see its README.`);
    process.exit(demoStatus);
  }

  console.log(`\n./${slug} is ready. cd ${slug}, then see its AGENTS.md and README.md for next steps.`);
}

main();
