import { chromium } from "playwright";

// render_ui end to end in the test host (pnpm harness, wrangler dev in sample
// mode). The agent's code runs in a sandboxed frame inside the trusted shell:
// it loads data through run_action, cannot reach the shell, every write waits
// for Confirm in the shell, a token works once, and the UI is saved,
// listed, shown again and versioned.
const GET_THREADS = "conn_mod_def::GGSNlnppgZ0::qk3CudDWTVKPY7hpPVCqLQ";
const SEND = "conn_mod_def::GGXAjWkZO8U::uMc1LQIHTTKzeMm3rLL5gQ";
const theme = process.env.THEME ?? "dark";
export const code = `
import { useState } from "react";
import { useAction, runAction, Card, Badge, Button, Skeleton, ErrorState, ask } from "@forkable/ui";
import { Mail, Star } from "lucide-react";
type T = { id: string; subject: string; from: { name: string }; unread: boolean; starred: boolean };
export default function Senders() {
  const { data, loading, error, reload } = useAction<{ threads: T[] }>("${GET_THREADS}", { body: { query: "in:inbox", numberOfThreads: 20 } });
  const [out, setOut] = useState("");
  const [escape, setEscape] = useState("");
  if (loading) return <Skeleton className="h-24 w-full" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const threads = data?.threads ?? [];
  const unread = threads.filter((t) => t.unread).length;
  const send = () => runAction("${SEND}", { body: { to: "dana@acme.test", subject: "Hello from a test", body: "Exactly this text." } })
    .then((r) => setOut("sent " + r.id)).catch((e) => setOut(e.refused));
  const tryEscape = () => {
    try { (window.parent.document.querySelector("[data-testid=fb-confirm-ok]") as any)?.click(); setEscape("reached shell"); }
    catch { setEscape("blocked"); }
  };
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="grid grid-cols-2 gap-3">
        <Card><div className="text-11 text-muted-foreground">Threads</div><div className="text-28" data-testid="total">{threads.length}</div></Card>
        <Card><div className="text-11 text-muted-foreground">Unread</div><div className="text-28" data-testid="unread">{unread}</div></Card>
      </div>
      <ul className="flex flex-col">
        {threads.slice(0, 5).map((t) => (
          <li key={t.id} className="flex items-center gap-2 border-b border-border py-2 text-13">
            <Mail className="size-3.5 text-muted-foreground" />
            <span className="truncate">{t.subject}</span>
            {t.starred && <Star className="size-3 text-muted-foreground" />}
            <Badge className="ml-auto">{t.from.name}</Badge>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button onClick={() => runAction("conn_mod_def::NOT_DECLARED").catch((e) => setOut(e.refused))}>Try undeclared</Button>
        <Button onClick={tryEscape}>Try escape</Button>
        <Button variant="primary" onClick={send}>Send</Button>
        <Button onClick={() => ask("Summarize my unread mail")}>Summarize</Button>
      </div>
      <span data-testid="out">{out}</span>
      <span data-testid="escape">{escape}</span>
    </div>
  );
}`;

