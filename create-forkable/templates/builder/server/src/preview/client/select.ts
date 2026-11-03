import { toEditor } from "./channel";
import { LOC_ATTR, SLUG } from "./env";
import type { Mode, Selection } from "./types";

// Select mode: hover outlines elements by their data-<slug>-loc, a click
// selects (Cmd or Ctrl adds), ArrowUp and ArrowDown walk to the tagged
// parent or first tagged child, Esc leaves. The overlay lives in a shadow
// root so the app's CSS cannot reach it.

let mode: Mode = "none";
let hovered: Element | null = null;
let current: Element | null = null;
let selected: Element[] = [];
let highlighted: Element | null = null;
let editing: HTMLElement | null = null;
let editBefore = "";
let pendingLocs: string[] = [];

let host: HTMLElement | null = null;
let shadow: ShadowRoot | null = null;
let hoverBox: HTMLDivElement | null = null;
let hoverLabel: HTMLDivElement | null = null;
let highlightBox: HTMLDivElement | null = null;
let selectedLayer: HTMLDivElement | null = null;
let pendingLayer: HTMLDivElement | null = null;

const ACCENT = "#3b6fe0";

function ensureOverlay(): void {
  if (host && document.documentElement.contains(host)) return;
  host = document.createElement(`${SLUG}-overlay`);
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;display:block;";
  shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<style>
    .box{position:fixed;box-sizing:border-box;border-radius:3px;pointer-events:none;transition:all 60ms ease-out}
    .hover{outline:1.5px solid ${ACCENT};background:rgba(59,111,224,.08)}
    .sel{outline:2px solid ${ACCENT};background:rgba(59,111,224,.12)}
    .hl{outline:2px dashed ${ACCENT}}
    .pending{outline:1.5px dashed #d97706;background:rgba(217,119,6,.06)}
    .editing{outline:2px solid ${ACCENT};background:transparent}
    .label{position:fixed;pointer-events:none;font:500 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:#fff;background:${ACCENT};
      padding:4px 6px;border-radius:3px;white-space:nowrap;max-width:60vw;overflow:hidden;text-overflow:ellipsis;box-shadow:0 2px 8px rgba(0,0,0,.2)}
    .label b{font-weight:600}
    .label span{opacity:.8;margin-left:6px}
    [hidden]{display:none}
  </style>
  <div class="box hover" hidden></div><div class="label" hidden></div><div class="box hl" hidden></div><div class="layer"></div><div class="pend"></div>`;
  hoverBox = shadow.querySelector(".hover");
  hoverLabel = shadow.querySelector(".label");
  highlightBox = shadow.querySelector(".hl");
  selectedLayer = shadow.querySelector(".layer");
  pendingLayer = shadow.querySelector(".pend");
  document.documentElement.appendChild(host);
}

const locOf = (el: Element | null): string | null => el?.getAttribute(LOC_ATTR) ?? null;

/** Nearest element with a loc, starting at el (untagged elements from node_modules select their tagged ancestor). */
function tagged(el: Element | null): Element | null {
  let n: Element | null = el;
  while (n && n !== document.documentElement) {
    if (n.hasAttribute(LOC_ATTR)) return n;
    n = n.parentElement;
  }
  return null;
}

function taggedParent(el: Element): Element | null {
  return tagged(el.parentElement);
}

function firstTaggedChild(el: Element): Element | null {
  return el.querySelector(`[${LOC_ATTR}]`);
}

function ancestors(el: Element): string[] {
  const out: string[] = [];
  let n = taggedParent(el);
  while (n) {
    const l = locOf(n);
    if (l) out.push(l);
    n = taggedParent(n);
  }
  return out;
}

function place(box: HTMLElement, el: Element): void {
  const r = el.getBoundingClientRect();
  box.style.left = `${r.left}px`;
  box.style.top = `${r.top}px`;
  box.style.width = `${r.width}px`;
  box.style.height = `${r.height}px`;
  box.hidden = false;
}

function shortLoc(loc: string): string {
  const [file, line] = loc.split(":");
  return `${file?.replace(/^src\//, "")}:${line}`;
}

function renderHover(): void {
  if (!hoverBox || !hoverLabel) return;
  if (mode === "none" || !hovered || hovered === editing) {
    hoverBox.hidden = true;
    hoverLabel.hidden = true;
    return;
  }
  place(hoverBox, hovered);
  const loc = locOf(hovered) ?? "";
  hoverLabel.innerHTML = "";
  const b = document.createElement("b");
  b.textContent = mode === "text" ? (hasOwnText(hovered) ? "Edit text" : "No text here") : mode === "comment" ? "Comment" : `<${hovered.tagName.toLowerCase()}>`;
  const s = document.createElement("span");
  s.textContent = mode === "select" ? shortLoc(loc) : `<${hovered.tagName.toLowerCase()}>`;
  hoverLabel.append(b, s);
  hoverLabel.hidden = false;
  const r = hovered.getBoundingClientRect();
  const top = r.top > 24 ? r.top - 22 : r.bottom + 4;
  hoverLabel.style.left = `${Math.max(2, Math.min(r.left, window.innerWidth - 200))}px`;
  hoverLabel.style.top = `${top}px`;
}

function renderSelected(): void {
  if (!selectedLayer) return;
  selectedLayer.innerHTML = "";
  for (const el of selected) {
    if (!el.isConnected) continue;
    const box = document.createElement("div");
    box.className = "box sel";
    place(box, el);
    selectedLayer.appendChild(box);
  }
  if (highlightBox) {
    if (highlighted?.isConnected) place(highlightBox, highlighted);
    else highlightBox.hidden = true;
  }
  if (pendingLayer) {
    pendingLayer.innerHTML = "";
    const boxes: Element[] = [];
    for (const loc of pendingLocs) {
      const el = byLoc(loc);
      if (el) boxes.push(el);
    }
    for (const el of boxes) {
      const box = document.createElement("div");
      box.className = el === editing ? "box editing" : "box pending";
      place(box, el);
      pendingLayer.appendChild(box);
    }
    if (editing && !pendingLocs.includes(locOf(editing) ?? "")) {
      const box = document.createElement("div");
      box.className = "box editing";
      place(box, editing);
      pendingLayer.appendChild(box);
    }
  }
}

/** Has a direct, non-empty text node (a heading, a label, a button's words). */
function hasOwnText(el: Element): boolean {
  return Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "");
}

function startEdit(el: HTMLElement): void {
  if (editing) commitEdit();
  editing = el;
  editBefore = el.innerText;
  el.setAttribute("contenteditable", "plaintext-only");
  el.setAttribute("spellcheck", "false");
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  el.addEventListener("keydown", onEditKey, true);
  el.addEventListener("blur", onEditBlur, true);
  rerender();
}

function stopEdit(): HTMLElement | null {
  const el = editing;
  if (!el) return null;
  el.removeAttribute("contenteditable");
  el.removeAttribute("spellcheck");
  el.removeEventListener("keydown", onEditKey, true);
  el.removeEventListener("blur", onEditBlur, true);
  editing = null;
  rerender();
  return el;
}

function commitEdit(): void {
  const el = stopEdit();
  if (!el) return;
  const after = el.innerText;
  const loc = locOf(el);
  if (!loc || after.trim() === editBefore.trim()) return;
  if (!pendingLocs.includes(loc)) pendingLocs = [...pendingLocs, loc];
  toEditor({ kind: "edit-text", loc, tag: el.tagName.toLowerCase(), before: editBefore.trim(), after: after.trim() });
  rerender();
}

function onEditKey(e: KeyboardEvent): void {
  e.stopPropagation();
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    commitEdit();
  } else if (e.key === "Escape") {
    e.preventDefault();
    const el = stopEdit();
    if (el) el.innerText = editBefore;
  }
}

function onEditBlur(): void {
  commitEdit();
}

export function applyClass(loc: string, remove: string[], add: string[]): void {
  for (const el of Array.from(document.querySelectorAll(`[${LOC_ATTR}="${CSS.escape(loc)}"]`))) {
    for (const c of remove) el.classList.remove(c);
    for (const c of add) if (c) el.classList.add(c);
  }
  rerender();
}

export function setPending(locs: string[]): void {
  ensureOverlay();
  pendingLocs = locs;
  rerender();
}

let raf = 0;
function rerender(): void {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    renderHover();
    renderSelected();
  });
}

