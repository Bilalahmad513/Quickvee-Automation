const salesByCategoryPage = require("../../pages/SalesByCategoryPage");
const detailedCategoryReportPage = require("../../pages/DetailedCategoryReportPage");
const categorySoldReportPage = require("../../pages/CategorySoldReportPage");
const reportsApi = require("../../reports/ReportsApi");
const categoryMappings = require("../../reports/categoryMappings");
const { getStores, getAllStoresStores, getDateRanges } = require("../../reports/reconciliationConfig");
const { buildHtml, injectLogStyles, logRow, formatLine, assertNoMismatches } = require("../../reports/reconciliationReport");

// Stores the category reports are checked for, same lists as the other
// reconciliation specs (cypress.env.json, see reconciliationConfig.js):
// reportStores one at a time, reportAllStoresStores with every store on the
// account selected in the reports' own store pickers. Report checks only
// read data, so any store can be listed.
const STORES = getStores();
const ALL_STORES_STORES = getAllStoresStores();

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

  // Compares the category reports for every date filter, asked for
  // context.storeIds; `storeLabel` names that selection in logs and the
  // HTML report.
  function reconcileAllRanges(testTitle, context, storeLabel) {
    getDateRanges().forEach((range) => {
      reportsApi.reconcile(context, range, categoryMappings).then((results) => {
        results.forEach((result) => {
          const row = { ...result, store: storeLabel, line: `[${storeLabel}] ${formatLine(result)}` };
          logRow(row);
          cy.task("log", row.line, { log: false });
          rowsByTest[testTitle].push(row);
        });
      });
    });

    cy.then(() => {
      const rows = rowsByTest[testTitle];
      const mismatches = rows.filter((r) => !r.match);
      expect(rows, "checks run").to.not.be.empty;
      assertNoMismatches(mismatches);
    });
  }

  STORES.forEach((store) => {
    it(`category report values match for store: ${store} (single store)`, function () {
      cy.loginAndEnterStore(Cypress.env("storeName"), Cypress.env("username"), Cypress.env("password"), store);
      reportsApi.captureContext().then((context) => reconcileAllRanges(this.test.title, context, store));
    });
  });

  // Selects every store in each report page's own picker, takes the store
  // ids each page then sent, checks all three pages agree on them, and
  // compares the reports for those stores together.
  ALL_STORES_STORES.forEach((store) => {
    it(`category report values match for store: ${store} with all stores selected`, function () {
      const title = this.test.title;

      cy.loginAndEnterStore(Cypress.env("storeName"), Cypress.env("username"), Cypress.env("password"), store);

      reportsApi.storeIdsWithAllSelected(ALL_STORES_PAGES).then((storeIds) => {
        reportsApi.captureContext().then((context) => {
          expect(storeIds, `all stores include ${store}'s own id`).to.include(context.merchantId);
          reportsApi.storesLabel(storeIds).then((label) => reconcileAllRanges(title, { ...context, storeIds }, label));
        });
      });
    });
  });
});
