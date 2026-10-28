const detailedCategoryReportPage = require("../../pages/DetailedCategoryReportPage");
const reportsApi = require("../../reports/ReportsApi");
const { compareDetailedCategoryCsv } = require("../../reports/detailedCategoryCsvChecks");
const { buildDetailedCategoryHtml } = require("../../reports/detailedCategoryHtmlReport");
const { injectLogStyles, logRow, formatLine } = require("../../reports/reconciliationReport");

// Read-only: opens the report, picks a date range and exports - nothing is
// created, edited or deleted. Override the store with
// --env detailedCategoryStore=<store>,detailedCategoryStoreId=<merchant id>.
const STORE = Cypress.env("detailedCategoryStore") || "storeb";
const STORE_ID = Cypress.env("detailedCategoryStoreId") || "BIL2215335CA";

// react-csv saves the export under this name (Chrome may add ".csv").
const CSV_PREFIX = "category_sales_detailed";

const formatDate = (date) => {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

// The page's "Last 30 Days": today and the 29 days before it.
function last30Days() {
  const start = new Date();
  start.setDate(start.getDate() - 29);
  return { label: "last 30 days", startDate: formatDate(start), endDate: formatDate(new Date()) };
}

// Polls until the export has finished saving (about 30s at most).
function waitForDownload(prefix, attemptsLeft = 60) {
  return cy.task("readDownload", prefix, { log: false }).then((file) => {
    if (file) return file;
    if (attemptsLeft <= 1) throw new Error(`No "${prefix}*" file was downloaded.`);
    cy.wait(500, { log: false });
    return waitForDownload(prefix, attemptsLeft - 1);
  });
}

describe("Category Sales (Detailed) Export CSV", () => {
  before(() => {
    injectLogStyles();
  });

  // Every cell compared goes into the HTML report; the command log shows one
  // row per category, the Grand Total columns and any mismatch.
  function writeHtmlReport(report) {
    const now = new Date();
    const stamp = `${formatDate(now)}_${[now.getHours(), now.getMinutes(), now.getSeconds()].map((n) => String(n).padStart(2, "0")).join("-")}`;
    const file = `cypress/reports-output/detailed-category-export-csv-${stamp}.html`;
    cy.writeFile(file, buildDetailedCategoryHtml({ ...report, info: { ...report.info, generatedAt: now.toLocaleString() } }));
    cy.task("log", `HTML report written to ${file}`);
  }

  it(`Export CSV matches the Category Sales (Detailed) report for store ${STORE} (${STORE_ID}), last 30 days`, () => {
    const range = last30Days();

    cy.loginAndEnterStore(Cypress.env("storeName"), Cypress.env("username"), Cypress.env("password"), STORE);
    detailedCategoryReportPage.visit();
    detailedCategoryReportPage.waitUntilLoaded();

    reportsApi
      .reportCallAfter(
        "detailed_category_sale_fact",
        () => detailedCategoryReportPage.selectDateRange("Last 30 Days"),
        (fields) => fields.start_date === range.startDate && fields.end_date === range.endDate,
        "Last 30 Days"
      )
      .then(({ fields, body }) => {
        expect(fields.merchant_id, "report is for store").to.equal(STORE_ID);
        const reportData = (body && body.report_data) || {};
        const categories = Object.keys(reportData);
        expect(categories, `${STORE} has category sales from ${range.startDate} to ${range.endDate}`).to.not.be.empty;

        // Wait until the page shows this answer (not the "Today" one it
        // opened with): same categories, in the same order.
        const squash = (s) => String(s).replace(/\s+/g, " ").trim();
        detailedCategoryReportPage.categoryNames().should(($names) => {
          expect($names.map((_, el) => squash(el.textContent)).get(), "categories shown").to.deep.equal(categories.map(squash));
        });

        detailedCategoryReportPage.readTable().then((table) => {
          const itemsShown = table.categories.reduce((sum, c) => sum + c.items.length, 0);
          const itemsInApi = Object.values(reportData).reduce((sum, items) => sum + items.length, 0);
          expect(itemsShown, "item rows shown = items in the report's data").to.equal(itemsInApi);

          cy.task("clearDownloads");
          detailedCategoryReportPage.exportCsv();

          waitForDownload(CSV_PREFIX).then((file) => {
            cy.task("log", `Downloaded ${file.name}`);
            const { detail, rows: results } = compareDetailedCategoryCsv(file.content, table, range);
            const rows = results.map((row) => ({ ...row, store: STORE, line: `[${STORE}] ${formatLine(row)}` }));
            rows.forEach((row) => {
              logRow(row);
              cy.task("log", row.line, { log: false });
            });
            writeHtmlReport({
              detail,
              rows,
              info: { storeName: STORE, storeId: STORE_ID, range, fileName: file.name, csvText: file.content },
            });

            const mismatches = rows.filter((r) => !r.match);
            expect(rows, "checks run").to.not.be.empty;
            expect(mismatches, "\n" + mismatches.map((m) => m.line).join("\n")).to.be.empty;
          });
        });
      });
  });
});
