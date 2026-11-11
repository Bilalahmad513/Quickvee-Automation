const categorySoldReportPage = require("../../pages/CategorySoldReportPage");
const reportsApi = require("../../reports/ReportsApi");
const { getStores, getAllStoresStores, getDateRanges } = require("../../reports/reconciliationConfig");
const { buildHtml, injectLogStyles, logRow, formatLine, assertNoMismatches } = require("../../reports/reconciliationReport");
const { parseCsv, toNumber } = require("../../support/csv");

// The Category Sold Report's "Export CSV" file, checked against the report
// page itself - the same set-up as item-sold-export.cy.js. Stores come from
// the same lists as the other report checks (cypress.env.json):
// reportStores one at a time, and reportAllStoresStores with every store on
// the account selected - one test per store and date filter. Only reads data.
// Stores whose account doesn't have the Category Sold Report (the page only
// says "This report isn't available for your account yet") are left out
// here - they stay in reportStores for the other report checks.
const STORES_WITHOUT_CATEGORY_SOLD_REPORT = ["jenny smoke shop"];
const STORES = getStores().filter((store) => !STORES_WITHOUT_CATEGORY_SOLD_REPORT.includes(store));
const ALL_STORES_STORES = getAllStoresStores();
const RANGE_LABELS = ["today", "yesterday", "this month", "last month"];

// Extra date filters checked for these stores only - long ranges whose
// export is emailed rather than downloaded (confirmed live: storeb, this
// year = 308 days, "Your export has been queued"), which can take a few
// minutes per test. `allStores`: with every store on the account selected.
const EMAILED_RANGES = [
  { store: "storeb", rangeLabel: "this year" },
  { store: "storeb", rangeLabel: "this year", allStores: true },
];

const CATEGORY_API = "https://reports-api.quickvee.us/api/reports/category_sales_report_api_fact";

// What "Export CSV" calls (confirmed live): for a short range it answers
// with the CSV itself and the browser downloads it; for a long range it
// answers { queued: true, ... } and the file comes by email ("Report:
// Category Sold Report", a "Download Report" link) instead.
const EXPORT_API = "https://reports-api.quickvee.us/api/reports/category_sold_report_consolidated";
const EMAIL_REPORT_NAME = "Category Sold Report";

// Waiting for an emailed export: Quickvee estimates ~5 minutes.
const EMAIL_TIMEOUT = 10 * 60 * 1000;

// Unlike the Item Sold export, this file has no TOTAL row - one row per
// category only (confirmed live). So each column is added up here and
// compared with the page's summary card. The page shows discounts as a
// negative (-$75.00) and the file as a positive amount, so discounts are
// compared without their sign. Price Override isn't on the page.
const SUMMED_COLUMNS = [
  { name: "Subtotal", format: "money" },
  { name: "Discounts", format: "money", unsigned: true },
  { name: "Subtotal w/ Discounts", format: "money" },
  { name: "Total", format: "money" },
  { name: "Cost", format: "money" },
  { name: "Profit", format: "money" },
];

const idsOf = (value) => (value || "").split(",").filter(Boolean);

