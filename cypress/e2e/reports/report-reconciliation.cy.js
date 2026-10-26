const storeDirectoryPage = require("../../pages/StoreDirectoryPage");
const dashboardPage = require("../../pages/DashboardPage");
const reportsApi = require("../../reports/ReportsApi");
const reportMappings = require("../../reports/reportMappings");
const formulaChecks = require("../../reports/formulaChecks");
const { getStores, getDateRanges } = require("../../reports/reconciliationConfig");
const { formatLine, buildHtml, injectLogStyles, logRow } = require("../../reports/reconciliationReport");

// The dashboard views the formula test clicks through, using the page's own
// "VIEW BY" toggle and "Previous" button. Each sequence starts from a fresh
// page load (Day view, today); every view it lands on is checked.
const DASHBOARD_VIEW_SEQUENCES = [
  [{ label: "day", activeType: "Day" }],
  [
    { label: "week", activeType: "Week", view: "Week" },
    { label: "previous week", activeType: "Week", previous: true },
  ],
  [
    { label: "month", activeType: "Month", view: "Month" },
    { label: "previous month", activeType: "Month", previous: true },
  ],
];

describe("Report Reconciliation", () => {
  const stores = getStores();
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
  function forEachStore(inStore) {
    stores.forEach((store, index) => {
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

  it(`report values match across reports for stores: ${stores.join(", ")}`, function () {
    const title = this.test.title;

    forEachStore((store) => {
      reportsApi.captureContext().then((context) => {
        getDateRanges().forEach((range) => {
          reportsApi.reconcile(context, range, reportMappings).then((results) => record(title, store, results));
        });
      });
    });

    assertAllMatched(title);
  });

  // Drives the dashboard page itself through Day, Week, Previous week,
  // Month and Previous month, and checks each formula on the exact data the
  // page loaded for that view - the date range comes from the dashboard's
  // own response, i.e. whatever the page shows.
  it(`dashboard formulas are correct for stores: ${stores.join(", ")}`, function () {
    const title = this.test.title;

    forEachStore((store) => {
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
            fields.activeType === step.activeType && (!step.previous || body.headline.start !== lastRange.startDate);

          reportsApi.dashboardViewAfter(trigger, isWanted, `the "${step.label}" view`).then((body) => {
            const range = { label: step.label, startDate: body.headline.start, endDate: body.headline.end };
            lastRange = range;
            record(title, store, reportsApi.evaluateFormulas({ dashboard: body }, range, formulaChecks));
          });
        });
      });
    });

    assertAllMatched(title);
  });
});
