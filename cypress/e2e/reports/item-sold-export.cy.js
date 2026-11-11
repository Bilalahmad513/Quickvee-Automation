const itemSoldReportPage = require("../../pages/ItemSoldReportPage");
const reportsApi = require("../../reports/ReportsApi");
const { getStores, getAllStoresStores, getDateRanges } = require("../../reports/reconciliationConfig");
const { buildHtml, injectLogStyles, logRow, formatLine, assertNoMismatches } = require("../../reports/reconciliationReport");
const { parseCsv, toNumber } = require("../../support/csv");

// The Item Sold Report's "Export CSV" file, checked against the report page
// itself, for each of these date filters (labels from
// reconciliationConfig.js). Stores come from the same lists as the other
// report checks (cypress.env.json): reportStores one at a time, and
// reportAllStoresStores with every store on the account selected - one test
// per store and filter. Only reads data.
// Stores whose account doesn't have the Item Sold Report (the page only
// says "This report isn't available for your account yet") are left out
// here - they stay in reportStores for the other report checks.
const STORES_WITHOUT_ITEM_SOLD_REPORT = ["jenny smoke shop"];
const STORES = getStores().filter((store) => !STORES_WITHOUT_ITEM_SOLD_REPORT.includes(store));
const ALL_STORES_STORES = getAllStoresStores();
const RANGE_LABELS = ["today", "yesterday", "this month", "last month"];

// Extra date filters checked for these stores only - long ranges whose
// export is emailed rather than downloaded (confirmed live: storeb, this
// year = 307 days, "Your export has been queued"), which can take a few
// minutes per test. `allStores`: with every store on the account selected.
const EMAILED_RANGES = [
  { store: "storeb", rangeLabel: "this year" },
  { store: "storeb", rangeLabel: "this year", allStores: true },
];

const ITEMS_API = "https://reports-api.quickvee.us/api/reports/items_sales_report_api";

// What "Export CSV" calls (confirmed live): for a short range it answers
// with the CSV itself and the browser downloads it; for a long range it
// answers { queued: true, message: "Your export has been queued..." } and
// the file comes by email (a "Download Report" link) instead.
const EXPORT_API = "https://reports-api.quickvee.us/api/reports/items_sold_report_consolidated";

// Waiting for an emailed export: Quickvee estimates ~5 minutes.
const EMAIL_TIMEOUT = 10 * 60 * 1000;

// The totals the file and the page both have, by the name they share (CSV
// column header = the page's Total row label). Stock is in the file only.
// The page shows discounts as a negative (-$4,307.06) and the file as a
// positive amount, so discounts are compared without their sign.
const COLUMNS = [
  { name: "Sold", format: "count" },
  { name: "Subtotal", format: "money" },
  { name: "Discounts", format: "money", unsigned: true },
  { name: "Subtotal w/ Discounts", format: "money" },
  { name: "Total", format: "money" },
  { name: "Cost", format: "money" },
  { name: "Profit", format: "money" },
  { name: "Margin", format: "percent", notSummed: true },
];

const idsOf = (value) => (value || "").split(",").filter(Boolean);

