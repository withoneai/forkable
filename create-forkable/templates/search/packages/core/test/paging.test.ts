// A Stripe-style list (has_more + data, next page after the last id): inference
// proposes lastId paging, a one-page map on a list that says it has more is
// flagged, and the engine never reconciles deletes from such a slice. A real run hit
// this on Stripe customers (2026-10-30): 10 of many read, 2 tombstoned on run 2.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inferHints, profileFromHints, signalsMore } from "../src/mapper/infer.js";

const page = { object: "list", url: "/v1/customers", has_more: true, data: Array.from({ length: 10 }, (_, i) => ({ id: `cus_${i}`, object: "customer", email: `c${i}@acme.com`, name: `Customer ${i}`, created: 1761700000 + i })) };

describe("paging", () => {
  it("infers lastId paging for a has_more + data list", () => {
    const h = inferHints(page, { model: "customers" });
    assert.deepEqual(h.pagination, { type: "lastId", idPath: "id", passAs: "query:starting_after", hasMore: "has_more" });
    const p = profileFromHints({ platform: "stripe", actionId: "a", title: "List all customers", method: "GET", path: "/v1/customers", hints: h });
    assert.deepEqual(p.list.pageSize, { param: "limit", value: 100 });
  });
  it("knows when a response says there is more", () => {
    assert.equal(signalsMore(page), true);
    assert.equal(signalsMore({ ...page, has_more: false }), false);
    assert.equal(signalsMore({ items: [], nextPageToken: "abc" }), true);
    assert.equal(signalsMore({ results: [], paging: { next: { after: "2" } } }), true);
    assert.equal(signalsMore({ results: [] }), false);
  });
});