if (import.meta.url === `file://${process.argv[1]}`) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 760, height: 760 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) process.exitCode = 1; };
  const rpc = (name, args) => p.evaluate(([n, a]) => window.__rpc("tools/call", { name: n, arguments: a }), [name, args]);
  await p.goto(`http://localhost:52291/?tool=none&theme=${theme}`);
  await p.waitForFunction(() => window.__start);

  const listed = await p.evaluate(() => window.__rpc("tools/list"));
  const names = listed.tools.map((t) => t.name).sort().join(",");
  ok(names === "action_docs,delete_ui,find_actions,list_connections,list_my_uis,rename_ui,render_ui,run_action,show_ui,ui_guide,update_ui", `tools/list has only the product tools (${names})`);
  const resources = await p.evaluate(() => window.__rpc("resources/list"));
  ok(resources.resources.length === 1 && /canvas-/.test(resources.resources[0].uri), "resources/list has only the canvas");
  const oldView = await p.evaluate(() => window.__rpc("resources/read", { uri: "ui://forkable/gmail-inbox.html" }));
  ok(/removed/.test(oldView.contents[0].text), "a cached gmail-inbox URI gets a short removed note");
  const oldTool = await rpc("show_gmail_inbox", {});
  ok(!oldTool.isError && /removed/.test(oldTool.content[0].text), "a cached show_gmail_inbox call gets a short removed note");
  const oldApi = await rpc("blocks_api", { method: "GET", path: "/api/gmail/threads" });
  ok(!oldApi.isError && /removed/.test(oldApi.content[0].text) && !oldApi.structuredContent, "a cached blocks_api call gets the same removed note, no data");
  const blocksImport = await rpc("render_ui", { title: "x", code: 'import { GmailInbox } from "@forkable/blocks";\nexport default () => <GmailInbox />;', actions: [], temporary: true });
  ok(blocksImport.isError && /@forkable\/blocks" is not available/.test(blocksImport.content[0].text) && /run_action/.test(blocksImport.content[0].text), "importing @forkable/blocks is a compile error pointing at run_action");

  const found =await rpc("find_actions", { platform: "gmail", query: "list threads" });
  ok(found.content[0].text.includes("get-threads"), "find_actions lists gmail get-threads");
  const docs = await rpc("action_docs", { actionId: GET_THREADS });
  ok(docs.content[0].text.includes("numberOfThreads"), "action_docs describes the input");
  const bad = await rpc("render_ui", { title: "x", code: "export default () => <div", actions: [] });
  ok(bad.isError && bad.content[0].text.startsWith("The code did not compile"), "a syntax error comes back to the agent");

  const title = `Inbox by sender ${Date.now()}`;
  await p.evaluate(([code, title, a, s]) => window.__start("render_ui", { title, description: "Counts and a send test", code, actions: [{ platform: "gmail", actionId: a }, { platform: "gmail", actionId: s }] }), [code, title, GET_THREADS, SEND]);
  const result = await p.evaluate(() => window.__result.structuredContent);
  ok(result.saved && result.uiId && result.version === 1 && result.url?.endsWith(`/u/${result.uiId}`), `saved as ${result.uiId} v1 with a web link`);
  ok(result.actions.find((a) => a.actionId === SEND)?.write === true && result.actions.find((a) => a.actionId === GET_THREADS)?.write === false, "send is a write, get-threads a read");

  const shell = p.frameLocator("#f");
  const ui = shell.frameLocator("iframe");
  await ui.getByTestId("total").waitFor({ timeout: 20000 });
  ok(Number(await ui.getByTestId("total").innerText()) > 0, `agent UI loaded threads (${await ui.getByTestId("total").innerText()})`);
  ok(Number(await ui.getByTestId("unread").innerText()) > 0, "unread count computed in the agent's code");
  const bg = await ui.locator(".bg-card").first().evaluate((el) => getComputedStyle(el).backgroundColor);
  ok(bg !== "rgba(0, 0, 0, 0)", `Tailwind compiled in the frame (bg-card = ${bg})`);
  ok((await ui.locator("svg").count()) >= 5, "icons render");
  ok(await shell.getByText("Saved to your blocks, v1.").isVisible(), "shell shows the saved line");

  await ui.getByRole("button", { name: "Try undeclared" }).click();
  await ui.getByTestId("out").filter({ hasText: "not_declared" }).waitFor({ timeout: 5000 });
  ok(true, "an undeclared action is refused by the server");

  await ui.getByRole("button", { name: "Send" }).click();
  const dialog = shell.getByTestId("fb-confirm");
  await dialog.waitFor({ timeout: 5000 });
  const dtext = await dialog.innerText();
  ok(/Send with Gmail/.test(dtext) && dtext.includes("dana@acme.test") && dtext.includes("Hello from a test") && dtext.includes("Exactly this text."), "write waits behind a confirm showing to, subject and message");
  await ui.getByRole("button", { name: "Try escape" }).click({ force: true }).catch(() => {});
  await p.waitForTimeout(300);
  ok((await ui.getByTestId("escape").innerText()) !== "reached shell" && (await dialog.isVisible()), "the UI's code cannot reach or click the shell's dialog");
  await shell.getByRole("button", { name: "Cancel" }).click();
  await ui.getByTestId("out").filter({ hasText: "cancelled" }).waitFor({ timeout: 5000 });
  ok(true, "cancel returns 'cancelled' to the UI and nothing runs");
  await ui.getByRole("button", { name: "Send" }).click();
  await shell.getByTestId("fb-confirm-ok").click();
  await ui.getByTestId("out").filter({ hasText: "sent sample-" }).waitFor({ timeout: 5000 });
  ok(true, "confirm runs exactly that write");
  const sendCalls = (await p.evaluate(() => window.__calls)).filter((c) => c.includes(SEND));
  ok(sendCalls.length === 3 && sendCalls[2].includes("confirmToken"), `three send calls: two asked, one confirmed (${sendCalls.length})`);

  // The server side, without the shell: a write needs a token, a token works once, for that input only.
  const rid = result.renderId;
  const input = { body: { to: "x@acme.test", subject: "s", body: "b" } };
  const ask1 = await rpc("run_action", { renderId: rid, actionId: SEND, input });
  ok(ask1.structuredContent.status === 428 && ask1.structuredContent.confirm.token, "a write with no token answers 428 confirm_required");
  const tok = ask1.structuredContent.confirm.token;
  const changed = await rpc("run_action", { renderId: rid, actionId: SEND, input: { body: { ...input.body, to: "evil@x.test" } }, confirmToken: tok });
  ok(changed.structuredContent.status === 409, "a token does not cover a changed input");
  const ask2 = await rpc("run_action", { renderId: rid, actionId: SEND, input });
  const used = await rpc("run_action", { renderId: rid, actionId: SEND, input, confirmToken: ask2.structuredContent.confirm.token });
  const again = await rpc("run_action", { renderId: rid, actionId: SEND, input, confirmToken: ask2.structuredContent.confirm.token });
  ok(used.structuredContent.status === 200 && again.structuredContent.status === 409, "a token works once");

  // Saved, listed, shown again, versioned.
  const list = await rpc("list_my_uis", { query: title.slice(-13) });
  ok(list.structuredContent.uis.some((u) => u.id === result.uiId), "list_my_uis finds it");
  const upd = await rpc("update_ui", { uiId: result.uiId, code: code.replace("Threads<", "All threads<"), actions: [{ platform: "gmail", actionId: GET_THREADS }] });
  ok(upd.structuredContent.version === 2, "update_ui makes version 2");
  const v1 = await rpc("show_ui", { uiId: result.uiId, version: 1 });
  ok(v1.structuredContent.version === 1 && v1.structuredContent.actions.length === 2, "version 1 still opens with its own actions");
  const oldRender = await rpc("run_action", { renderId: v1.structuredContent.renderId, actionId: GET_THREADS, input: { body: { numberOfThreads: 1 } } });
  ok(oldRender.structuredContent.status === 200, "an older version still runs");
  await p.evaluate((id) => window.__start("show_ui", { uiId: id }), result.uiId);
  await ui.getByText("All threads").waitFor({ timeout: 15000 });
  ok(true, "show_ui renders the latest version");
  await p.waitForTimeout(250); // the frame fades in
  await p.screenshot({ path: process.env.SHOT ?? `/tmp/fb-canvas-${theme}.png`, clip: { x: 16, y: 30, width: 642, height: 600 } });

  await p.evaluate(() => window.__start("render_ui", { title: "Broken", code: "export default function B() { const x: any = null; return <div>{x.y}</div>; }", actions: [], temporary: true }));
  await ui.getByText("This UI hit an error").waitFor({ timeout: 10000 });
  await p.waitForTimeout(300);
  ok(JSON.stringify(await p.evaluate(() => window.__context)).includes("update_ui"), "a runtime error goes back to the model");
  const listAfter = await rpc("list_my_uis", {});
  ok(!listAfter.structuredContent.uis.some((u) => u.title === "Broken"), "a temporary render is not listed");
  ok(errs.length === 0, `no host page errors ${errs.join(" | ")}`);
  await b.close();
}
