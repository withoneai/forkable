// Models before mapping: titles and paths from One's real catalogs (HubSpot,
// Attio, Zendesk, 2026-10-29) group into the models a person picks.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { groupModels, nounFromTitle } from "../src/mapper/models.js";
import { classifyAction } from "../src/mapper/catalog.js";

const act = (title: string, method: string, path: string) => ({ actionId: `a:${title}`, title, method, path, tags: [], ...classifyAction({ title, method, path }), permitted: true });

describe("models", () => {
  it("reads the model from the title, the parentheses or the path", () => {
    assert.equal(nounFromTitle("List CRM Objects (Deals) by Object Type"), "Deals");
    assert.equal(nounFromTitle("List CRM Objects (Read a Page of Leads) by Object Type"), "Leads");
    assert.equal(nounFromTitle("Retrieve Appointments (List CRM Objects by Type)"), "Appointments");
    assert.equal(nounFromTitle("Search CRM Contacts", "HubSpot"), "Contacts");
    assert.equal(nounFromTitle("Get and View People"), "People");
    assert.equal(nounFromTitle("List CRM Objects (by Object Type)"), null);
  });
  it("groups HubSpot's object-type lists by model and fills the path value", () => {
    const { models, hidden } = groupModels([
      act("List CRM Objects (Deals) by Object Type", "GET", "/crm/objects/2026-03/{{objectType}}"),
      act("Search CRM Objects (Deals) by Object Type", "POST", "/crm/objects/2026-03/{{objectType}}/search"),
      act("List Contacts (CRM)", "GET", "/crm/v3/objects/contacts"),
      act("Search CRM Contacts", "POST", "/crm/v3/objects/contacts/search"),
      act("List Tax Rates", "GET", "/tax-rates/v1/tax-rates"),
      act("List CRM Objects (by Object Type)", "GET", "/crm/objects/2026-03/{{objectType}}"),
      act("Retrieve a CRM Object (Company)", "GET", "/crm/objects/2026-03/{{objectType}}/{{objectId}}"),
      act("Create a Contact", "POST", "/crm/v3/objects/contacts"),
      act("Count Users", "GET", "/api/v2/users/count"),
    ], { platformName: "HubSpot", builtin: new Map([["contact", "hubspot.contacts"]]) });
    const deal = models.find((m) => m.key === "deal")!;
    assert.equal(deal.kind, "deal");
    assert.equal(deal.actions.length, 2);
    assert.deepEqual(deal.actions[0]!.pathVars, { objectType: "deals" });
    assert.ok(deal.suggested);
    const contact = models.find((m) => m.key === "contact")!;
    assert.equal(contact.builtinProfile, "hubspot.contacts");
    assert.equal(contact.suggested, false);
    assert.equal(models.find((m) => m.key === "tax_rate")?.suggested, false);
    assert.equal(models[0]!.key, "deal", "suggested first");
    assert.equal(hidden, 4);
  });
});
