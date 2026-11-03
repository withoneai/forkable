// The hero demo's script: two prompts on the Acme Inc sample, the steps the
// agent takes, the app it makes and where it publishes. Nothing here calls
// the network; the steps mirror the editor's own tool cards.

export type Step = { kind: "find" | "add" | "write" | "run"; verb: string; detail: string };

export type Demo = {
  project: string;
  prompt: string;
  steps: Step[];
  summary: string;
  version: { subject: string; files: number; plus: number; minus: number };
  connect: { slug: string; name: string }[];
  url: string;
  app: "crm" | "digest";
};

export const DEMOS: Demo[] = [
  {
    project: "acme-crm",
    prompt: "A customer list for Acme that shows each customer's latest Gmail threads",
    steps: [
      { kind: "find", verb: "Looked up Gmail actions", detail: "list my latest threads" },
      { kind: "add", verb: "Added a Gmail action", detail: "listAndViewEmailThreads" },
      { kind: "write", verb: "Wrote", detail: "server/customers.ts" },
      { kind: "write", verb: "Wrote", detail: "src/App.tsx" },
      { kind: "run", verb: "Ran", detail: "pnpm typecheck" },
    ],
    summary: "Customers now show their latest Gmail threads, read on the signed-in person's own Gmail.",
    version: { subject: "Customer list with Gmail threads", files: 6, plus: 412, minus: 3 },
    connect: [{ slug: "gmail", name: "Gmail" }],
    url: "acme-crm.vercel.app",
    app: "crm",
  },
  {
    project: "revenue-digest",
    prompt: "Every morning, post yesterday's Stripe payments to #revenue in Slack",
    steps: [
      { kind: "find", verb: "Looked up Stripe actions", detail: "list charges" },
      { kind: "find", verb: "Looked up Slack actions", detail: "send a message" },
      { kind: "write", verb: "Wrote", detail: "server/digest.ts" },
      { kind: "write", verb: "Wrote", detail: "src/App.tsx" },
      { kind: "run", verb: "Ran", detail: "pnpm typecheck" },
    ],
    summary: "A daily digest of yesterday's payments, posted to #revenue at 8:00 AM.",
    version: { subject: "Daily Stripe digest to Slack", files: 5, plus: 286, minus: 2 },
    connect: [
      { slug: "stripe", name: "Stripe" },
      { slug: "slack", name: "Slack" },
    ],
    url: "revenue-digest.vercel.app",
    app: "digest",
  },
];

export const CUSTOMERS = [
  { name: "Priya Shah", company: "Globex", initials: "PS", thread: "Re: Renewal terms for 2027", time: "2h" },
  { name: "Marco Ruiz", company: "Initech", initials: "MR", thread: "Pilot kickoff, Thursday?", time: "5h" },
  { name: "Dana Lee", company: "Umbrella", initials: "DL", thread: "Invoice #1042 question", time: "1d" },
  { name: "Sam Okafor", company: "Hooli", initials: "SO", thread: "Intro: Acme x Hooli", time: "2d" },
];

export const PAYMENTS = [
  { who: "Globex", amount: "$4,800.00", time: "11:42 PM" },
  { who: "Initech", amount: "$2,150.00", time: "6:10 PM" },
  { who: "Umbrella", amount: "$1,290.00", time: "2:03 PM" },
  { who: "Hooli", amount: "$640.00", time: "9:27 AM" },
];

export const CHECKS = ["Typecheck", "Build", "No secrets in the code", "Manifest matches the code", "pnpm audit"];
