// The assistant's answer when the model writes prose first: a link template like
// "{{ item.id }}" in that prose must not hide the JSON object after it (a real run hit
// this on HubSpot Leads, 2026-10-30: the raw JSON showed and no change applied).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseAssist } from "../src/mapper/assist.js";

describe("assistant answer parsing", () => {
  it("finds the answer object after prose that contains template braces", () => {
    const text = 'I cleared the link. If you send it, I can set the link to `https://app.hubspot.com/contacts/<portalId>/record/0-136/{{ item.id }}`.\n\n{"reply":"I cleared the link. Use https://app.hubspot.com/contacts/<portalId>/record/0-136/{{ item.id }} later.","ops":[{"op":"map","model":"hubspot.leads","path":"url","target":"skip"},{"op":"identity","model":"hubspot.leads","urlTemplate":""}]}';
    const p = parseAssist(text);
    assert.match(p.reply, /^I cleared the link/);
    assert.ok(!p.reply.includes('"ops"'));
    assert.equal((p.ops as unknown[]).length, 2);
  });
  it("still reads a fenced block and a bare object", () => {
    assert.equal(parseAssist('Sure.\n```json\n{"reply":"ok","ops":[]}\n```').reply, "ok");
    assert.equal(parseAssist('{"reply":"bare","ops":[]}').reply, "bare");
  });
  it("falls back to the text when there is no answer object", () => {
    const p = parseAssist("Just words, {{ item.id }} and all.");
    assert.equal(p.reply, "Just words, {{ item.id }} and all.");
    assert.deepEqual(p.ops, []);
  });
});
