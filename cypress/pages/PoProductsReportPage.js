const { parseMultipart } = require("../support/multipart");

// Reporting > Inventory > PO Products Report
// (/merchants/store-reporting/po-products-report). Every product on the
// selected stores' purchase orders, one row per store + product + variant.
// Its data comes from the reports API (reports-migrations-api on test):
// POST api/reports/po_products_report, multipart, answering
//   { status, page, total_rows, rows: [...], totals: { products, stores,
//     stock_received, stock_sold, current_qty } }
// The five summary cards show `totals`; the table shows `rows`, one page at
// a time (page / page_size fields). Taken from the live app's bundle.
// The page opens on "All time" with every store of the account selected.
const API_URL = "**/api/reports/po_products_report";

// Summary card label -> its key in the API's `totals`.
const CARDS = {
  Products: "products",
  Stores: "stores",
  "Stock Received": "stock_received",
  "Stock Sold": "stock_sold",
  "Current Quantity": "current_qty",
};

const text = (el) => (el ? el.textContent : "").replace(/\s+/g, " ").trim();

// "1,234.5" -> 1234.5; "—" or "" -> null.
function numberOf(value) {
  const n = Number(String(value).replace(/,/g, "").trim());
  return String(value).trim() === "" || Number.isNaN(n) ? null : n;
}

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// The dates each date-picker preset sends, worked out the way the page
// does (browser-local dates). null for "All time" (no dates sent).
function presetDates(label, now = new Date()) {
  const daysAgo = (n) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - n);
  const monday = daysAgo((now.getDay() + 6) % 7);
  const ranges = {
    "All time": null,
    Today: [now, now],
    Yesterday: [daysAgo(1), daysAgo(1)],
    "Week-to-date": [monday, now],
    "Last 7 days": [daysAgo(6), now],
    "Month-to-date": [new Date(now.getFullYear(), now.getMonth(), 1), now],
    "Last 30 days": [daysAgo(29), now],
    "This year": [new Date(now.getFullYear(), 0, 1), now],
  };
  if (!(label in ranges)) throw new Error(`Unknown date range "${label}" - use one of: ${Object.keys(ranges).join(", ")}`);
  const range = ranges[label];
  return range && { start: ymd(range[0]), end: ymd(range[1]) };
}

class PoProductsReportPage {
  visit() {
    cy.visit("/merchants/store-reporting/po-products-report");
    return cy.contains("h1", /^\s*PO Products Report\s*$/, { timeout: 60000 }).should("be.visible");
  }

  // Keeps every answered report call the page makes - { fields, body } -
  // in `calls`. Register before visit(). A call the page aborts (it cancels
  // the previous one when the filters change) never answers, so it's never
  // kept - after:response only observes, where a req.continue callback
  // would fail the test on the aborted call ("Socket closed").
  recordCalls(calls) {
    cy.intercept({ method: "POST", url: API_URL }, (req) => {
      const fields = parseMultipart(req.body, req.headers["content-type"]);
      req.on("after:response", (res) => {
        const body = typeof res.body === "string" ? Cypress._.attempt(JSON.parse, res.body) : res.body;
        calls.push({ fields, body, status: res.statusCode, url: req.url });
      });
    });
  }

  // The latest call made after calls[from] that `isWanted(fields)`, once
  // it has answered.
  waitForCall(calls, from, isWanted, describe) {
    return cy
      .wrap(calls, { log: false, timeout: 120000 })
      .should((list) => {
        expect(list.slice(from).some((c) => isWanted(c.fields)), `po_products_report call for ${describe}`).to.equal(true);
      })
      .then((list) => {
        const call = Cypress._.findLast(list.slice(from), (c) => isWanted(c.fields));
        expect(call.status, `${describe}: HTTP status`).to.equal(200);
        expect(call.body && call.body.status, `${describe}: API status (${JSON.stringify(call.body && call.body.message)})`).to.equal(true);
        return call;
      });
  }

  table() {
    return cy.contains("th", /Stock Received/i, { timeout: 60000 }).closest("table");
  }

  // Waits until the table shows `count` rows (not the loading skeleton).
  waitForRows(count) {
    return this.table()
      .find("tbody")
      .should(($tbody) => {
        expect($tbody.find(".animate-pulse"), "table finished loading").to.have.length(0);
        const rows = $tbody.children("tr").filter((_, tr) => tr.children.length >= 8);
        expect(rows, "rows shown in the table").to.have.length(count);
      });
  }

  // { "Products": { raw: "2,404", value: 2404 }, ... } from the cards.
  readSummary() {
    return cy.contains("p", /^\s*Current Quantity\s*$/, { timeout: 60000 }).then(() => {
      const $p = Cypress.$("p");
      return Cypress._.mapValues(CARDS, (_, label) => {
        const $label = $p.filter((__, p) => text(p) === label && Cypress.$(p).next("p").length > 0).first();
        const raw = text($label.next("p")[0]);
        return { raw, value: $label.length ? numberOf(raw) : null };
      });
    });
  }

  // The date filter button: "All time" or "10/01/2026 - 10/30/2026".
  dateTrigger() {
    return cy.contains("button", /^\s*(All time|\d{2}\/\d{2}\/\d{4} - \d{2}\/\d{2}\/\d{4})\s*$/, { timeout: 30000 });
  }

  // Opens the date picker and picks a preset ("Month-to-date", "This
  // year", ...), then clicks "Retrieve" if the picker is still open. (The
  // picker has a Retrieve button; on some builds a preset applies and
  // closes the picker by itself, on others Retrieve applies it.)
  selectDateRange(label) {
    this.dateTrigger().click();
    cy.contains("button:visible", new RegExp(`^\\s*${label}\\s*$`), { timeout: 15000 }).click();
    return cy.get("body").then(($body) => {
      const retrieve = $body.find("button:visible").filter((_, b) => /^\s*Retrieve\s*$/.test(b.textContent));
      if (retrieve.length) cy.wrap(retrieve.first()).click();
    });
  }