function toSelection(el: Element): Selection {
  const r = el.getBoundingClientRect();
  const text = (el as HTMLElement).innerText ?? el.textContent ?? "";
  const cls = typeof (el as HTMLElement).className === "string" ? (el as HTMLElement).className : el.getAttribute("class") ?? "";
  return {
    loc: locOf(el) ?? "",
    tag: el.tagName.toLowerCase(),
    text: text.trim().replace(/\s+/g, " ").slice(0, 160) || undefined,
    classes: cls.slice(0, 300) || undefined,
    rect: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },
  };
}

function emitSelect(additive: boolean): void {
  toEditor({
    kind: "select",
    selections: selected.filter((e) => e.isConnected).map(toSelection),
    additive,
    ancestors: current ? ancestors(current) : [],
  });
}

function choose(el: Element, additive: boolean): void {
  current = el;
  if (additive) {
    if (selected.includes(el)) selected = selected.filter((e) => e !== el);
    else selected = [...selected, el];
  } else selected = [el];
  emitSelect(additive);
  rerender();
}

function onMove(e: MouseEvent): void {
  if (mode === "none") return;
  const el = tagged(e.target as Element);
  if (el !== hovered) {
    hovered = el;
    toEditor({ kind: "hover", loc: locOf(el) });
    rerender();
  }
}

