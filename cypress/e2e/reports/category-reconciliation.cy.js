const salesByCategoryPage = require("../../pages/SalesByCategoryPage");
const detailedCategoryReportPage = require("../../pages/DetailedCategoryReportPage");
const categorySoldReportPage = require("../../pages/CategorySoldReportPage");
const reportsApi = require("../../reports/ReportsApi");
const categoryMappings = require("../../reports/categoryMappings");
const { compareCategorySoldCsv, normalizeCsv } = require("../../reports/categorySoldCsvChecks");
const { getDateRanges } = require("../../reports/reconciliationConfig");
const { buildHtml, injectLogStyles, logRow, formatLine } = require("../../reports/reconciliationReport");

// The category reports are checked for this one store only - not the
// reportStores list the other reconciliation uses. "All stores" means every
// store this store's account can pick in the reports' own store pickers.
// Override with --env categoryStore=<store> (or in cypress.env.json).
const STORE = Cypress.env("categoryStore") || "storeb";

// Each category report page, how to select every store in its picker, and
// the API call that selection makes - the store ids it sends are what the
// all-stores test uses.
const ALL_STORES_PAGES = [
  {
    name: "Sales by Category",
    endpoint: "category_sales_report_api_fact",
    open: () => salesByCategoryPage.visit(),
    selectAll: () => salesByCategoryPage.selectAllStoresAndSearch(),
  },
  {
    name: "Category Sales (Detailed)",
    endpoint: "detailed_category_sale_fact",
    open: () => detailedCategoryReportPage.visit(),
    selectAll: () => detailedCategoryReportPage.selectAllStoresAndSearch(),
  },
  {
    name: "Category Sold Report",
    endpoint: "category_sales_report_api_fact",
    open: () => categorySoldReportPage.visit(),
    selectAll: () => categorySoldReportPage.selectAllStores(),
  },
];

describe("Category Report Reconciliation", () => {
  const rowsByTest = {};

  before(() => {
    injectLogStyles();
  });

  // Retries (cypress.config.js) re-run a test from the top - start each
  // attempt with an empty list for that test, so the HTML report and final
  // assertion only reflect its last attempt.
  beforeEach(function () {
    rowsByTest[this.currentTest.title] = [];
  });

  after(() => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp =
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_` +
      `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const file = `cypress/reports-output/category-reconciliation-${stamp}.html`;

    cy.writeFile(file, buildHtml(Object.values(rowsByTest).flat(), now.toLocaleString(), "Category Report Reconciliation"));
    cy.task("log", `HTML report written to ${file}`);
  });

  // Logs and keeps each result row under `storeLabel`.
  function record(testTitle, storeLabel, results) {
    results.forEach((result) => {
      const row = { ...result, store: storeLabel, line: `[${storeLabel}] ${formatLine(result)}` };
      logRow(row);
      cy.task("log", row.line, { log: false });
      rowsByTest[testTitle].push(row);
    });
  }

  function assertAllMatched(testTitle) {
    cy.then(() => {
      const rows = rowsByTest[testTitle];
      const mismatches = rows.filter((r) => !r.match);
      expect(rows, "checks run").to.not.be.empty;
      expect(mismatches, "\n" + mismatches.map((m) => m.line).join("\n")).to.be.empty;
    });
  }

  // Compares the category reports for every date filter, asked for
  // context.storeIds; `storeLabel` names that selection in logs and the
  // HTML report.
  function reconcileAllRanges(testTitle, context, storeLabel) {
    getDateRanges().forEach((range) => {
      reportsApi.reconcile(context, range, categoryMappings).then((results) => record(testTitle, storeLabel, results));
    });
    assertAllMatched(testTitle);
  }

  // Enters STORE and yields its reports context plus its name (from the
  // reports' own store list), which logs and the HTML report show instead
  // of the store id.
  function enterStore() {
    cy.loginAndEnterStore(Cypress.env("storeName"), Cypress.env("username"), Cypress.env("password"), STORE);
    return reportsApi.captureContext().then((context) =>
      reportsApi.ensureLocation(context).then((location) => ({ context, storeName: location.name || STORE }))
    );
  }

  const allStoresLabel = (storeName, storeIds) => `${storeName} + all stores (${storeIds.length})`;

  it(`category report values match for store: ${STORE} (single store)`, function () {
    enterStore().then(({ context, storeName }) => reconcileAllRanges(this.test.title, context, storeName));
  });

  // Selects every store in each report page's own picker, takes the store
  // ids each page then sent, checks all three pages agree on them, and
  // compares the reports for those stores together.
  it(`category report values match for store: ${STORE} with all stores selected`, function () {
    const title = this.test.title;

    enterStore().then(({ context, storeName }) => {
      ALL_STORES_PAGES.forEach((page) => {
        page.open();
        // More than one store id means the page has switched from its
        // single-store default to the full selection.
        reportsApi
          .reportCallAfter(page.endpoint, page.selectAll, (fields) => idsOf(fields.outlet_ids).length > 1, `"${page.name}" with all stores selected`)
          .then(({ fields }) => {
            storeIdsByPage[page.name] = idsOf(fields.outlet_ids);
            if (fields.stores !== undefined) {
              expect(idsOf(fields.stores), `${page.name} stores field`).to.deep.equal(storeIdsByPage[page.name]);
            }
            cy.task("log", `[${storeName}] ${page.name} all stores: ${storeIdsByPage[page.name].join(", ")}`, { log: false });
          });
      });

      cy.then(() => {
        const [first, ...others] = Object.values(storeIdsByPage);
        const storeIds = [...first].sort();
        others.forEach((ids, index) => {
          expect([...ids].sort(), `${ALL_STORES_PAGES[index + 1].name} stores = ${ALL_STORES_PAGES[0].name} stores`).to.deep.equal(storeIds);
        });
        expect(storeIds, `all stores include ${STORE}'s own id`).to.include(context.merchantId);

        reconcileAllRanges(title, { ...context, storeIds }, allStoresLabel(storeName, storeIds));
      });
    });
  });

  // Clicks the Category Sold Report's own "Export CSV" (the page opens on
  // today with every store selected), checks the downloaded file is exactly
  // what the export API answered, then - asking the export API with the
  // page's same fields - compares the CSV with the report's data for every
  // date filter, for this store alone and for all stores: every category,
  // column by column, and the column sums with the report's totals.
  it(`Category Sold Report Export CSV matches the report for store: ${STORE}`, function () {
    const title = this.test.title;

    enterStore().then(({ context, storeName }) => {
      categorySoldReportPage.visit();
      cy.task("clearDownloads");

    reportsApi.storeIdsWithAllSelected(ALL_STORES_PAGES).then((storeIds) => {
      reportsApi.captureContext().then((context) => {
        expect(storeIds, `all stores include ${STORE}'s own id`).to.include(context.merchantId);
        reconcileAllRanges(title, { ...context, storeIds }, `${STORE} + all stores (${storeIds.length})`);
      });
    });
  });
});