describe("Category Sold Report Export", () => {
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
    const file = `cypress/reports-output/category-sold-export-${stamp}.html`;

    cy.writeFile(file, buildHtml(Object.values(rowsByTest).flat(), now.toLocaleString(), "Category Sold Report Export"));
    cy.task("log", `HTML report written to ${file}`);
  });

  // One check: `values` ({ label, amount }) must all be equal, in whole cents.
  // With `warning` (a known Quickvee problem) the values are only shown, not
  // compared, and the row is a warning instead of a failure.
  function record(title, storeLabel, range, label, format, values, warning) {
    const cents = values.map((v) => (v.amount === null ? null : Math.round(v.amount * 100)));
    const row = {
      kind: "group",
      store: storeLabel,
      range,
      label,
      format,
      values: values.map((v) => ({ ...v, raw: v.amount })),
      match: Boolean(warning) || cents.every((c) => c !== null && c === cents[0]),
      warning,
    };
    row.line = `[${storeLabel}] ${formatLine(row)}`;
    logRow(row);
    cy.task("log", row.line, { log: false });
    rowsByTest[title].push(row);
  }

  // Adds up a column in whole cents, so float noise can't creep into the sum.
  const sumColumn = (rows, index, unsigned) =>
    rows.reduce((cents, r) => cents + Math.round((unsigned ? Math.abs(toNumber(r[index])) : toNumber(r[index])) * 100), 0) / 100;

  // Opens the report inside `store`, picks the stores (`chooseStores`) and
  // the dates, exports the CSV (downloaded, or emailed for a long range),
  // and checks its columns added up against the page's summary card.
  // `isWantedStores(fields)` says which of the page's calls is for the
  // chosen stores - the page opens on today with every store selected, so
  // its first call isn't necessarily the one the summary ends up showing.
  // `test` is the Mocha test context: a store whose account doesn't have the
  // report is skipped, not failed.
  function checkExport(test, title, store, storeLabel, rangeLabel, chooseStores, isWantedStores) {
    const range = getDateRanges().find((r) => r.label === rangeLabel);
    const fileName = `category_sold_report_${range.startDate}_to_${range.endDate}.csv`;
    let pageApi;
    let storeIds;
    let summary;
    let emailedRows;
    let clickedAt;

    cy.loginAndEnterStore(Cypress.env("storeName"), Cypress.env("username"), Cypress.env("password"), store);

    categorySoldReportPage.visitIfAvailable().then((available) => {
      if (!available) {
        cy.task("log", `[${storeLabel}] Category Sold Report isn't available for this store - skipped`, { log: false });
        test.skip();
      }
    });

    // Its category count and quantity total aren't on the page (the table
    // pages 25 at a time; there's no quantity total), so they come from the
    // page's own call.
    reportsApi
      .callAfter(
        CATEGORY_API,
        () => {
          chooseStores();
          categorySoldReportPage.selectDates(range);
        },
        (fields) => fields.start_date === range.startDate && fields.end_date === range.endDate && isWantedStores(fields),
        `Category Sold Report for ${storeLabel}, ${rangeLabel}`
      )
      .then(({ fields, body }) => {
        pageApi = body;
        storeIds = idsOf(fields.outlet_ids);
        // Every store selected: the label names them (see ReportsApi.storesLabel).
        if (storeIds.length > 1) reportsApi.storesLabel(storeIds).then((label) => (storeLabel = label));
      });
    cy.then(() => {
      cy.contains("p", /^Subtotal$/)
        .next("p")
        .should(($value) => expect(toNumber($value.text())).to.equal(Number(pageApi.total_subtotal)));
    });
    categorySoldReportPage.summary().then((totals) => {
      summary = totals;
    });

    // The file: the browser's download for a short range, or the emailed
    // "Download Report" link when the export was queued.
    cy.task("deleteDownload", fileName);
    cy.then(() => {
      clickedAt = Date.now();
    });
    reportsApi
      .callAfter(EXPORT_API, () => categorySoldReportPage.exportCsv(), () => true, `Category Sold export for ${storeLabel}, ${rangeLabel}`)
      .then(({ body }) => {
        if (!(body && body.queued === true)) {
          return cy.readFile(`${Cypress.config("downloadsFolder")}/${fileName}`, { timeout: 30000 });
        }
        cy.task("log", `[${storeLabel}] ${rangeLabel}: export queued (${body.message}) - waiting for the email`, { log: false });
        return cy
          .task(
            "findExportEmail",
            { merchantIds: storeIds, report: EMAIL_REPORT_NAME, startDate: range.startDate, endDate: range.endDate, since: clickedAt, timeoutMs: EMAIL_TIMEOUT },
            { timeout: EMAIL_TIMEOUT + 60000 }
          )
          .then((email) => {
            emailedRows = email.rows;
            cy.task("log", `[${storeLabel}] ${rangeLabel}: export email received ${email.receivedAt}, ${email.rows} rows`, { log: false });
            return cy.request(email.url).its("body");
          });
      })
      .then((text) => {
        const [header, ...rows] = parseCsv(text);
        const column = (name) => {
          const index = header.indexOf(name);
          expect(index, `"${name}" column in the export`).to.be.at.least(0);
          return index;
        };

        // Quickvee bug: the emailed file has come both with and without a
        // "Price Override" column for the same store and dates (confirmed
        // live, 5 Nov 2026: 05:48 and 05:51 UTC with it, 05:39, 05:43 and
        // 05:59 without). Without it, its Subtotal is short by exactly the
        // price overrides ($218.56 for storeb this year) while every other
        // column still matches - so an emailed file without it only gets a
        // warning and its Subtotal isn't compared. A downloaded file has
        // always had it, so there a missing column still fails.
        const hasPriceOverride = header.includes("Price Override");
        const brokenEmailedFile = emailedRows !== undefined && !hasPriceOverride;
        record(
          title,
          storeLabel,
          range,
          "Price Override column in the file",
          "count",
          [
            { label: "CSV has it", amount: hasPriceOverride ? 1 : 0 },
            { label: "Expected", amount: 1 },
          ],
          brokenEmailedFile ? "emailed file came without its Price Override column (Quickvee bug)" : undefined
        );
        record(title, storeLabel, range, "Categories", "count", [
          { label: "CSV rows", amount: rows.length },
          { label: "Page categories", amount: Number(pageApi.total_categories) },
          ...(emailedRows === undefined ? [] : [{ label: 'Email "Rows"', amount: emailedRows }]),
        ]);
        record(title, storeLabel, range, "Sold Qty", "count", [
          { label: "CSV Qty added up", amount: sumColumn(rows, column("Qty")) },
          { label: "Page quantity total", amount: Number(pageApi.total_qty) },
        ]);

        const sums = {};
        SUMMED_COLUMNS.forEach(({ name, format, unsigned }) => {
          sums[name] = sumColumn(rows, column(name), unsigned);
          record(
            title,
            storeLabel,
            range,
            name,
            format,
            [
              { label: "CSV rows added up", amount: sums[name] },
              { label: "Page summary", amount: unsigned ? Math.abs(summary[name]) : summary[name] },
            ],
            brokenEmailedFile && name === "Subtotal"
              ? "not compared - the emailed file has no Price Override column, so its Subtotal is short by the price overrides"
              : undefined
          );
        });

        // Margin can't be added up: it's Profit / Subtotal w/ Discounts
        // (confirmed live: $310.25 / $809.50 = 38.33%), 0 with no sales.
        const net = sums["Subtotal w/ Discounts"];
        record(title, storeLabel, range, "Margin", "percent", [
          { label: "CSV Profit / Subtotal w/ Discounts", amount: net === 0 ? 0 : Math.round((sums.Profit / net) * 10000) / 100 },
          { label: "Page summary", amount: summary.Margin },
        ]);
      });

    cy.then(() => {
      const rows = rowsByTest[title];
      const mismatches = rows.filter((r) => !r.match);
      expect(rows, "checks run").to.not.be.empty;
      assertNoMismatches(mismatches);
    });
  }

  const currentStoreOnly = {
    choose: () => categorySoldReportPage.selectCurrentStoreOnly(),
    isWanted: (fields) => fields.outlet_ids === fields.merchant_id,
  };
  const allStores = {
    choose: () => categorySoldReportPage.selectAllStores(),
    isWanted: (fields) => idsOf(fields.outlet_ids).length > 1 && idsOf(fields.outlet_ids).includes(fields.merchant_id),
  };

  // One store selected: "Deselect All" leaves the store the session is in.
  STORES.forEach((store) => {
    RANGE_LABELS.forEach((rangeLabel) => {
      it(`Category Sold Report CSV totals = the report's summary for store: ${store} (${rangeLabel})`, function () {
        checkExport(this, this.test.title, store, store, rangeLabel, currentStoreOnly.choose, currentStoreOnly.isWanted);
      });
    });
  });

  // Every store on the account selected; its call asks for more than one
  // store, the current one among them.
  ALL_STORES_STORES.forEach((store) => {
    RANGE_LABELS.forEach((rangeLabel) => {
      it(`Category Sold Report CSV totals = the report's summary with all stores selected for: ${store} (${rangeLabel})`, function () {
        checkExport(this, this.test.title, store, `${store} + all stores`, rangeLabel, allStores.choose, allStores.isWanted);
      });
    });
  });

  // Long ranges whose file comes by email (EMAILED_RANGES) - same checks,
  // plus the email's own "Rows". The email must name exactly the stores the
  // page asked for.
  EMAILED_RANGES.forEach(({ store, rangeLabel, allStores: everyStore }) => {
    const which = everyStore ? `with all stores selected for: ${store}` : `for store: ${store}`;
    const stores = everyStore ? allStores : currentStoreOnly;
    it(`Category Sold Report emailed CSV totals = the report's summary ${which} (${rangeLabel})`, function () {
      checkExport(this, this.test.title, store, everyStore ? `${store} + all stores` : store, rangeLabel, stores.choose, stores.isWanted);
    });
  });
});
