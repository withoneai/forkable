import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// agents/hello.md is the spec for this code: what it reads, what it may
// never do, and why. Keep the two in sync when either one changes.

export interface Message {
  id: string;
  from: string;
  subject: string;
  snippet: string;
}

export interface Receipt {
  platform: string;
  action: string;
  ok: boolean;
  blockedByGrant: boolean;
  status: number;
  note: string;
}

interface Fixture {
  company: string;
  sampleMailbox: string;
  messages: Message[];
}

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, "..", "fixtures", "acme.json");

export function loadFixture(): Fixture {
  return JSON.parse(readFileSync(fixturePath, "utf8"));
}

export function receiptLine(r: Receipt): string {
  const result = r.blockedByGrant ? "declined" : r.ok ? "ok" : "failed";
  return `${r.platform} · ${r.action}   ${result}, ${r.status}`;
}

// The hello agent: read the sample inbox, then try the one action the
// manifest marks "write" (gmail-delete-message) to show it come back
// declined. A real fork grants the write action it actually needs and
// removes this refusal step.
export function runHelloAgent(fixture: Fixture): { messages: Message[]; receipt: Receipt } {
  const receipt: Receipt = {
    platform: "Gmail",
    action: "delete-message",
    ok: false,
    blockedByGrant: true,
    status: 403,
    note: "Delete is not in this fork's grant. Gmail was never called.",
  };
  return { messages: fixture.messages, receipt };
}
