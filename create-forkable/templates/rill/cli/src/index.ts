#!/usr/bin/env node
// `rill`         start the server and open the browser
// `rill demo`    the keyless demo: sample inbox, lanes, brief, receipt, exit 0
// `rill record`  re-judge the sample inbox with a live Jev and write fixtures/recorded
import { spawn } from "node:child_process";
import { actionLabel, calendar, calendarReceiptDemo, fixtures, getMailProvider, ledger, platformLabel, sync, writer, one, type Lane, type LedgerRow } from "@rill/core";
import {
  bootDatabase, buildCtx, codeOnlyBrief, createConnect, createHub, createScheduler, ensureDemoUser, ensureSampleMailbox, findInjectionMessage, inboxRows, latestConnectedUser,
  laneCounts, loadEnv, localDate, maskDatabaseUrl, resetJudgments, startServer, unjudgedCount, VERSION, type Deps,
} from "@rill/server";

const LANE_ORDER: Lane[] = ["vip", "goals", "reply", "other", "screener"];
const LANE_TITLE: Record<Lane, string> = { vip: "VIP", goals: "Goals", reply: "Reply", other: "Other", screener: "Screener" };
const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const openBrowser = (url: string) => {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
};

async function demoDeps(): Promise<{ deps: Deps; stop: () => Promise<void> }> {
  const env = loadEnv();
  const database = await bootDatabase(env, (l) => console.log(`  ${l}`));
  const oneConnect = createConnect(env, database.db);
  const hub = createHub();
  const scheduler = createScheduler({ db: database.db, env, oneConnect, hub });
  const deps: Deps = {
    db: database.db, env, oneConnect, hub, scheduler, connectSetup: null, version: VERSION,
    dbInfo: { kind: database.kind, url: maskDatabaseUrl(database.url), dataDir: database.dataDir },
  };
  return { deps, stop: () => database.stop() };
}

const receiptLine = (row: LedgerRow) =>
  `${platformLabel(row.platform)} · ${actionLabel(row.action)}   ${row.blockedByGrant ? "declined" : row.ok ? "ok" : "failed"}, ${row.status}`;

async function demo(): Promise<void> {
  console.log(`Rill ${VERSION} · the Acme sample inbox, no keys needed\n`);
  const { deps, stop } = await demoDeps();
  try {
    const user = await ensureDemoUser(deps.db);
    const mailbox = await ensureSampleMailbox(deps, user);
    const ctx = await buildCtx(deps, mailbox, user);
    await sync.syncMailbox(ctx);
    await sync.judgePending(ctx);
    const calSync = await calendar.syncCalendar(ctx);

    const rows = await inboxRows(deps.db, mailbox.id);
    const counts = await laneCounts(deps.db, mailbox.id);
    for (const lane of LANE_ORDER) {
      const inLane = rows.filter((r) => r.lane === lane);
      console.log(`${LANE_TITLE[lane]} (${counts[lane]})`);
      for (const r of inLane) {
        const chip = r.vip ? `[${r.vip.name}]` : r.goal ? `[${r.goal.title}]` : "";
        const check = r.check ? "  Check" : "";
        console.log(`  ${pad(LANE_TITLE[lane].toUpperCase(), 9)}${pad(String(r.priority), 4)} ${pad(r.from.name || r.from.email, 18)} ${pad(r.subject, 44)} ${chip}${check}`);
      }
      if (inLane.length === 0) console.log("  (empty)");
      console.log("");
    }

    const brief = await codeOnlyBrief(ctx, localDate(ctx.settings.timezone));
    console.log("Brief");
    for (const k of brief.kpis) console.log(`  ${pad(k.label, 16)}${k.value}`);
    console.log("");

    const calTotal = await calendar.windowFor(ctx, new Date(Date.now() - 30 * 864e5).toISOString(), new Date(Date.now() + 90 * 864e5).toISOString());
    void calSync;
    console.log(`Calendar: ${calTotal.calendars.length} calendar, ${calTotal.events.length} events, ${brief.today.meetings.length} today`);
    for (const m of brief.today.meetings) {
      const time = new Date(m.start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: m.timeZone ?? ctx.settings.timezone ?? undefined });
      console.log(`  ${pad(time, 10)}${pad(m.title, 40)}${m.needsRsvp ? "  needs RSVP" : ""}`);
    }
    console.log("");

    console.log("Ledger (last 8)");
    for (const row of (await ledger.list(deps.db, mailbox.id, 8)).reverse()) {
      console.log(`  ${row.at.slice(11, 19)}  ${pad(row.platform, 16)}${pad(row.action, 24)}${pad(row.mode, 9)}${row.status}${row.blockedByGrant ? "  blocked by grant" : ""}`);
    }
    console.log("");

    console.log("Receipts");
    const hidden = await findInjectionMessage(deps.db, mailbox.id);
    if (hidden) {
      const row = await getMailProvider(ctx.mailbox.mailProvider).attemptDelete(ctx, hidden.gmailId, "Hidden text in an email asked the assistant to delete the inbox");
      console.log(`  ${receiptLine(row)}`);
      console.log(`  ${row.note ?? "Delete is not in the grant. Gmail was never called."}`);
    } else {
      console.log("  Gmail: no email with hidden text in the fixtures.");
    }
    const calRow = await calendarReceiptDemo(ctx);
    if (calRow) {
      console.log(`  ${receiptLine(calRow)}`);
      console.log(`  ${calRow.note ?? "Delete is not in the grant. Google Calendar was never called."}`);
    } else {
      console.log("  Google Calendar: no synced event to demo against.");
    }
    console.log("\nRun `rill` to open the inbox in your browser.");
  } finally {
    await stop();
  }
}

