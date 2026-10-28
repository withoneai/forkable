// Unit test for the render_ui style check: node --test scripts/stylecheck.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkStyle, styleNote } from "../src/stylecheck.ts";
import { GUIDE_EXAMPLE } from "../src/guide.ts";

const has = (w, re) => assert.ok(w.some((l) => re.test(l)), `expected a warning matching ${re}, got:\n${w.join("\n")}`);

test("clean kit code has no warnings", () => {
  const src = `import { Page, Table, Button } from "@forkable/ui";
export default function A() {
  const live = true;
  return <Page title="Deals" description="Don't miss the 'hot' ones, issue #123">
    <div className={live ? "flex gap-2 p-3 text-13" : "hidden"} style={{ width: \`\${40}%\` }}>
      <Button variant="primary" className="hover:bg-primary-hover md:gap-1.5 [&>svg]:size-3">Go</Button>
      <input type="checkbox" />
    </div>
  </Page>;
}`;
  assert.deepEqual(checkStyle(src), []);
  assert.equal(styleNote(src), "");
});

test("the ui_guide example passes its own check", () => {
  assert.deepEqual(checkStyle(GUIDE_EXAMPLE), []);
});

test("arbitrary values", () => {
  has(checkStyle(`<div className="text-[12px] p-[7px] hover:w-[300px]" />`), /Arbitrary values.*text-\[12px\]/);
  has(checkStyle(`<div className="bg-[#ff0000]" />`), /Arbitrary/);
});

test("off-ladder spacing, also inside cn() and ternaries", () => {
  has(checkStyle(`<div className={cn("p-5", x && "gap-7")} />`), /Off-ladder spacing \(p-5, gap-7\)/);
  has(checkStyle(`<div className={x ? "mt-10" : "mt-2"} />`), /spacing \(mt-10\)/);
  assert.deepEqual(checkStyle(`<div className="p-0 px-3 gap-2.5 -mt-1 mx-auto space-y-6 m-px" />`), []);
});

test("off-ladder type sizes", () => {
  has(checkStyle(`<h1 className="text-base md:text-4xl" />`), /Off-ladder type \(text-base, md:text-4xl\)/);
  has(checkStyle(`<h1 className="text-12" />`), /Off-ladder type/);
  assert.deepEqual(checkStyle(`<h1 className="text-11 text-13 text-15 text-xs text-sm text-lg text-28" />`), []);
});

test("palette colors, hex and color functions", () => {
  has(checkStyle(`<div className="bg-blue-500 text-white dark:text-gray-400/50" />`), /Palette colors \(bg-blue-500, text-white, dark:text-gray-400\/50\)/);
  has(checkStyle(`const c = "#1a2b3c";`), /Hard-coded colors.*#1a2b3c/);
  has(checkStyle(`<div style={{ background: "rgb(1,2,3)" }} />`), /Hard-coded colors.*rgb/);
});

test("inline style for color or spacing, not for a computed width", () => {
  has(checkStyle(`<div style={{ padding: 12 }} />`), /Inline style sets padding/);
  has(checkStyle(`<div style={{ color: "red", width: "50%" }} />`), /Inline style sets color/);
  assert.deepEqual(checkStyle(`<div style={{ width: pct + "%", height: 8 }} />`), []);
});

test("emoji, not the copyright sign", () => {
  has(checkStyle(`<span>Done 🎉</span>`), /Emoji \(🎉\)/);
  assert.deepEqual(checkStyle(`<span>© Acme Inc</span>`), []);
});

test("raw elements that have a kit component", () => {
  const w = checkStyle(`<table /><select></select><textarea /><input value={v} />`);
  has(w, /Raw <table>/);
  has(w, /Raw <select>/);
  has(w, /Raw <textarea>/);
  has(w, /Raw <input>/);
});

test("at most 8 warnings, one line each, and the note tells the agent what to do", () => {
  const src = `<table/><select/><textarea/><input/> <div className="p-5 text-base bg-red-500 w-[3px]" style={{ margin: 3 }}>🎉 "#fff"</div>`;
  const w = checkStyle(src);
  assert.equal(w.length, 8);
  assert.ok(w.every((l) => !l.includes("\n")));
  const note = styleNote(src);
  assert.match(note, /Style check, 8 to fix with update_ui \(see ui_guide\)/);
});