function swallow(e: Event): void {
  if (mode === "none") return;
  // While editing text, clicks inside the element place the caret.
  if (editing && e.target instanceof Node && editing.contains(e.target)) return;
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
}

function onClick(e: MouseEvent): void {
  if (mode === "none") return;
  if (editing && e.target instanceof Node && editing.contains(e.target)) return;
  swallow(e);
  // mousedown was swallowed, so the frame never took focus; take it so the
  // arrow keys and Esc reach this document.
  window.focus();
  const el = tagged(e.target as Element);
  if (!el) return;
  if (mode === "select") choose(el, e.metaKey || e.ctrlKey);
  else if (mode === "comment") toEditor({ kind: "comment", selection: toSelection(el) });
  else if (mode === "text") {
    // The tagged element itself, or the clicked text's own element when it is tagged.
    if (hasOwnText(el)) startEdit(el as HTMLElement);
    else if (editing) commitEdit();
  }
}

function onKeyInSelect(e: KeyboardEvent): boolean {
  if ((mode === "text" || mode === "comment") && e.key === "Escape" && !editing) {
    e.preventDefault();
    setMode("none", true);
    return true;
  }
  if (mode !== "select") return false;
  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    const base = current ?? hovered;
    if (!base) return true;
    const next = e.key === "ArrowUp" ? taggedParent(base) : firstTaggedChild(base);
    if (next) {
      hovered = next;
      choose(next, false);
    }
    e.preventDefault();
    return true;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    if (selected.length) {
      clearSelection();
      emitSelect(false);
    } else setMode("none", true);
    return true;
  }
  return false;
}

export function setMode(next: Mode, tellEditor = false): void {
  if (next !== "text" && editing) commitEdit();
  mode = next;
  ensureOverlay();
  document.documentElement.style.cursor = next === "select" || next === "comment" ? "crosshair" : next === "text" ? "text" : "";
  if (next !== "select") hovered = null;
  rerender();
  if (tellEditor) toEditor({ kind: "mode", mode: next });
}

export function clearSelection(): void {
  selected = [];
  current = null;
  rerender();
}

function byLoc(loc: string): Element | null {
  try {
    return document.querySelector(`[${LOC_ATTR}="${CSS.escape(loc)}"]`);
  } catch {
    return null;
  }
}

export function highlight(loc: string | null): void {
  ensureOverlay();
  highlighted = loc ? byLoc(loc) : null;
  rerender();
}

export function scrollTo(loc: string): void {
  const el = byLoc(loc);
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  highlight(loc);
}

export function getMode(): Mode {
  return mode;
}

export function installSelect(onKey: (e: KeyboardEvent) => void): void {
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  for (const t of ["mousedown", "mouseup", "pointerdown", "pointerup", "dblclick", "submit"]) document.addEventListener(t, swallow, true);
  document.addEventListener(
    "keydown",
    (e) => {
      if (onKeyInSelect(e)) return;
      onKey(e);
    },
    true,
  );
  window.addEventListener("scroll", rerender, true);
  window.addEventListener("resize", rerender);
  new MutationObserver(rerender).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style"] });
}
