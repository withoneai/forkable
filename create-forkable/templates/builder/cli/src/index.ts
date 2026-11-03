import { BRAND, VERSION } from "@builder/core";

const [cmd = "start", ...rest] = process.argv.slice(2);

async function main(): Promise<number> {
  switch (cmd) {
    case "demo":
      return (await import("./demo.js")).demo(rest);
    case "doctor":
      return (await import("./doctor.js")).doctor(rest);
    case "start":
      return (await import("./start.js")).start(rest);
    case "--version":
    case "-v":
      console.log(VERSION);
      return 0;
    default:
      console.log(`${BRAND.name} ${VERSION}\n\nUsage: ${BRAND.slug} <start|demo|doctor>`);
      return cmd === "help" || cmd === "--help" ? 0 : 2;
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error((err as Error).stack ?? err);
    process.exit(1);
  },
);
