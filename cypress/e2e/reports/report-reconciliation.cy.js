const storeDirectoryPage = require("../../pages/StoreDirectoryPage");
const dashboardPage = require("../../pages/DashboardPage");
const salesSummaryPage = require("../../pages/SalesSummaryPage");
const hourlySalesReportPage = require("../../pages/HourlySalesReportPage");
const discountReportPage = require("../../pages/DiscountReportPage");
const locationReportPage = require("../../pages/LocationReportPage");
const reportsApi = require("../../reports/ReportsApi");
const reportMappings = require("../../reports/reportMappings");
const formulaChecks = require("../../reports/formulaChecks");
const { getStores, getAllStoresStores, getDateRanges } = require("../../reports/reconciliationConfig");
const { formatLine, buildHtml, injectLogStyles, logRow } = require("../../reports/reconciliationReport");

// The dashboard views the formula test clicks through, using the page's own
// "VIEW BY" toggle and "Previous" button. Each sequence starts from a fresh
// page load (Day view, today); every view it lands on is checked. Labels
// match the date filters in reconciliationConfig.js.
const DASHBOARD_VIEW_SEQUENCES = [
  [
    { label: "today", activeType: "Day" },
    { label: "yesterday", activeType: "Day", previous: true },
    { label: "day before yesterday", activeType: "Day", previous: true },
  ],
  [
    { label: "this month", activeType: "Month", view: "Month" },
    { label: "last month", activeType: "Month", previous: true },
    { label: "before last month", activeType: "Month", previous: true },
  ],
];

// The dashboard has no Year view (only Day/Week/Month), so these filters are
// checked by calling the dashboard API directly for the same date range.
const DASHBOARD_API_ONLY_RANGES = ["this year"];

const DASHBOARD_ALL_STORES = {
  name: "Dashboard",
  endpoint: "dashboard",
  open: () => dashboardPage.visitOnToday(),
  selectAll: () => dashboardPage.selectAllLocations(),
};

// Each report page, how to select every store in its picker, and the API
// call that selection makes - the store ids it sends are what the
// all-stores tests use.
const ALL_STORES_PAGES = [
  DASHBOARD_ALL_STORES,
  {
    name: "Overall Sales Summary",
    endpoint: "sales_report_api_fact",
    open: () => salesSummaryPage.visit(),
    selectAll: () => salesSummaryPage.selectAllStoresAndSearch(),
  },
  {
    name: "Hourly Sales Report",
    endpoint: "hourly_sales_fact",
    open: () => hourlySalesReportPage.visit(),
    selectAll: () => hourlySalesReportPage.selectAllStoresAndSearch(),
  },
  {
    name: "Discounts Report",
    endpoint: "discount_report_fact",
    open: () => discountReportPage.visit(),
    selectAll: () => discountReportPage.selectAllStoresAndSearch(),
  },
  {
    name: "Location Report",
    endpoint: "location-sales-fact",
    open: () => locationReportPage.visit(),
    selectAll: () => locationReportPage.selectAllLocations(),
    // A JSON body listing each selected store's {id, name, city, state}.
    sentIds: (fields) => (fields.locations || []).map((l) => l.id),
  },
];

const allStoresLabel = (store, storeIds) => `${store} + all stores (${storeIds.length})`;

