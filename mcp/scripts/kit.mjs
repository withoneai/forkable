import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

// Three UIs built with the kit (@forkable/ui), rendered through the test host
// (pnpm harness + wrangler dev in sample mode), in light and dark: the
// ui_guide example dashboard, a form with a write, and a list. Each must
// pass the style check, render without errors, and every write must still
// stop at the shell's Confirm. Screenshots go to docs/qa/kit-*.png.
const GET_THREADS = "conn_mod_def::GGSNlnppgZ0::qk3CudDWTVKPY7hpPVCqLQ";
const CREATE_DRAFT = "conn_mod_def::GGZUe0SIuk8::nhwEKp2cQ6uARsH3513VeQ";
const SEND = "conn_mod_def::GGXAjWkZO8U::uMc1LQIHTTKzeMm3rLL5gQ";
const OUT = new URL("../docs/qa/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const themes = process.env.THEME ? [process.env.THEME] : ["dark", "light"];

export const formCode = `
import { useState } from "react";
import { runAction, Page, Card, Field, Input, Textarea, Select, Button, Toolbar, Spacer } from "@forkable/ui";
import { Send } from "lucide-react";
const SEND = "${SEND}";
const valid = (s: string) => /^[^@\\s]+@[^@\\s]+$/.test(s);
export default function QuickEmail() {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [tone, setTone] = useState("Friendly");
  const [body, setBody] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState("");
  const send = async () => {
    setTried(true);
    if (!valid(to) || !body.trim()) return;
    setBusy(true);
    try {
      const r = await runAction(SEND, { body: { to, subject, body } });
      setOut("Sent. Message id " + r.id + ".");
    } catch (e: any) {
      setOut(e.refused === "cancelled" ? "Not sent. You cancelled it." : e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page title="Quick email" description="Sends from your Gmail. You confirm before it goes out.">
      <Card>
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="To" required error={tried && !valid(to) ? "Enter one email address." : undefined}>
              <Input type="email" placeholder="name@acme.test" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
            <Field label="Tone" hint="A note for you. It is not sent.">
              <Select options={["Friendly", "Formal", "Short"]} value={tone} onChange={(e) => setTone(e.target.value)} />
            </Field>
          </div>
          <Field label="Subject">
            <Input placeholder="What it is about" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>
          <Field label="Message" error={tried && !body.trim() ? "Write a message first." : undefined}>
            <Textarea rows={5} placeholder="Write it the way you would say it" value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
        </div>
      </Card>
      <Toolbar>
        {out && <span role="status" data-testid="out" className="text-13 text-muted-foreground">{out}</span>}
        <Spacer />
        <Button onClick={() => { setTo(""); setSubject(""); setBody(""); setTried(false); setOut(""); }}>Clear</Button>
        <Button variant="primary" loading={busy} onClick={send}><Send />Send</Button>
      </Toolbar>
    </Page>
  );
}`;

export const listCode = `
import { useState } from "react";
import { useAction, timeAgo, Page, Section, Toolbar, Spacer, Tabs, Input, List, Row, EmptyState, ErrorState, Skeleton, Avatar, AppLogo, Badge, Button } from "@forkable/ui";
import { Search, Users } from "lucide-react";
const GET_THREADS = "${GET_THREADS}";
type T = { id: string; subject: string; date: string; unread: boolean; from: { name: string; email: string } };
type Sender = { name: string; email: string; count: number; unread: number; date: string; subject: string };
export default function Senders() {
  const { data, loading, error, reload } = useAction<{ threads: T[] }>(GET_THREADS, { body: { query: "in:inbox", numberOfThreads: 30 } });
  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState("");
  const by = new Map<string, Sender>();
  for (const t of data?.threads ?? []) {
    const s = by.get(t.from.email) ?? { name: t.from.name, email: t.from.email, count: 0, unread: 0, date: t.date, subject: t.subject };
    s.count += 1;
    if (t.unread) s.unread += 1;
    if (t.date > s.date) { s.date = t.date; s.subject = t.subject; }
    by.set(t.from.email, s);
  }
  const all = [...by.values()].sort((a, b) => b.count - a.count || b.date.localeCompare(a.date));
  const pool = tab === "unread" ? all.filter((s) => s.unread > 0) : all;
  const shown = pool.filter((s) => (s.name + " " + s.email).toLowerCase().includes(q.toLowerCase()));
  return (
    <Page title="Who writes to you" description="Senders in your inbox, most active first." icon={<AppLogo platform="gmail" size="lg" />}>
      <Toolbar>
        <Tabs value={tab} onChange={setTab} tabs={[{ id: "all", label: "Everyone", count: all.length }, { id: "unread", label: "Unread", count: all.filter((s) => s.unread > 0).length }]} />
        <Spacer />
        <Input leading={<Search />} placeholder="Find a sender" aria-label="Find a sender" value={q} onChange={(e) => setQ(e.target.value)} className="w-48" />
      </Toolbar>
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading ? (
        <div className="flex flex-col gap-2"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
      ) : (
        <List empty={<EmptyState icon={<Users />} title="No senders match" description="Clear the search to see everyone." action={<Button variant="secondary" size="sm" onClick={() => setQ("")}>Clear search</Button>} />}>
          {shown.slice(0, 6).map((s) => (
            <Row
              key={s.email}
              leading={<Avatar name={s.name} />}
              title={s.name}
              meta={s.subject}
              strong={s.unread > 0}
              selected={sel === s.email}
              onClick={() => setSel(s.email)}
              trailing={<>{s.unread > 0 && <Badge variant="accent">{s.unread} unread</Badge>}<Badge>{s.count} {s.count === 1 ? "thread" : "threads"}</Badge><span className="w-8 text-right tabular-nums">{timeAgo(s.date)}</span></>}
            />
          ))}
        </List>
      )}
      <Section title="Connected apps" description="Where this view reads from.">
        <div className="flex flex-wrap gap-3">
          {["gmail", "google-calendar", "stripe"].map((p) => (
            <span key={p} className="flex items-center gap-1.5 text-13"><AppLogo platform={p} size="sm" />{p.replace("-", " ")}</span>
          ))}
        </div>
      </Section>
    </Page>
  );
}`;

if (import.meta.url === `file://${process.argv[1]}`) {
  const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) process.exitCode = 1; };
  const b = await chromium.launch();
  for (const theme of themes) {
    console.log(`-- ${theme}`);
    const p = await b.newPage({ viewport: { width: 760, height: 1200 }, deviceScaleFactor: 2 });
    const errs = [];
    p.on("pageerror", (e) => errs.push(e.message));
    const rpc = (name, args) => p.evaluate(([n, a]) => window.__rpc("tools/call", { name: n, arguments: a }), [name, args]);
    await p.goto(`http://localhost:52291/?tool=none&theme=${theme}`);
    await p.waitForFunction(() => window.__start);
    const shell = p.frameLocator("#f");
    const ui = shell.frameLocator("iframe");

    const guide = (await rpc("ui_guide", {})).content[0].text;
    const example = guide.match(/```tsx\n([\s\S]*?)\n```/)?.[1];
    ok(!!example && guide.includes("Table({ columns") && guide.includes("Style rules"), `ui_guide returns the kit, the rules and an example (${guide.length} bytes)`);

    // Renders one UI; returns the tool result text.
    const render = async (title, code, actions) => {
      await p.evaluate(([title, code, actions]) => window.__start("render_ui", { title, code, actions: actions.map((actionId) => ({ platform: "gmail", actionId })), temporary: true }), [title, code, actions]);
      return p.evaluate(() => window.__result);
    };
    // Sizes the host frame to the shell's content, then shoots it.
    const shoot = async (name, minHeight = 0) => {
      await ui.locator("img").evaluateAll((imgs) => Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; setTimeout(r, 5000); })))));
      await p.waitForTimeout(400);
      const h = await (await (await p.locator("#f").elementHandle()).contentFrame()).evaluate(() => document.body.scrollHeight);
      await p.evaluate((h) => (document.getElementById("f").style.height = `${h}px`), Math.max(h, minHeight));
      await p.waitForTimeout(250);
      await p.locator("#f").screenshot({ path: `${OUT}kit-${name}-${theme}.png` });
    };
    const clean = async (label) => {
      ok((await ui.getByText("This UI hit an error").count()) === 0, `${label}: no runtime error in the frame`);
      const ctx = JSON.stringify((await p.evaluate(() => window.__context)) ?? "");
      ok(!ctx.includes("failed"), `${label}: nothing reported back to the model`);
    };

    // 1. The ui_guide example: stats, tabs, table, a write per row.
    const r1 = await render("Inbox triage", example, [GET_THREADS, CREATE_DRAFT]);
    ok(!r1.isError && !r1.content[0].text.includes("Style check"), "dashboard: saved with no style warnings");
    await ui.getByRole("table").waitFor({ timeout: 20000 });
    await ui.getByRole("button", { name: "Draft reply" }).first().waitFor({ timeout: 10000 });
    const unreadStat = await ui.getByText("Unread", { exact: true }).first().isVisible();
    ok(unreadStat && (await ui.getByRole("row").count()) > 1, `dashboard: stats and ${(await ui.getByRole("row").count()) - 1} table rows`);
    await clean("dashboard");
    await shoot("dashboard");
    await ui.getByRole("tab", { name: /All/ }).click();
    ok((await ui.getByRole("tab", { name: /All/ }).getAttribute("aria-selected")) === "true", "dashboard: tabs switch");
    await ui.getByRole("button", { name: "Draft reply" }).first().click();
    const dialog = shell.getByTestId("fb-confirm");
    await dialog.waitFor({ timeout: 5000 });
    ok(/Re: /.test(await dialog.innerText()), "dashboard: the draft waits behind the shell's Confirm");
    await shoot("confirm", 520);
    await shell.getByRole("button", { name: "Cancel" }).click();
    await ui.getByText("Nothing was saved.").waitFor({ timeout: 5000 });
    ok(true, "dashboard: cancel runs nothing");
    await ui.getByRole("button", { name: "Draft reply" }).first().click();
    await shell.getByTestId("fb-confirm-ok").click();
    await ui.getByText(/Draft saved for/).waitFor({ timeout: 5000 });
    ok(true, "dashboard: confirm saves the draft");

    // 2. A form with a write.
    const r2 = await render("Quick email", formCode, [SEND]);
    ok(!r2.content[0].text.includes("Style check"), "form: saved with no style warnings");
    await ui.getByLabel("Message").waitFor({ timeout: 20000 });
    await ui.getByRole("button", { name: "Send" }).click();
    await ui.getByText("Enter one email address.").waitFor({ timeout: 5000 });
    ok((await ui.getByLabel("To (required)").getAttribute("aria-invalid")) === "true", "form: errors show and mark the field invalid");
    await ui.getByLabel("To (required)").fill("dana@acme.test");
    await ui.getByLabel("Subject").fill("Thursday review");
    await ui.getByLabel("Tone").selectOption("Formal");
    await ui.getByLabel("Message").fill("Can we move the review to 3 PM?");
    await clean("form");
    await shoot("form");
    await ui.getByRole("button", { name: "Send" }).click();
    await dialog.waitFor({ timeout: 5000 });
    const dt = await dialog.innerText();
    ok(dt.includes("dana@acme.test") && dt.includes("Thursday review"), "form: send waits behind Confirm showing to and subject");
    await shell.getByTestId("fb-confirm-ok").click();
    await ui.getByTestId("out").filter({ hasText: "Sent." }).waitFor({ timeout: 5000 });
    ok(true, "form: confirm sends");

    // 3. A list with tabs, search and an empty state.
    const r3 = await render("Who writes to you", listCode, [GET_THREADS]);
    ok(!r3.content[0].text.includes("Style check"), "list: saved with no style warnings");
    await ui.getByRole("listitem").first().waitFor({ timeout: 20000 });
    ok((await ui.getByRole("listitem").count()) >= 3, `list: ${await ui.getByRole("listitem").count()} rows`);
    await ui.getByRole("listitem").first().getByRole("button").click();
    await clean("list");
    await shoot("list");
    await ui.getByLabel("Find a sender").fill("zzz");
    await ui.getByText("No senders match").waitFor({ timeout: 5000 });
    ok(true, "list: empty state when nothing matches");
    await shoot("list-empty");

    // The style check speaks up on a sloppy UI and still saves it.
    const sloppy = await rpc("render_ui", { title: "Sloppy", code: `export default () => <div className="p-5 text-[12px] bg-blue-500" style={{ color: "#ff0000" }}>Hi 🎉<table /></div>`, actions: [], temporary: true });
    const t = sloppy.content[0].text;
    ok(!sloppy.isError && sloppy.structuredContent?.renderId && /Style check, \d to fix with update_ui/.test(t), "a sloppy UI is rendered and gets style warnings");
    ok(["Off-ladder spacing", "Arbitrary values", "Palette colors", "Inline style", "Emoji", "Raw <table>"].every((s) => t.includes(s)), "warnings name each problem");

    ok(errs.length === 0, `no host page errors ${errs.join(" | ")}`);
    await p.close();
  }
  await b.close();
}
