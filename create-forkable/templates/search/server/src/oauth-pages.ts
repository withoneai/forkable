// Server-rendered pages for the OAuth flow: the consent page an app's sign-in opens,
// and short message pages for expired or refused requests. Plain HTML so they work
// without the UI build; the Forkable palette, light and dark from the system.

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

const SCOPE_TEXT: Record<string, string> = {
  "search:read": "Search your index and read the items it found",
  "search:ask": "Ask the assistant about your items (uses model calls on your grant)",
  "sources:write": "Sync, pause and change your sources and profiles",
  "account:read": "See your account, Access and the activity record",
};

const MARK = `<svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true"><rect width="28" height="28" rx="8" fill="#CCED73"/><path d="M18.5 9.5c-1-1.2-2.6-1.9-4.4-1.9-2.6 0-4.4 1.4-4.4 3.4 0 4.6 9 2.6 9 7.1 0 2.1-2 3.6-4.6 3.6-2 0-3.8-.8-4.9-2.2" fill="none" stroke="#000" stroke-width="2.2" stroke-linecap="round"/></svg>`;

function shell(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Search</title>
<style>
:root{--bg:#fbfdfc;--card:#fff;--ink:#0b0f0d;--muted:#5d6b64;--line:rgba(0,0,0,.09);--green:#809d08;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#0a0a0a;--card:#161616;--ink:#ededed;--muted:#a1a1a1;--line:rgba(255,255,255,.1);--green:#CCED73}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:14px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,sans-serif}
.card{width:min(420px,calc(100vw - 32px));background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px}
h1{font-size:18px;line-height:1.3;margin:16px 0 4px;font-weight:600}p{margin:0;color:var(--muted)}
ul{list-style:none;margin:20px 0;padding:0;border-top:1px solid var(--line)}li{padding:10px 0;border-bottom:1px solid var(--line);display:flex;gap:10px}
li:before{content:"";flex:none;width:6px;height:6px;border-radius:3px;background:var(--green);margin-top:8px}
.row{display:flex;flex-direction:column;gap:8px;margin-top:20px}
button{font:inherit;font-weight:500;height:40px;border-radius:10px;border:1px solid var(--line);background:transparent;color:var(--ink);cursor:pointer}
button.primary{background:#CCED73;color:#000;border-color:#CCED73}button.primary:hover{background:#b3d258}
button.quiet{border:0;color:var(--muted);height:32px}button:focus-visible{outline:2px solid var(--green);outline-offset:2px}
.who{margin-top:16px;padding:10px 12px;border-radius:10px;border:1px solid var(--line);color:var(--muted)}.who b{color:var(--ink);font-weight:500}
.foot{margin-top:18px;font-size:12px;color:var(--muted)}code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace}
</style></head><body><main class="card">${MARK}${body}</main></body></html>`;
}

export interface ConsentInput {
  pendingId: string;
  clientName: string;
  redirectHost: string;
  scopes: string[];
  user: { name: string; isSample: boolean } | null;
  oneConfigured: boolean;
}

export function consentPage(i: ConsentInput): string {
  const list = i.scopes.map((s) => `<li>${esc(SCOPE_TEXT[s] ?? s)}</li>`).join("");
  const btn = (action: string, label: string, cls = "") => `<button type="submit" name="action" value="${action}"${cls ? ` class="${cls}"` : ""}>${esc(label)}</button>`;
  const buttons: string[] = [];
  if (i.user) {
    buttons.push(btn("allow", `Continue as ${i.user.name}${i.user.isSample ? " (Acme sample)" : ""}`, "primary"));
    if (i.oneConfigured && i.user.isSample) buttons.push(btn("one", "Sign in with One instead"));
  } else {
    if (i.oneConfigured) buttons.push(btn("one", "Continue with One", "primary"));
    buttons.push(btn("sample", "Use the Acme sample", i.oneConfigured ? "" : "primary"));
  }
  buttons.push(btn("deny", "Cancel", "quiet"));
  const who = i.user ? `<div class="who">Signed in as <b>${esc(i.user.name)}</b></div>` : "";
  const note = !i.user && !i.oneConfigured ? `<p class="foot">Sign in with One is off on this computer. Open <code>/setup/connect</code> to turn it on, or try everything on the Acme sample.</p>` : "";
  return shell("Allow access", `<h1>${esc(i.clientName)} wants to use your Search</h1>
<p>It will send you back to <b>${esc(i.redirectHost)}</b> when you continue. Read only: it can never change anything in your tools.</p>${who}
<ul>${list}</ul>
<form method="post" action="/oauth/consent"><input type="hidden" name="pending" value="${esc(i.pendingId)}"><div class="row">${buttons.join("")}</div></form>
<p class="foot">Secured by One. Revoke this app any time in Settings, API.</p>${note}`);
}

export function messagePage(title: string, text: string): string {
  return shell(title, `<h1>${esc(title)}</h1><p>${esc(text)}</p>`);
}
