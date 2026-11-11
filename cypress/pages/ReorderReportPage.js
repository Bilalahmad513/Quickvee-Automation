const { parseMultipart, buildMultipart } = require("../support/multipart");

// Reporting > Inventory > Reorder Report
// (/merchants/store-reporting/inventory-report/recorder-inventory - "recorder"
// is the app's own spelling). Lists every product of the store with
// "All inventory"; the date range only affects the sales columns. Its data
// comes from the reports API - live it's /api/reports/inventory/reorder_list
// (the older PHP InventoryReportPk/Reorder_list is accepted too). Per row:
//   reorder point  = the product's Reorder point
//   reorder qty    = the product's Reorder quantity
//   restock amount = the product's Reorder quantity too (the API fills it
//                    from the same value)
// The table shows "Reorder point" and "Restock amount" only once they're
// ticked in the column picker behind the header's "+" icon.
let searchCounter = 0;

const REORDER_LIST_URL = /\/(api\/reports\/inventory\/reorder_list|InventoryReportPk\/Reorder_list)/i;

// A request's fields whether it was sent as multipart, JSON or a query
// string.
function requestFields(request) {
  const contentType = String(request.headers["content-type"] || "");
  if (/multipart/i.test(contentType)) return parseMultipart(request.body, contentType);
  if (request.body && typeof request.body === "object") return request.body;
  const text = String(request.body || "");
  const json = Cypress._.attempt(JSON.parse, text);
  if (json && !(json instanceof Error)) return json;
  return Cypress._.fromPairs(Array.from(new URLSearchParams(text)));
}

// Every string value of an object, nested ones included.
function stringValues(node, out = []) {
  if (typeof node === "string") out.push(node);
  else if (node && typeof node === "object") Object.values(node).forEach((v) => stringValues(v, out));
  return out;
}

// A row's product name, whatever the API version calls it.
const NAME_KEY = /^(name|title|product_?name|item_?name|product_?title)$/i;
function rowName(row) {
  if (!row || typeof row !== "object") return "";
  const key = Object.keys(row).find((k) => NAME_KEY.test(k));
  return key ? String(row[key] ?? "").trim() : "";
}

// The rows anywhere in the response - its exact shape isn't fixed across
// API versions: the first array of objects that carry a product name.
function findRows(node) {
  if (Array.isArray(node)) {
    if (node.some((row) => row && typeof row === "object" && !Array.isArray(row) && Object.keys(row).some((k) => NAME_KEY.test(k)))) return node;
    for (const item of node) {
      const found = findRows(item);
      if (found) return found;
    }
    return null;
  }
  if (node && typeof node === "object") {
    for (const value of Object.values(node)) {
      const found = findRows(value);
      if (found) return found;
    }
  }
  return null;
}

class ReorderReportPage {
  visit() {
    cy.visit("/merchants/store-reporting/inventory-report/recorder-inventory");
    return this.searchInput().should("be.visible");
  }

  searchInput() {
    return cy.get('input[placeholder="Search Product by Title"]', { timeout: 60000 });
  }

  // "Today" / "Yesterday" / "Last 7 Days" / "Last 30 Days".
  selectDateRange(option) {
    return cy.contains(new RegExp(`^\\s*${option}\\s*$`), { timeout: 30000 }).click();
  }

  // Ticks `names` (checkbox names, e.g. "reorder_point", "reorder_amount")
  // in the "+" column picker, applies, and waits for each header.
  showColumns(names, headers) {
    cy.get("th.right-sticky img[alt='plusIcon']", { timeout: 60000 }).first().click();
    names.forEach((name) => cy.get(`input[name="${name}"]`, { timeout: 15000 }).check({ force: true }));
    cy.contains("button", /^\s*Apply\s*$/).click();
    return cy.wrap(headers).each((header) => cy.contains("th", new RegExp(`^\\s*${header}\\s*$`, "i"), { timeout: 15000 }).should("be.visible"));
  }

