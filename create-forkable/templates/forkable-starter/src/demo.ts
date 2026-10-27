// The keyless demo: the Acme Inc sample inbox, no account and no keys
// needed. Shows the hello agent reading the sample, then declined on the
// one action outside its grant. Exits 0.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFixture, receiptLine, runHelloAgent } from "./hello-agent.js";

const here = dirname(fileURLToPath(import.meta.url));
const pkgName = (JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as { name: string }).name;

function main(): void {
  const fixture = loadFixture();
  console.log(`${pkgName} · the ${fixture.company} sample inbox, no keys needed\n`);

  const { messages, receipt } = runHelloAgent(fixture);

  console.log(`Inbox (${messages.length})`);
  for (const m of messages) {
    console.log(`  ${m.from.padEnd(28)} ${m.subject}`);
  }
  console.log("");

  console.log("Receipt");
  console.log(`  ${receiptLine(receipt)}`);
  console.log(`  ${receipt.note}`);
  // create-forkable prints its own next steps right after this.
  if (!process.env.FORKABLE_CREATE) console.log("\nRun `npm run dev` to sign in with One and connect your own tools.");
}

main();