describe("Item Sold Report Export", () => {
  const rowsByTest = {};

  before(() => {
    injectLogStyles();
  });

  // Each attempt starts its own test's list, so the HTML report only shows
  // the last attempt.
  beforeEach(function () {
    rowsByTest[this.currentTest.title] = [];
  });

  after(() => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp =
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_` +
      `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const file = `cypress/reports-output/item-sold-export-${stamp}.html`;

    cy.writeFile(file, buildHtml(Object.values(rowsByTest).flat(), now.toLocaleString(), "Item Sold Report Export"));
    cy.task("log", `HTML report written to ${file}`);
  });

  // One check: `values` ({ label, amount }) must all be equal, in whole cents.
  function record(title, storeLabel, range, label, format, values) {
    const cents = values.map((v) => (v.amount === null ? null : Math.round(v.amount * 100)));
    const row = {
      kind: "group",
      store: storeLabel,
      range,
      label,
      format,
      values: values.map((v) => ({ ...v, raw: v.amount })),
      match: cents.every((c) => c !== null && c === cents[0]),
    };
    row.line = `[${storeLabel}] ${formatLine(row)}`;
    logRow(row);
    cy.task("log", row.line, { log: false });
    rowsByTest[title].push(row);
  }

  // Opens the report inside `store`, picks the stores (`chooseStores`) and
  // the dates, exports the CSV, and checks the file's TOTAL row, the sum of
  // its item rows and the page's Total row agree, column by column.
  // `isWantedStores(fields)` says which of the page's calls is for the
  // chosen stores - the page opens on today with every store selected, so
  // its first call isn't necessarily the one the Total row ends up showing.
  //
  // `test` is the Mocha test context: a store whose account doesn't have the
  // report (the page only says it isn't available) is skipped, not failed.
  function checkExport(test, title, store, storeLabel, rangeLabel, chooseStores, isWantedStores) {
    const range = getDateRanges().find((r) => r.label === rangeLabel);
    const fileName = `item_sold_report_${range.startDate}_to_${range.endDate}.csv`;
    let pageTotals;
    let itemCount;
    let storeIds;
    let emailedRows;

    cy.loginAndEnterStore(Cypress.env("storeName"), Cypress.env("username"), Cypress.env("password"), store);

    itemSoldReportPage.visit().then((available) => {
      if (!available) {
        cy.task("log", `[${storeLabel}] Item Sold Report isn't available for this store - skipped`, { log: false });
        test.skip();
      }
    });

    reportsApi
      .callAfter(
        ITEMS_API,
        () => {
          chooseStores();
          itemSoldReportPage.selectDates(range);
        },
        (fields) => fields.start_date === range.startDate && fields.end_date === range.endDate && isWantedStores(fields),
        `Item Sold Report for ${storeLabel}, ${rangeLabel}`
      )
      .then(({ fields, body }) => {
        itemCount = Number(body.total_items);
        storeIds = idsOf(fields.outlet_ids);
        // Every store selected: the label names them (see ReportsApi.storesLabel).
        if (storeIds.length > 1) reportsApi.storesLabel(storeIds).then((label) => (storeLabel = label));
      });

    // With nothing sold the page shows "No items sold in this window" and no
    // Total row, and the file has only its header - no item rows, no TOTAL
    // row (confirmed live: monster01, a day with no sales).
    cy.then(() => {
      if (itemCount === 0) {
        cy.contains("No items sold in this window", { timeout: 15000 });
        return;
      }
      cy.contains(new RegExp(`All ${itemCount} items? matching filters`), { timeout: 15000 });
      itemSoldReportPage.totalRow().then((totals) => {
        pageTotals = totals;
      });
    });

    // The file: the browser's download for a short range, or the emailed
    // "Download Report" link when the export was queued.
    let clickedAt;
    cy.task("deleteDownload", fileName);
    cy.then(() => {
      clickedAt = Date.now();
    });
    reportsApi
      .callAfter(EXPORT_API, () => itemSoldReportPage.exportCsv(), () => true, `Item Sold export for ${storeLabel}, ${rangeLabel}`)
      .then(({ body }) => {
        if (!(body && body.queued === true)) {
          return cy.readFile(`${Cypress.config("downloadsFolder")}/${fileName}`, { timeout: 30000 });
        }
        cy.task("log", `[${storeLabel}] ${rangeLabel}: export queued (${body.message}) - waiting for the email`, { log: false });
        return cy
          .task(
            "findExportEmail",
            { merchantIds: storeIds, report: "Item Sold Report", startDate: range.startDate, endDate: range.endDate, since: clickedAt, timeoutMs: EMAIL_TIMEOUT },
            { timeout: EMAIL_TIMEOUT + 60000 }
          )
          .then((email) => {
            emailedRows = email.rows;
            cy.task("log", `[${storeLabel}] ${rangeLabel}: export email received ${email.receivedAt}, ${email.rows} rows`, { log: false });
            return cy.request(email.url).its("body");
          });
      })
      .then((text) => {
        const [header, ...rest] = parseCsv(text);
        if (itemCount === 0) {
          record(title, storeLabel, range, "Items", "count", [
            { label: "CSV rows", amount: rest.length },
            { label: "Page (No items sold)", amount: 0 },
          ]);
          return;
        }
        const totalIndex = rest.findIndex((r) => r[0] === "TOTAL");
        expect(totalIndex, `a TOTAL row in ${fileName}`).to.be.at.least(0);
        const itemRows = rest.slice(0, totalIndex);
        const totalRow = rest[totalIndex];
        const column = (name) => {
          const index = header.indexOf(name);
          expect(index, `"${name}" column in ${fileName}`).to.be.at.least(0);
          return index;
        };

        record(title, storeLabel, range, "Items", "count", [
          { label: "CSV TOTAL row", amount: toNumber(totalRow[column("Title")]) },
          { label: "CSV item rows", amount: itemRows.length },
          { label: "Page Total row", amount: pageTotals.items },
          ...(emailedRows === undefined ? [] : [{ label: "Email \"Rows\"", amount: emailedRows }]),
        ]);

        COLUMNS.forEach(({ name, format, unsigned, notSummed }) => {
          const sign = (n) => (unsigned && n !== null ? Math.abs(n) : n);
          const i = column(name);
          const values = [{ label: "CSV TOTAL row", amount: sign(toNumber(totalRow[i])) }];
          if (!notSummed) {
            values.push({ label: "CSV item rows added up", amount: sign(Cypress._.sumBy(itemRows, (r) => toNumber(r[i]))) });
          }
          values.push({ label: "Page Total row", amount: sign(pageTotals[name]) });
          record(title, storeLabel, range, name, format, values);
        });
      });

    cy.then(() => {
      const rows = rowsByTest[title];
      const mismatches = rows.filter((r) => !r.match);
      expect(rows, "checks run").to.not.be.empty;
      assertNoMismatches(mismatches);
    });
  }

  // One store selected: "Deselect All" leaves the store the session is in,
  // and its call asks for that store alone.
  STORES.forEach((store) => {
    RANGE_LABELS.forEach((rangeLabel) => {
      it(`Item Sold Report CSV totals = the report's Total row for store: ${store} (${rangeLabel})`, function () {
        checkExport(
          this,
          this.test.title,
          store,
          store,
          rangeLabel,
          () => itemSoldReportPage.selectCurrentStoreOnly(),
          (fields) => fields.outlet_ids === fields.merchant_id
        );
      });
    });
  });

  // Long ranges whose file comes by email (EMAILED_RANGES) - same checks,
  // plus the email's own "Rows". The email must name exactly the stores the
  // page asked for.
  EMAILED_RANGES.forEach(({ store, rangeLabel, allStores }) => {
    const which = allStores ? `with all stores selected for: ${store}` : `for store: ${store}`;
    it(`Item Sold Report emailed CSV totals = the report's Total row ${which} (${rangeLabel})`, function () {
      checkExport(
        this,
        this.test.title,
        store,
        allStores ? `${store} + all stores` : store,
        rangeLabel,
        allStores ? () => itemSoldReportPage.selectAllStores() : () => itemSoldReportPage.selectCurrentStoreOnly(),
        allStores
          ? (fields) => idsOf(fields.outlet_ids).length > 1 && idsOf(fields.outlet_ids).includes(fields.merchant_id)
          : (fields) => fields.outlet_ids === fields.merchant_id
      );
    });
  });

  // Every store on the account selected; its call asks for more than one
  // store, the current one among them.
  ALL_STORES_STORES.forEach((store) => {
    RANGE_LABELS.forEach((rangeLabel) => {
      it(`Item Sold Report CSV totals = the report's Total row with all stores selected for: ${store} (${rangeLabel})`, function () {
        let storeIds = [];
        checkExport(
          this,
          this.test.title,
          store,
          `${store} + all stores`,
          rangeLabel,
          () => itemSoldReportPage.selectAllStores(),
          (fields) => {
            storeIds = idsOf(fields.outlet_ids);
            return storeIds.length > 1 && storeIds.includes(fields.merchant_id);
          }
        );
        cy.then(() => reportsApi.storesLabel(storeIds)).then((label) => cy.task("log", `[${label}] ${rangeLabel}: ${storeIds.join(", ")}`, { log: false }));
      });
    });
  });
});