  // Runs `trigger` (e.g. picking a date range) and yields the page's own
  // first reorder_list call it causes: { url, headers, fields, contentType,
  // body, rows }, so the same request can be replayed with other fields.
  captureListCall(trigger) {
    searchCounter += 1;
    const alias = `reorderList${searchCounter}`;
    cy.intercept({ method: "POST", url: REORDER_LIST_URL }).as(alias);
    trigger();
    return cy.wait(`@${alias}`, { timeout: 60000 }).then(({ request, response }) => {
      const body = typeof response.body === "string" ? Cypress._.attempt(JSON.parse, response.body) : response.body;
      return {
        url: request.url,
        headers: request.headers,
        contentType: String(request.headers["content-type"] || ""),
        fields: requestFields(request),
        body,
        rows: findRows(body) || [],
      };
    });
  }

  // Replays a captured reorder_list call with some fields changed (e.g. a
  // bigger page) and yields its rows. Sent the way the page sent it -
  // multipart or JSON - with the page's own authorization.
  fetchRows(call, overrides) {
    const fields = { ...call.fields, ...overrides };
    const headers = { Authorization: call.headers.authorization };
    let body;
    if (/multipart/i.test(call.contentType)) {
      const multipart = buildMultipart(fields);
      headers["Content-Type"] = `multipart/form-data; boundary=${multipart.boundary}`;
      body = multipart.body;
    } else {
      headers["Content-Type"] = "application/json";
      body = fields;
    }
    return cy
      .request({ method: "POST", url: call.url, headers, body, timeout: 120000, failOnStatusCode: false, log: false })
      .then((res) => {
        expect(res.status, "reorder_list replay HTTP status").to.equal(200);
        const parsed = typeof res.body === "string" ? Cypress._.attempt(JSON.parse, res.body) : res.body;
        cy.task("log", `reorder_list replay answer: ${JSON.stringify(parsed).slice(0, 800)}`, { log: false });
        return cy.wrap(findRows(parsed) || [], { log: false });
      });
  }

  // Searches by title and yields the Reorder_list answer for that search.
  // Each search gets its own intercept alias, and calls for an older search
  // (or the page's own reloads) are skipped.
  search(title) {
    searchCounter += 1;
    const alias = `reorderList${searchCounter}`;
    cy.intercept({ method: "POST", url: REORDER_LIST_URL }).as(alias);
    this.searchInput().clear().type(title);
    cy.contains("button", /^\s*Search\s*$/).click();
    return this.waitForSearch(alias, title, 6);
  }

  // The call for this search: one whose fields carry the title (and isn't
  // for a later page). Yields { fields, body, rows }.
  waitForSearch(alias, title, attemptsLeft) {
    return cy.wait(`@${alias}`, { timeout: 60000 }).then(({ request, response }) => {
      const fields = requestFields(request);
      const forTitle = stringValues(fields).some((v) => v.trim().toLowerCase() === title.trim().toLowerCase());
      const page = fields.page ?? fields.pageNo ?? 1;
      if (forTitle && String(page) === "1") {
        const body = typeof response.body === "string" ? Cypress._.attempt(JSON.parse, response.body) : response.body;
        return { fields, body, rows: findRows(body) || [] };
      }
      if (attemptsLeft <= 1) throw new Error(`No reorder_list call for the search "${title}" (last one sent ${JSON.stringify(fields).slice(0, 300)}).`);
      return this.waitForSearch(alias, title, attemptsLeft - 1);
    });
  }

  // The rendered table row for `title` as { header: cell text }, once it's
  // shown; null if the table has no such row (after waiting).
  rowFor(title) {
    const same = (a, b) => String(a).replace(/\s+/g, " ").trim().toLowerCase() === String(b).replace(/\s+/g, " ").trim().toLowerCase();
    return cy
      .get("table", { timeout: 60000 })
      .should(($tables) => {
        const found = $tables.find("tbody tr").toArray().some((tr) => Cypress.$(tr).find("td").toArray().some((td) => same(td.textContent, title)));
        expect(found, `report row for "${title}"`).to.equal(true);
      })
      .then(($tables) => {
        const $row = Cypress.$(
          $tables.find("tbody tr").toArray().find((tr) => Cypress.$(tr).find("td").toArray().some((td) => same(td.textContent, title)))
        );
        const $table = $row.closest("table");
        const headers = $table.find("thead th").map((_, th) => th.textContent.replace(/\s+/g, " ").trim()).get();
        const cells = $row.children("td, th").map((_, td) => td.textContent.replace(/\s+/g, " ").trim()).get();
        return Cypress._.zipObject(headers, cells);
      });
  }
}

module.exports = new ReorderReportPage();
module.exports.rowName = rowName;
