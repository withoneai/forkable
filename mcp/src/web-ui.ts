import markSvg from "../brand/forkable-mark-current.svg";
import lockupSvg from "../brand/forkable-lockup-horizontal-current.svg";
import type { DeclaredAction } from "./generative.js";

// The website's markup and style: server-rendered HTML, one inline <style>,
// one inline <script> (theme before paint, the theme toggle, copy buttons)
// allowed by its hash in the page CSP. Sizes follow design/SPACING.md: type
// 11/13/15 for UI, 24/30 for page titles; spacing 2/4/6/8/10/12/16/24.

export const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** The F6 mark from the brand kit (currentColor), sized by CSS. */
// Brand kit files as they ship, only cropped to their drawn bounds (measured
// with getBBox) so they size like type. Never edit the paths.
export const MARK = markSvg.replace(/<svg [^>]*?>/, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="138 104 234 304" class="mark" aria-hidden="true" focusable="false">');
export const LOCKUP = lockupSvg.replace(/<svg [^>]*?>/, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="51 45 239.5 56.2" class="lockup" role="img" aria-label="Forkable">');

const icon = (d: string, cls = "i") =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
const SUN = icon('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>', "i i-sun");
const MOON = icon('<path d="M20.5 14.1A8.5 8.5 0 1 1 9.9 3.5a6.6 6.6 0 0 0 10.6 10.6Z"/>', "i i-moon");
const COPY = icon('<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>', "i i-copy");
const CHECK = icon('<path d="m5 12.5 4.5 4.5L19 7.5"/>', "i i-check");
const SEARCH = icon('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>');
const ARROW = icon('<path d="M7 17 17 7M8 7h9v9"/>');

/** Theme before paint, the toggle (remembered as fb-theme) and copy buttons. */
export const PAGE_SCRIPT = `(function(){var d=document.documentElement,k="fb-theme",m=matchMedia("(prefers-color-scheme: dark)");function g(){try{return localStorage.getItem(k)}catch(e){return null}}function a(t){d.setAttribute("data-theme",t)}var s=g();a(s==="light"||s==="dark"?s:m.matches?"dark":"light");m.addEventListener("change",function(e){if(!g())a(e.matches?"dark":"light")});document.addEventListener("click",function(e){var t=e.target&&e.target.closest?e.target.closest("[data-fb]"):null;if(!t)return;var f=t.getAttribute("data-fb");if(f==="theme"){var n=d.getAttribute("data-theme")==="dark"?"light":"dark";a(n);try{localStorage.setItem(k,n)}catch(_){}}else if(f==="copy"&&navigator.clipboard){navigator.clipboard.writeText(t.getAttribute("data-value")||"").then(function(){t.setAttribute("data-done","");setTimeout(function(){t.removeAttribute("data-done")},1600)})}})})();`;

let scriptHash: Promise<string> | null = null;
/** CSP for the website's own pages: no scripts but PAGE_SCRIPT, by hash. */
export function pageCsp() {
  scriptHash ??= crypto.subtle.digest("SHA-256", new TextEncoder().encode(PAGE_SCRIPT)).then((b) => btoa(String.fromCharCode(...new Uint8Array(b))));
  return scriptHash.then(
    (h) => `default-src 'none'; script-src 'sha256-${h}' https://static.cloudflareinsights.com; style-src 'unsafe-inline'; img-src data: 'self' https:; connect-src https://cloudflareinsights.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
  );
}

const LIGHT = `--bg:#fbfdfc;--fg:#002215;--muted:#627b6f;--green:#809d08;--card:color-mix(in oklch,#fbfdfc 97%,#002215 3%);--raised:#ffffff;--border:color-mix(in oklch,#fbfdfc 88%,#002215 12%);--strong:color-mix(in oklch,#fbfdfc 76%,#002215 24%);--dots:color-mix(in oklch,#fbfdfc 82%,#002215 18%);--shadow:0 1px 2px rgb(0 34 21/.04),0 8px 24px -12px rgb(0 34 21/.12);color-scheme:light`;
const DARK = `--bg:#000;--fg:#e9faf2;--muted:#779084;--green:#cced73;--card:color-mix(in oklch,#000 91%,#e9faf2 9%);--raised:color-mix(in oklch,#000 81%,#e9faf2 19%);--border:color-mix(in oklch,#000 82%,#e9faf2 18%);--strong:color-mix(in oklch,#000 68%,#e9faf2 32%);--dots:color-mix(in oklch,#000 80%,#e9faf2 20%);--shadow:0 0 0 1px rgb(233 250 242/.02),0 12px 32px -16px rgb(0 0 0/.8);color-scheme:dark`;

const STYLE = `
:root{${LIGHT};--fill:#cced73;--fill-hover:#b3d258;--fill-press:#9ab83b}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){${DARK}}}
:root[data-theme=dark]{${DARK}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;display:flex;flex-direction:column;background:var(--bg);color:var(--fg);font:400 .875rem/1.375rem ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit}
:focus-visible{outline:2px solid var(--green);outline-offset:2px}
.wrap{width:100%;max-width:1040px;margin:0 auto;padding:0 1rem}
@media (min-width:640px){.wrap{padding:0 1.5rem}}
.mark{height:1.125rem;width:auto;display:block;flex:none}
.i{width:1rem;height:1rem;display:block;flex:none}
.muted{color:var(--muted)}
.sp{flex:1}

/* Header */
.top{position:sticky;top:0;z-index:5;background:color-mix(in oklch,var(--bg) 86%,transparent);backdrop-filter:saturate(1.4) blur(12px);-webkit-backdrop-filter:saturate(1.4) blur(12px);border-bottom:1px solid var(--border)}
.top .wrap{display:flex;align-items:center;gap:.5rem;height:3.5rem}
.brand{display:flex;align-items:center;gap:.375rem;text-decoration:none;font-weight:600;font-size:.9375rem;letter-spacing:-.01em}
.brand{gap:.5rem;align-items:center}.lockup{height:1.5rem;width:auto;display:block;flex:none}
.brand-sub{padding-left:.5rem;border-left:1px solid var(--border);line-height:1.5rem;color:var(--muted);font-weight:500;font-size:.9375rem}
.who{display:flex;align-items:center;gap:.5rem;font-size:.8125rem;line-height:1.25rem;color:var(--muted);padding:0 .5rem;min-width:0}
.who span:last-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:12rem}
.avatar{position:relative;width:1.75rem;height:1.75rem;border-radius:999px;display:grid;place-items:center;background:var(--fill);color:#000;font-size:.6875rem;font-weight:600;flex:none;overflow:hidden}
.avatar img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.who-text{display:flex;flex-direction:column;line-height:1rem;min-width:0}.who-name{font-size:.8125rem;color:var(--fg);font-weight:500}.who-mail{font-size:.6875rem;color:var(--muted)}
@media (max-width:640px){.who-text{display:none}}
.tile{position:relative;overflow:hidden}.tile img{position:absolute;inset:.375rem;width:calc(100% - .75rem);height:calc(100% - .75rem);object-fit:contain;background:var(--raised)}.tile b{font-weight:600}.tile b svg{width:auto;height:1rem;display:block}
.chip-logo{position:relative;display:inline-grid;place-items:center;width:.875rem;height:.875rem;margin-right:.25rem;vertical-align:-2px;overflow:hidden}.chip-logo b{font-size:.5625rem}.chip-logo img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:var(--raised)}
.chip.write .chip-logo img{background:var(--bg)}
.onemcp{display:grid;grid-template-columns:1fr auto;gap:1rem;align-items:center;padding:1rem;border:1px solid var(--border);border-radius:.75rem;background:var(--card)}
.onemcp h2{font-size:.9375rem;line-height:1.375rem;margin:0;font-weight:600}.onemcp p{margin:.25rem 0 0;font-size:.8125rem;line-height:1.25rem;color:var(--muted);max-width:36rem}
.onemcp-act{display:flex;flex-direction:column;gap:.5rem;align-items:flex-end}.onemcp-act .field{min-width:20rem}
@media (max-width:760px){.onemcp{grid-template-columns:1fr}.onemcp-act{align-items:stretch}.onemcp-act .field{min-width:0}}
@media (max-width:519px){.who span:last-child{display:none}}

/* Buttons */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.375rem;height:2rem;padding:0 .75rem;border-radius:.5rem;border:1px solid var(--border);background:var(--raised);color:var(--fg);font:inherit;font-size:.8125rem;font-weight:500;line-height:1;cursor:pointer;text-decoration:none;white-space:nowrap;transition:background .15s,border-color .15s,color .15s}
.btn:hover{border-color:var(--strong)}
.btn.ghost{background:transparent;border-color:transparent;color:var(--muted)}
.btn.ghost:hover{background:var(--card);color:var(--fg)}
.btn.icon{width:2rem;padding:0}
.btn.primary{background:var(--fill);border-color:transparent;color:#000}
.btn.primary:hover{background:var(--fill-hover)}
.btn.primary:active{background:var(--fill-press)}
.btn.lg{height:2.5rem;padding:0 1rem;font-size:.875rem;border-radius:.625rem}
.btn.lg .mark{height:1rem}
[data-fb=theme] .i-sun{display:none}
:root[data-theme=dark] [data-fb=theme] .i-sun{display:block}
:root[data-theme=dark] [data-fb=theme] .i-moon{display:none}
@media (prefers-color-scheme:dark){:root:not([data-theme]) [data-fb=theme] .i-sun{display:block}:root:not([data-theme]) [data-fb=theme] .i-moon{display:none}}
[data-fb=copy] .i-check,[data-fb=copy] .done{display:none}
[data-fb=copy][data-done] .i-check,[data-fb=copy][data-done] .done{display:inline}
[data-fb=copy][data-done] .i-check{display:block;color:var(--green)}
[data-fb=copy][data-done] .i-copy,[data-fb=copy][data-done] .idle{display:none}

/* Type */
h1,h2,h3,p{margin:0}
.eyebrow{display:inline-flex;align-items:center;gap:.5rem;height:1.75rem;padding:0 .75rem 0 .5rem;border:1px solid var(--border);border-radius:999px;background:var(--card);font-size:.75rem;color:var(--muted);width:max-content;max-width:100%}
.dot{width:.375rem;height:.375rem;border-radius:999px;background:var(--fill);flex:none;box-shadow:0 0 0 3px color-mix(in oklch,var(--fill) 25%,transparent)}
.label{font:500 .6875rem/1rem ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}

/* Connector field */
.field{display:flex;align-items:center;gap:.5rem;height:2.5rem;padding:0 .25rem 0 .75rem;border:1px solid var(--border);border-radius:.625rem;background:var(--card);max-width:28rem}
.field code{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:.8125rem/1.25rem ui-monospace,SFMono-Regular,Menlo,monospace}
.field .btn{height:2rem}
code.inline{font:.75rem/1rem ui-monospace,SFMono-Regular,Menlo,monospace;padding:.125rem .375rem;border-radius:.375rem;background:var(--card);border:1px solid var(--border);word-break:break-all}

/* Landing */
.landing{flex:1;display:flex;flex-direction:column;justify-content:center;gap:1.5rem;padding-top:1.5rem;padding-bottom:1.5rem}
.hero{display:grid;gap:1.5rem;align-items:center;min-height:min(30rem,calc(100vh - 14rem))}
@media (min-width:900px){.hero{grid-template-columns:1.05fr .95fr;gap:1.5rem}}
.hero-copy{display:flex;flex-direction:column;gap:1rem;max-width:34rem}
.hero h1{font-size:1.875rem;line-height:2.25rem;font-weight:600;letter-spacing:-.02em;text-wrap:balance}
.lede{font-size:.9375rem;line-height:1.5rem;color:var(--muted);text-wrap:pretty;max-width:30rem}
.cta{display:flex;flex-direction:column;gap:.75rem;padding-top:.5rem}
.cta .label{padding-top:.5rem}
.alert{font-size:.8125rem;line-height:1.25rem;padding:.5rem .75rem;border:1px solid var(--strong);border-radius:.5rem;background:var(--card);width:max-content;max-width:100%}

/* The hero illustration: a chat, the UI it built, the saved line. Static HTML. */
.art{position:relative;border:1px solid var(--border);border-radius:1rem;background:radial-gradient(circle at 1px 1px,var(--dots) 1px,transparent 0) 0 0/1rem 1rem,var(--card);padding:1.5rem;display:flex;flex-direction:column;gap:.75rem;overflow:hidden}
.art::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 60%,var(--card));pointer-events:none}
.bubble{align-self:flex-end;max-width:80%;padding:.5rem .75rem;border-radius:1rem 1rem .25rem 1rem;background:var(--fg);color:var(--bg);font-size:.8125rem;line-height:1.25rem}
.reply{font-size:.8125rem;line-height:1.25rem;color:var(--muted)}
.win{position:relative;z-index:1;border:1px solid var(--border);border-radius:.75rem;background:var(--raised);box-shadow:var(--shadow);overflow:hidden}
.win-body{display:flex;flex-direction:column;gap:.75rem;padding:1rem}
.win-head{display:flex;align-items:baseline;gap:.5rem}
.win-head b{font-size:.8125rem;font-weight:600}
.win-head span{font-size:.6875rem;color:var(--muted)}
.bars{display:flex;flex-direction:column;gap:.5rem;margin:0;padding:0;list-style:none}
.bars li{display:grid;grid-template-columns:6.5rem 1fr 1.5rem;align-items:center;gap:.5rem;font-size:.75rem;line-height:1rem}
.bars i{display:block;height:.5rem;border-radius:999px;background:var(--strong)}
.bars li:first-child i{background:var(--fill)}
.bars em{font-style:normal;color:var(--muted);text-align:right;font-variant-numeric:tabular-nums}
.win-foot{display:flex;align-items:center;gap:.375rem;padding:.5rem 1rem;border-top:1px solid var(--border);font-size:.6875rem;line-height:1rem;color:var(--muted)}
.win-foot .mark{height:.75rem}
.win-foot u{text-underline-offset:2px}

.steps{display:grid;gap:.75rem;padding:0;margin:0;list-style:none;counter-reset:s}
@media (min-width:760px){.steps{grid-template-columns:repeat(3,1fr)}}
.step{display:flex;flex-direction:column;gap:.375rem;padding:1rem;border:1px solid var(--border);border-radius:.75rem;background:var(--card)}
.step::before{counter-increment:s;content:"0" counter(s);font:500 .6875rem/1rem ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.05em;color:var(--muted);padding-bottom:.375rem}
.step h3{font-size:.875rem;line-height:1.25rem;font-weight:600}
.step p{font-size:.8125rem;line-height:1.25rem;color:var(--muted)}
.foot{border-top:1px solid var(--border)}
.foot .wrap{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;padding-top:1rem;padding-bottom:1rem;font-size:.75rem;line-height:1rem;color:var(--muted)}
.foot a{text-decoration:none}.foot a:hover{color:var(--fg)}

/* Your blocks */
.list{flex:1;display:flex;flex-direction:column;gap:1.5rem;padding-top:1.5rem;padding-bottom:1.5rem}
.head{display:flex;flex-wrap:wrap;align-items:flex-end;gap:1rem}
.head-copy{display:flex;flex-direction:column;gap:.375rem;flex:1;min-width:16rem}
.head h1{display:flex;align-items:baseline;gap:.5rem;font-size:1.5rem;line-height:2rem;font-weight:600;letter-spacing:-.02em}
.count{font-size:.8125rem;font-weight:500;color:var(--muted);letter-spacing:0}
.head p{font-size:.8125rem;line-height:1.25rem;color:var(--muted)}
.search{position:relative;display:flex;align-items:center;width:100%;max-width:16rem}
@media (max-width:639px){.search{max-width:none}}
.search .i{position:absolute;left:.625rem;color:var(--muted);pointer-events:none}
.search input{width:100%;height:2rem;padding:0 .75rem 0 2rem;border:1px solid var(--border);border-radius:.5rem;background:var(--raised);color:var(--fg);font:inherit;font-size:.8125rem}
.search input::placeholder{color:var(--muted)}
.search input:focus{outline:none;border-color:var(--strong);box-shadow:0 0 0 3px color-mix(in oklch,var(--fill) 35%,transparent)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(17rem,1fr));gap:.75rem}
.card{display:flex;flex-direction:column;border:1px solid var(--border);border-radius:.75rem;background:var(--raised);text-decoration:none;overflow:hidden;transition:border-color .15s,box-shadow .15s,transform .15s}
.card:hover{border-color:var(--strong);box-shadow:var(--shadow)}
.card:active{transform:translateY(1px)}
.peek{position:relative;display:flex;align-items:center;gap:.375rem;height:4.5rem;padding:0 1rem;border-bottom:1px solid var(--border);background:radial-gradient(circle at 1px 1px,var(--dots) 1px,transparent 0) 0 0/.75rem .75rem,var(--card)}
.tile{width:2.25rem;height:2.25rem;border-radius:.625rem;display:grid;place-items:center;background:var(--raised);border:1px solid var(--border);box-shadow:var(--shadow);font-size:.9375rem;font-weight:600;letter-spacing:-.01em}
.tile+.tile{margin-left:-.75rem}
.ver{position:absolute;top:.75rem;right:.75rem;font:500 .6875rem/1rem ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted);padding:.125rem .375rem;border:1px solid var(--border);border-radius:.375rem;background:var(--raised)}
.card-body{display:flex;flex-direction:column;gap:.75rem;padding:.75rem 1rem 1rem;flex:1}
.card-text{display:flex;flex-direction:column;gap:.25rem}
.card h2{font-size:.9375rem;line-height:1.375rem;font-weight:600;letter-spacing:-.01em}
.desc{font-size:.8125rem;line-height:1.25rem;color:var(--muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.chips{display:flex;flex-wrap:wrap;gap:.25rem}
.chip{display:inline-flex;align-items:center;gap:.25rem;height:1.25rem;padding:0 .375rem;border:1px solid var(--border);border-radius:.375rem;font-size:.6875rem;line-height:1;color:var(--muted);max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chip .w{color:var(--fg);font-weight:500}
.chip.write{border-color:var(--strong);color:var(--fg)}
.meta{display:flex;flex-wrap:wrap;align-items:center;gap:.375rem;margin-top:auto;font-size:.6875rem;line-height:1rem;color:var(--muted)}
.meta .sep{opacity:.5}
.meta .dot{width:.375rem;height:.375rem;box-shadow:none}
.empty{display:grid;gap:1.5rem;padding:1.5rem;border:1px dashed var(--strong);border-radius:1rem;background:var(--card)}
@media (min-width:900px){.empty{grid-template-columns:1fr 1fr;align-items:center}}
.empty-copy{display:flex;flex-direction:column;gap:.75rem}
.empty h2{font-size:1.125rem;line-height:1.5rem;font-weight:600;letter-spacing:-.01em}
.empty p{font-size:.8125rem;line-height:1.25rem;color:var(--muted)}
.empty .steps{grid-template-columns:none}
.prompt{font-size:.8125rem;line-height:1.25rem;padding:.5rem .75rem;border-radius:.625rem;border:1px solid var(--border);background:var(--raised);width:max-content;max-width:100%}
.nomatch{display:flex;flex-direction:column;align-items:flex-start;gap:.75rem;padding:1.5rem;border:1px dashed var(--strong);border-radius:1rem}
.nomatch p{font-size:.8125rem;line-height:1.25rem;color:var(--muted)}
.connect-line{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;font-size:.75rem;line-height:1rem;color:var(--muted)}
.connect-line .btn{height:1.5rem;padding:0 .5rem;font-size:.6875rem;border-radius:.375rem}
.connect-line .i{width:.75rem;height:.75rem}
.notfound{flex:1;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:.75rem;padding-top:1.5rem;padding-bottom:1.5rem}
.notfound h1{font-size:1.5rem;line-height:2rem;font-weight:600;letter-spacing:-.02em}
.notfound p{font-size:.875rem;color:var(--muted)}
@supports (corner-shape:squircle){.onemcp,.btn,.field,.card,.tile,.chip,.ver,.step,.art,.win,.empty,.nomatch,.alert,.search input,.prompt,code.inline{corner-shape:squircle}}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;

const THEME_BTN = `<button type="button" class="btn ghost icon" data-fb="theme" aria-label="Switch light or dark theme" title="Switch theme">${SUN}${MOON}</button>`;
const copyBtn = (value: string, cls = "btn") =>
  `<button type="button" class="${cls}" data-fb="copy" data-value="${esc(value)}" aria-label="Copy the connector URL">${COPY}${CHECK}<span class="idle">Copy</span><span class="done">Copied</span></button>`;

export const SECURED = "Secured by One. You connect your own accounts and can revoke them any time.";

export interface WebUser {
  name: string | null;
  email: string | null;
  avatar: string | null;
}

/** An app's logo from One's connector set, with its first letter underneath in case it fails to load. */
export const logo = (platform: string, cls = "tile") =>
  `<span class="${cls}" title="${esc(platformName(platform))}"><b aria-hidden="true">${esc(platformName(platform).charAt(0))}</b><img src="https://assets.withone.ai/connectors/${encodeURIComponent(platform)}.svg" alt="${esc(platformName(platform))}" decoding="async"></span>`;

export function shell(title: string, body: string, user: WebUser | null) {
  const initial = (user?.name ?? user?.email ?? "Y").trim().charAt(0).toUpperCase() || "Y";
  const avatar = user?.avatar
    ? `<span class="avatar"><b aria-hidden="true">${esc(initial)}</b><img src="${esc(user.avatar)}" alt="" referrerpolicy="no-referrer"></span>`
    : `<span class="avatar" aria-hidden="true"><b>${esc(initial)}</b></span>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><title>${esc(title)}</title>
<link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<script>${PAGE_SCRIPT}</script><style>${STYLE}</style></head><body>
<header class="top"><div class="wrap"><a class="brand" href="/" aria-label="Forkable blocks, home">${LOCKUP}<span class="brand-sub">blocks</span></a><span class="sp"></span>${
    user
      ? `<span class="who">${avatar}<span class="who-text"><span class="who-name">${esc(user.name ?? user.email ?? "Signed in")}</span>${user.email && user.name ? `<span class="who-mail">${esc(user.email)}</span>` : ""}</span></span>${THEME_BTN}<form method="post" action="/logout" style="margin:0"><button class="btn ghost">Sign out</button></form>`
      : `${THEME_BTN}<a class="btn ghost" href="/login">Sign in</a>`
  }</div></header>
${body}
<footer class="foot"><div class="wrap"><span>${SECURED}</span><span class="sp"></span><a href="https://forkable.dev">forkable.dev</a></div></footer>
</body></html>`;
}

export function landingPage(mcpUrl: string, failed: boolean) {
  return shell(
    "Forkable blocks",
    `<main class="wrap landing">
<section class="hero">
  <div class="hero-copy">
    <span class="eyebrow"><span class="dot"></span>A connector for Claude and ChatGPT</span>
    <h1>Your tools, as UI, in any chat</h1>
    <p class="lede">Ask your chat for a view of your inbox, a dashboard or a form. It builds the UI, runs it on your own accounts and saves it here.</p>
    ${failed ? `<p class="alert" role="alert">That sign-in did not finish. Try again.</p>` : ""}
    <div class="cta">
      <a class="btn primary lg" href="/login" style="width:max-content">${MARK}Sign in with One</a>
      <span class="label">Connector URL</span>
      <div class="field"><code>${esc(mcpUrl)}</code>${copyBtn(mcpUrl)}</div>
    </div>
  </div>
  <div class="art" aria-hidden="true">
    <div class="bubble">Show me who emails me most this week</div>
    <p class="reply">Here it is, running on your Gmail.</p>
    <div class="win">
      <div class="win-body">
        <div class="win-head"><b>Top senders</b><span>Last 7 days</span></div>
        <ul class="bars">
          <li><span>Priya Nair</span><i style="width:100%"></i><em>14</em></li>
          <li><span>Dana Ortiz</span><i style="width:72%"></i><em>10</em></li>
          <li><span>Acme Billing</span><i style="width:50%"></i><em>7</em></li>
          <li><span>Sam Lee</span><i style="width:36%"></i><em>5</em></li>
        </ul>
      </div>
      <div class="win-foot">${MARK}<span>Saved to your blocks, v1.</span><u>Open on the web</u></div>
    </div>
  </div>
</section>
<section style="display:flex;flex-direction:column;gap:.75rem">
  <h2 class="label">How it works</h2>
  <ol class="steps">${STEPS}</ol>
</section>
${ONE_MCP}
</main>`,
    null,
  );
}

const ONE_MCP_URL = "https://mcp.withone.ai/mcp";
const ONE_MCP = `<section class="onemcp">
  <div class="onemcp-copy"><h2>Even better with the One MCP</h2>
  <p>Add One's MCP next to this connector. Your chat then learns every action across your apps in depth, builds better UIs and can do work outside them too. It takes the same sign-in.</p></div>
  <div class="onemcp-act"><div class="field"><code>${ONE_MCP_URL}</code>${copyBtn(ONE_MCP_URL)}</div><a class="btn ghost" href="https://www.withone.ai/docs/mcp" target="_blank" rel="noopener">How to add it ${ARROW}</a></div>
</section>`;

const STEPS = [
  ["Add the connector", "In Claude or ChatGPT, add the URL as a custom connector. Sign in with One when it asks."],
  ["Ask for a UI", "Say what you want to see. The chat builds it and runs it on your own accounts."],
  ["Find it here", "Every UI you make is saved. Open it on the web, switch versions or delete it."],
]
  .map(([h, p]) => `<li class="step"><h3>${h}</h3><p>${p}</p></li>`)
  .join("");

const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d}d ago` : new Date(t).toISOString().slice(0, 10);
};

const platformName = (p: string) =>
  p
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

interface Ui {
  id: string;
  title: string;
  description: string;
  current_version: number;
  updated_at: number;
  actions: DeclaredAction[];
}

function card(u: Ui) {
  const writes = u.actions.filter((a) => a.write).length;
  const platforms = [...new Set(u.actions.map((a) => a.platform))];
  const tiles = platforms.length ? platforms.slice(0, 3).map((p) => logo(p)).join("") : `<span class="tile"><b>${MARK}</b></span>`;
  const chips = u.actions
    .slice(0, 3)
    .map((a) => `<span class="chip${a.write ? " write" : ""}">${logo(a.platform, "chip-logo")}${esc(a.title)}${a.write ? ` <span class="w">write</span>` : ""}</span>`)
    .join("");
  const more = u.actions.length > 3 ? `<span class="chip">+${u.actions.length - 3}</span>` : "";
  return `<a class="card" href="/u/${esc(u.id)}">
<div class="peek">${tiles}<span class="ver">v${u.current_version}</span></div>
<div class="card-body">
  <div class="card-text"><h2>${esc(u.title)}</h2>${u.description ? `<p class="desc">${esc(u.description)}</p>` : ""}</div>
  ${chips || more ? `<div class="chips">${chips}${more}</div>` : ""}
  <div class="meta"><span>Updated ${ago(u.updated_at)}</span>${
    writes ? `<span class="sep">·</span><span class="dot"></span><span>${writes} write${writes > 1 ? "s" : ""}, asks first</span>` : `<span class="sep">·</span><span>Read only</span>`
  }</div>
</div></a>`;
}

export function blocksPage(user: WebUser, uis: Ui[], q: string, mcpUrl: string) {
  const connectLine = `<div class="connect-line"><span>Connector</span><code class="inline">${esc(mcpUrl)}</code>${copyBtn(mcpUrl, "btn")}</div>`;
  let content: string;
  if (uis.length) content = `<section class="grid">${uis.map(card).join("")}</section>${connectLine}${ONE_MCP}`;
  else if (q)
    content = `<section class="nomatch"><p>Nothing matches “${esc(q)}”.</p><a class="btn" href="/">Clear search</a></section>`;
  else
    content = `<section class="empty">
  <div class="empty-copy">
    <h2>Nothing saved yet</h2>
    <p>Add the connector to Claude or ChatGPT, then ask for something you want to see. It lands here.</p>
    <span class="label">Connector URL</span>
    <div class="field"><code>${esc(mcpUrl)}</code>${copyBtn(mcpUrl)}</div>
    <span class="label">Try asking</span>
    <span class="prompt">Make me a dashboard of who emails me most</span>
  </div>
  <ol class="steps">${STEPS}</ol>
</section>${ONE_MCP}`;
  const searchable = uis.length > 0 || q;
  return shell(
    "Your blocks",
    `<main class="wrap list">
<section class="head">
  <div class="head-copy"><h1>Your blocks${uis.length ? ` <span class="count">${uis.length}</span>` : ""}</h1><p>Every UI you asked for in a chat. Each one opens live on your own accounts.</p></div>
  ${searchable ? `<form class="search" method="get" action="/" role="search">${SEARCH}<input type="search" name="q" value="${esc(q)}" placeholder="Search blocks" aria-label="Search blocks"></form>` : ""}
</section>
${content}
</main>`,
    user,
  );
}

export function notFoundPage(user: WebUser) {
  return shell(
    "Not found",
    `<main class="wrap notfound"><h1>Not found</h1><p>This UI is not in your account.</p><a class="btn" href="/">${ARROW}Back to your blocks</a></main>`,
    user,
  );
}

// ---- Sign-in pages a chat app opens ---------------------------------
// The consent page before One's sign-in, the "you're connected" page on the
// way back, and the plain message pages. Same tokens and type as the site.

/** Like pageCsp, but no form-action: the consent form's answer redirects to One or back to the chat app. */
export async function authCsp() {
  return (await pageCsp()).replace(" form-action 'self';", "");
}

const AUTH_STYLE = `
.auth{min-height:100vh;display:grid;place-items:center;padding:2rem 1rem;background:radial-gradient(circle at 1px 1px,var(--dots) 1px,transparent 0) 0 0/1.25rem 1.25rem}
.auth-col{width:100%;max-width:26rem;display:flex;flex-direction:column;gap:1rem;align-items:center}
.auth-top{display:flex;align-items:center;gap:.5rem;width:100%}
.auth-top .sp{flex:1}
.auth-card{width:100%;display:flex;flex-direction:column;gap:1.5rem;padding:1.5rem;border:1px solid var(--border);border-radius:1rem;background:var(--raised);box-shadow:var(--shadow)}
.pair{display:flex;align-items:center;justify-content:center;gap:.75rem}
.pair .app{width:3rem;height:3rem;border-radius:.875rem;display:grid;place-items:center;border:1px solid var(--border);background:var(--bg);overflow:hidden;position:relative;font-weight:600;font-size:1.125rem}
.pair .app img{position:absolute;inset:.625rem;width:calc(100% - 1.25rem);height:calc(100% - 1.25rem);object-fit:contain}
.pair .app.fk{background:var(--fill);border-color:transparent;color:#000}
.pair .app.fk .mark{height:1.5rem;width:auto}
.pair .link{display:flex;align-items:center;gap:.25rem;color:var(--strong)}
.pair .link i{display:block;width:.375rem;height:.375rem;border-radius:999px;background:currentColor;opacity:.6}
.pair .link i:nth-child(2){opacity:1;background:var(--green)}
.auth-head{display:flex;flex-direction:column;gap:.375rem;text-align:center}
.auth-head h1{margin:0;font-size:1.25rem;line-height:1.75rem;font-weight:600;letter-spacing:-.015em}
.auth-head p{margin:0;font-size:.875rem;line-height:1.25rem;color:var(--muted)}
.perms{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;border:1px solid var(--border);border-radius:.75rem;background:var(--card);overflow:hidden}
.perms li{display:flex;gap:.75rem;align-items:flex-start;padding:.75rem}
.perms li+li{border-top:1px solid var(--border)}
.perms .ic{flex:none;width:1.75rem;height:1.75rem;border-radius:.5rem;display:grid;place-items:center;background:var(--raised);border:1px solid var(--border);color:var(--fg)}
.perms .ic svg{width:.875rem;height:.875rem}
.perms b{display:block;font-size:.8125rem;line-height:1.25rem;font-weight:600}
.perms span{display:block;font-size:.75rem;line-height:1rem;color:var(--muted)}
.auth-next{display:flex;align-items:center;gap:.5rem;font-size:.75rem;line-height:1rem;color:var(--muted)}
.auth-next .mark{height:.875rem;width:auto;color:var(--fg);flex:none}
.auth-actions{display:flex;flex-direction:column;gap:.5rem}
.auth-actions .btn{width:100%}
.auth-actions .btn.primary .mark{height:1rem;width:auto}
.auth-foot{font-size:.75rem;line-height:1rem;color:var(--muted);text-align:center;max-width:22rem}
.auth-foot a{color:inherit}
.done-badge{margin:0 auto;width:3.5rem;height:3.5rem;border-radius:999px;display:grid;place-items:center;background:var(--fill);color:#000}
.done-badge svg{width:1.5rem;height:1.5rem;stroke-width:2.25}
.who-chip{display:flex;align-items:center;gap:.5rem;justify-content:center;font-size:.8125rem;color:var(--muted)}
.who-chip b{color:var(--fg);font-weight:500}
.progress{height:.25rem;border-radius:999px;background:var(--card);overflow:hidden}
.progress i{display:block;height:100%;width:100%;background:var(--fill);transform-origin:left;animation:fb-go 1.6s linear forwards}
@keyframes fb-go{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@media (prefers-reduced-motion:reduce){.progress i{animation:none}}
@supports (corner-shape:squircle){.auth-card,.perms,.perms .ic,.pair .app{corner-shape:squircle}}
`;

const SHIELD = icon('<path d="M12 3 5 6v5c0 4.5 3 8.4 7 10 4-1.6 7-5.5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>');
const LAYOUT = icon('<rect x="3.5" y="4" width="17" height="16" rx="2.5"/><path d="M3.5 9h17M9 9v11"/>');
const BOOKMARK = icon('<path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1Z"/>');

/** The chat app asking, by its redirect host: a friendly name and its own icon. */
export function chatApp(host: string, clientName?: string | null) {
  const known: Record<string, string> = { "claude.ai": "Claude", "chatgpt.com": "ChatGPT", "chat.openai.com": "ChatGPT" };
  const base = host.replace(/^www\./, "");
  const name = known[base] ?? (clientName?.trim() || base);
  return { name, host: base, icon: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(base)}&sz=64` };
}

function authShell(title: string, body: string, extraHead = "") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="robots" content="noindex"><title>${esc(title)}</title>${extraHead}
<link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" href="/favicon.svg" type="image/svg+xml">
<script>${PAGE_SCRIPT}</script><style>${STYLE}${AUTH_STYLE}</style></head><body>
<main class="auth"><div class="auth-col">
<div class="auth-top"><span class="brand">${LOCKUP}<span class="brand-sub">blocks</span></span><span class="sp"></span>${THEME_BTN}</div>
${body}
<p class="auth-foot">${SECURED}</p>
</div></main></body></html>`;
}

const pair = (app: ReturnType<typeof chatApp>) =>
  `<div class="pair" aria-hidden="true"><span class="app"><b>${esc(app.name.charAt(0))}</b><img src="${esc(app.icon)}" alt="" referrerpolicy="no-referrer"></span><span class="link"><i></i><i></i><i></i></span><span class="app fk">${MARK}</span></div>`;

export function consentPage(opts: { app: ReturnType<typeof chatApp>; pendingId: string }) {
  const { app, pendingId } = opts;
  return authShell(
    `Connect ${app.name} to Forkable blocks`,
    `<section class="auth-card" aria-labelledby="t">
  ${pair(app)}
  <div class="auth-head"><h1 id="t">Connect ${esc(app.name)} to Forkable blocks</h1><p>${esc(app.host)} wants to show your tools as live UI in its chats.</p></div>
  <ul class="perms">
    <li><span class="ic">${LAYOUT}</span><div><b>Your tools, as UI in the chat</b><span>Your inbox, calendar, deals and more, running on your own accounts.</span></div></li>
    <li><span class="ic">${BOOKMARK}</span><div><b>Every UI is saved for you</b><span>Open it again in any chat or at blocks.forkable.dev.</span></div></li>
    <li><span class="ic">${SHIELD}</span><div><b>You confirm every change</b><span>Nothing is sent, changed or deleted until you say so.</span></div></li>
  </ul>
  <p class="auth-next">${MARK}<span>Next, sign in with One and choose exactly what ${esc(app.name)} can reach.</span></p>
  <form method="post" action="/authorize" class="auth-actions">
    <input type="hidden" name="id" value="${esc(pendingId)}">
    <button class="btn primary lg" name="ok" value="1">${MARK}Continue with One</button>
    <button class="btn ghost lg" name="ok" value="0">Cancel</button>
  </form>
</section>`,
  );
}

export function connectedPage(opts: { app: ReturnType<typeof chatApp>; redirectTo: string; who?: { name: string | null; email: string | null } | null }) {
  const { app, redirectTo, who } = opts;
  const label = who?.name || who?.email;
  return authShell(
    `Connected to ${app.name}`,
    `<section class="auth-card" aria-labelledby="t">
  <div class="done-badge" aria-hidden="true">${CHECK}</div>
  <div class="auth-head"><h1 id="t">You're connected</h1><p>Taking you back to ${esc(app.name)}. Ask it for a UI of anything in your accounts.</p></div>
  ${label ? `<p class="who-chip">Signed in as <b>${esc(label)}</b>${who?.name && who?.email ? ` · ${esc(who.email)}` : ""}</p>` : ""}
  <div class="progress" aria-hidden="true"><i></i></div>
  <div class="auth-actions"><a class="btn primary lg" href="${esc(redirectTo)}">Return to ${esc(app.name)}</a></div>
</section>`,
    `<meta http-equiv="refresh" content="1.6;url=${esc(redirectTo)}">`,
  );
}

export function messagePage(title: string, text: string, action?: { href: string; label: string }) {
  return authShell(
    title,
    `<section class="auth-card" aria-labelledby="t">
  <div class="auth-head"><h1 id="t">${esc(title)}</h1><p>${esc(text)}</p></div>
  ${action ? `<div class="auth-actions"><a class="btn lg" href="${esc(action.href)}">${esc(action.label)}</a></div>` : ""}
</section>`,
  );
}