async function record(): Promise<void> {
  process.env.RECORD = "1";
  const { deps, stop } = await demoDeps();
  try {
    const env = deps.env;
    // Recording runs on a real grant: the most recent user who signed in with One
    // and granted TypeSafe. There is no key mode and no secret in .env.
    const user = await latestConnectedUser(deps.db);
    if (!user || !deps.oneConnect) {
      console.error("Recording needs a user who signed in with One. Start `rill`, sign in with One, grant TypeSafe, then run `rill record` again.");
      process.exitCode = 1;
      return;
    }
    const mailbox = await ensureSampleMailbox(deps, user);
    const ctx = await buildCtx(deps, mailbox, user);
    if (!(await one.jevAvailable(ctx))) {
      console.error(`${user.email ?? user.id} has not granted TypeSafe to Rill. Reconnect in One with TypeSafe included.`);
      process.exitCode = 1;
      return;
    }
    const w = await writer.pickWriter(ctx, await writer.detectEngines(env, [...(await one.grantedConnections(deps.oneConnect, user.id)).keys()]));
    if (!w) {
      console.error("No usable writer. Sign in to a coding CLI or set a One LLM connection.");
      process.exitCode = 1;
      return;
    }
    console.log(`Recording with Jev and ${w.provider} (${w.model})`);
    await resetJudgments(deps.db, mailbox.id);
    const r = await sync.judgePending(ctx);
    const inbox = fixtures.loadInbox(env.ROOT);
    const recorded = inbox.threads.filter((t) => fixtures.readRecording(env.ROOT, t.id) !== null).length;
    console.log(`Judged ${r.judged}, failed ${r.failed}. ${recorded} of ${inbox.threads.length} threads have recordings.`);
    if ((await unjudgedCount(deps.db, mailbox.id)) > 0) console.log("Some messages are still unjudged. Run again to finish.");
  } finally {
    await stop();
  }
}

async function serveAndOpen(): Promise<void> {
  const started = await startServer();
  openBrowser(started.url);
  const shutdown = () => started.stop().then(() => process.exit(0), () => process.exit(1));
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

const cmd = process.argv[2] ?? "";
const run = cmd === "demo" ? demo() : cmd === "record" ? record() : cmd === "" || cmd === "start" ? serveAndOpen() : Promise.reject(new Error(`Unknown command "${cmd}". Use: rill, rill demo, rill record.`));
run.catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