describe("Report Reconciliation", () => {
  const stores = getStores();
  const allStoresStores = getAllStoresStores();
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

  // Runs even when a check fails, so the HTML report always shows what was
  // checked - including the mismatches that failed a test.
  after(() => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp =
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_` +
      `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const file = `cypress/reports-output/reconciliation-${stamp}.html`;

    cy.writeFile(file, buildHtml(Object.values(rowsByTest).flat(), now.toLocaleString()));
    cy.task("log", `HTML report written to ${file}`);
  });

  // Enters each store in turn and runs `inStore(store)` inside it. The login
  // form is never filled in again here: the first store comes from the
  // cached login session, every store after that is reached via "Back to
  // Super Admin" -> store directory, same as a person switching stores.
  function forEachStore(storeNames, inStore) {
    storeNames.forEach((store, index) => {
      if (index === 0) {
        cy.loginAndEnterStore(Cypress.env("storeName"), Cypress.env("username"), Cypress.env("password"), store);
      } else {
        storeDirectoryPage.backToSuperAdmin();
        storeDirectoryPage.enterStore(store);
      }
      inStore(store);
    });
  }

  function record(testTitle, store, results) {
    results.forEach((result) => {
      const row = { ...result, store, line: `[${store}] ${formatLine(result)}` };
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

  // Compares the reports for every date filter, asked for context.storeIds.
  function reconcileAllRanges(testTitle, storeLabel, context) {
    getDateRanges().forEach((range) => {
      reportsApi.reconcile(context, range, reportMappings).then((results) => record(testTitle, storeLabel, results));
    });
  }

  // Drives the dashboard page itself through today, yesterday, the day
  // before, this month, last month and the month before, and checks each
  // formula on the exact data the page loaded for that view - the date range
  // comes from the dashboard's own response, i.e. whatever the page shows.
  // With `storeIds`, a view only counts if the page asked for exactly those
  // stores. "This year" has no view on the page, so it's checked via the API.
  function checkDashboardFormulas(testTitle, storeLabel, storeIds) {
    DASHBOARD_VIEW_SEQUENCES.forEach((sequence) => {
      let lastRange = null;

      sequence.forEach((step, index) => {
        // The first step of a sequence starts from a fresh load on today;
        // later steps are a click on the page's own controls.
        const trigger = () => {
          if (index === 0) dashboardPage.visitOnToday();
          if (step.view) dashboardPage.selectView(step.view);
          if (step.previous) dashboardPage.goToPreviousPeriod();
        };

        // A "previous" step must land on a different period than the view
        // before it, or it would re-check the same data.
        const isWanted = (fields, body) =>
          fields.activeType === step.activeType &&
          (!step.previous || body.headline.start !== lastRange.startDate) &&
          (!storeIds || Cypress._.isEqual(fields.outlet_ids.split(",").sort(), storeIds));

        reportsApi.dashboardViewAfter(trigger, isWanted, `the "${step.label}" view`).then((body) => {
          const range = { label: step.label, startDate: body.headline.start, endDate: body.headline.end };
          lastRange = range;
          record(testTitle, storeLabel, reportsApi.evaluateFormulas({ dashboard: body }, range, formulaChecks));
        });
      });
    });

    reportsApi.captureContext().then((context) => {
      const storesContext = storeIds ? { ...context, storeIds } : context;
      getDateRanges()
        .filter((range) => DASHBOARD_API_ONLY_RANGES.includes(range.label))
        .forEach((range) => {
          reportsApi.checkFormulas(storesContext, range, formulaChecks).then((results) => record(testTitle, storeLabel, results));
        });
    });
  }

  it(`report values match across reports for stores: ${stores.join(", ")}`, function () {
    const title = this.test.title;

    forEachStore(stores, (store) => {
      reportsApi.captureContext().then((context) => reconcileAllRanges(title, store, context));
    });

    assertAllMatched(title);
  });

  it(`dashboard formulas are correct for stores: ${stores.join(", ")}`, function () {
    const title = this.test.title;

    forEachStore(stores, (store) => checkDashboardFormulas(title, store));

    assertAllMatched(title);
  });

  // Selects every store in each report page's own picker, takes the store
  // ids each page then sent, checks all the pages agree on them, and
  // compares the reports for those stores together.
  it(`report values match across reports with all stores selected for: ${allStoresStores.join(", ")}`, function () {
    const title = this.test.title;

    forEachStore(allStoresStores, (store) => {
      reportsApi.storeIdsWithAllSelected(ALL_STORES_PAGES).then((storeIds) => {
        reportsApi.captureContext().then((context) => {
          expect(storeIds, `all stores include ${store}'s own id`).to.include(context.merchantId);
          reconcileAllRanges(title, allStoresLabel(store, storeIds), { ...context, storeIds });
        });
      });
    });

    assertAllMatched(title);
  });

  // Same formula checks on the dashboard with every store selected in its
  // Locations picker - the page keeps that selection for the views it then
  // clicks through.
  it(`dashboard formulas are correct with all stores selected for: ${allStoresStores.join(", ")}`, function () {
    const title = this.test.title;

    forEachStore(allStoresStores, (store) => {
      reportsApi.storeIdsWithAllSelected([DASHBOARD_ALL_STORES]).then((storeIds) => {
        checkDashboardFormulas(title, allStoresLabel(store, storeIds), storeIds);
      });
    });

    assertAllMatched(title);
  });
});