  // The store filter button ("All Stores", "MONSTER01", ...) - the
  // pop-over button just before the date filter.
  storeTrigger() {
    return this.dateTrigger().prevAll('button[aria-haspopup="dialog"]').first();
  }

  // Opens "Select Stores", leaves only the stores named in `names` ticked
  // ("Deselect All", then each store's row) and closes it. Ticking applies
  // straight away. Yields the names ticked, as the picker lists them.
  selectOnlyStores(names) {
    const wanted = names.map((n) => n.trim().toLowerCase());
    this.storeTrigger().click();
    cy.contains('[role="dialog"]', /Select Stores/, { timeout: 15000 }).should("be.visible").as("storePicker");
    cy.get("@storePicker").then(($picker) => {
      const deselect = $picker.find("button").filter((_, b) => /^\s*Deselect All\s*$/.test(b.textContent));
      if (deselect.length) cy.wrap(deselect.first()).click();
    });
    cy.get("@storePicker").contains("button", /^\s*Select All\s*$/).should("be.visible");
    return cy
      .get("@storePicker")
      .find("[data-radix-scroll-area-viewport] button")
      .then(($rows) => {
        const rows = $rows.toArray().filter((row) => wanted.includes(text(row.querySelector("div > div")).toLowerCase()));
        expect(rows.length, `stores ${names.join(", ")} listed in Select Stores`).to.equal(names.length);
        const ticked = rows.map((row) => text(row.querySelector("div > div")));
        rows.forEach((row) => cy.wrap(row).click());
        return cy.wrap(ticked, { log: false });
      })
      .then((ticked) => {
        cy.get("body").type("{esc}");
        return cy
          .get('[role="dialog"]:contains("Select Stores")')
          .should("not.exist")
          .then(() => ticked);
      });
  }

  // Opens "Select Stores", ticks every store ("Select All" - the button
  // reads "Deselect All" once all are ticked) and closes it. Ticking applies
  // straight away. Yields the store names listed.
  selectAllStores() {
    this.storeTrigger().click();
    cy.contains('[role="dialog"]', /Select Stores/, { timeout: 15000 }).should("be.visible").as("storePicker");
    cy.get("@storePicker").then(($picker) => {
      const selectAll = $picker.find("button").filter((_, b) => /^\s*Select All\s*$/.test(b.textContent));
      if (selectAll.length) cy.wrap(selectAll.first()).click();
    });
    cy.get("@storePicker").contains("button", /^\s*Deselect All\s*$/).should("be.visible");
    return cy
      .get("@storePicker")
      .find("[data-radix-scroll-area-viewport] button")
      .then(($rows) => $rows.toArray().map((row) => text(row.querySelector("div > div"))))
      .then((names) => {
        cy.get("body").type("{esc}");
        return cy
          .get('[role="dialog"]:contains("Select Stores")')
          .should("not.exist")
          .then(() => names);
      });
  }

  // The SEARCH box ("Product, variant, UPC, custom code or ID"); the page
  // sends it as the report call's search_by field.
  search(term) {
    return cy
      .get('input[placeholder="Product, variant, UPC, custom code or ID"]', { timeout: 30000 })
      .clear()
      .type(term)
      .should("have.value", term);
  }

  // The "25 per page" select under the table.
  setPageSize(size) {
    cy.get('button[role="combobox"]', { timeout: 30000 }).filter(":contains('per page')").first().click();
    return cy.contains('[role="option"]', new RegExp(`^\\s*${size} per page\\s*$`)).click();
  }

  nextPage() {
    return cy.contains("button", /^\s*Next\s*$/).should("not.be.disabled").click();
  }

  // { page, pages, from, to, total } from "Page 2 of 5" and "101-200 of 437 results".
  readPager() {
    return this.table()
      .parent()
      .parent()
      .then(($box) => {
        const pageText = text($box.find("span").filter((_, s) => /^Page \d+ of \d+$/.test(text(s)))[0]);
        const resultsText = text($box.find("span").filter((_, s) => /^\d+-\d+ of [\d,]+ results$/.test(text(s)))[0]);
        const [, page, pages] = pageText.match(/^Page (\d+) of (\d+)$/) || [];
        const [, from, to, total] = resultsText.match(/^(\d+)-(\d+) of ([\d,]+) results$/) || [];
        return { page: numberOf(page), pages: numberOf(pages), from: numberOf(from), to: numberOf(to), total: numberOf(total ?? "") };
      });
  }

  // The rows the table shows, as the API names its fields.
  readTable() {
    return this.table().then(($table) =>
      $table
        .find("tbody > tr")
        .toArray()
        .filter((tr) => tr.children.length >= 8)
        .map((tr) => {
          const td = Cypress.$(tr).children("td").toArray();
          const ids = Cypress.$(td[2]).children("div").toArray();
          const variant = Cypress.$(td[1]).children("div").toArray();
          return {
            store_name: text(td[0]),
            product_title: text(variant[0]),
            variant_name: text(variant[1]),
            product_id: text(ids[0]),
            variant_id: ((text(ids[1]).match(/^Var\s+(.+)$/) || [])[1] || "").trim(),
            upc: text(td[3]) === "—" ? "" : text(td[3]),
            stock_received: numberOf(text(td[5])),
            stock_sold: numberOf(text(td[6])),
            current_qty: numberOf(text(td[7])),
          };
        })
    );
  }
}

module.exports = new PoProductsReportPage();
module.exports.CARDS = CARDS;
module.exports.presetDates = presetDates;
