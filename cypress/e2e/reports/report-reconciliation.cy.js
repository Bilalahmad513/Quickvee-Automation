const storeDirectoryPage = require("../../pages/StoreDirectoryPage");
const reportsApi = require("../../reports/ReportsApi");
const reportMappings = require("../../reports/reportMappings");
const { getStores, getDateRanges } = require("../../reports/reconciliationConfig");
const { formatLine, buildHtml, injectLogStyles, logRow } = require("../../reports/reconciliationReport");

describe("Report Reconciliation", () => {
  const stores = getStores();
  const allRows = [];

  before(() => {
    injectLogStyles();
  });

  // Retries (cypress.config.js) re-run the test from the top - start each
  // attempt clean so the HTML report and final assertion only reflect the
  // last attempt, not leftover rows from one that failed partway.
  beforeEach(() => {
    allRows.length = 0;
  });

  // Runs even when a comparison fails, so the HTML report always shows what
  // was compared - including the mismatches that failed the test.
  after(() => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp =
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_` +
      `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const file = `cypress/reports-output/reconciliation-${stamp}.html`;

    cy.writeFile(file, buildHtml(allRows, now.toLocaleString()));
    cy.task("log", `HTML report written to ${file}`);
  });

  // One test for all stores so the login form is only filled in once: the
  // first store comes from the cached login session, every store after that
  // is reached via "Back to Super Admin" -> store directory, same as a person
  // switching stores by hand.
  it(`report values match across reports for stores: ${stores.join(", ")}`, () => {
    stores.forEach((store, index) => {
      if (index === 0) {
        cy.loginAndEnterStore(Cypress.env("storeName"), Cypress.env("username"), Cypress.env("password"), store);
      } else {
        storeDirectoryPage.backToSuperAdmin();
        storeDirectoryPage.enterStore(store);
      }

      reportsApi.captureContext().then((context) => {
        getDateRanges().forEach((range) => {
          reportsApi.reconcile(context, range, reportMappings).then((results) => {
            results.forEach((result) => {
              const row = { ...result, store, line: `[${store}] ${formatLine(result)}` };
              logRow(row);
              cy.task("log", row.line, { log: false });
              allRows.push(row);
            });
          });
        });
      });
    });

    cy.then(() => {
      const mismatches = allRows.filter((r) => !r.match);
      expect(allRows, "comparisons run").to.not.be.empty;
      expect(mismatches, "\n" + mismatches.map((m) => m.line).join("\n")).to.be.empty;
    });
  });
});
