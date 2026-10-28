const { outletDropDownTrigger, selectAllInOutletDropDown } = require("./reportStorePickers");

// Reporting > Sales > Category Sales (Detailed). Opens with only the current
// store selected in its "Outlet" picker.
class DetailedCategoryReportPage {
  visit() {
    cy.visit("/merchants/store-reporting/new-sale-report/detailed-category-report");
    return outletDropDownTrigger().should("be.visible");
  }

  selectAllStoresAndSearch() {
    return selectAllInOutletDropDown();
  }

  // While a report call is running, the page shows skeleton placeholders
  // (react-loading-skeleton) in place of the table. A new call cancels one
  // still running, so wait for these to go before changing the filters.
  waitUntilLoaded() {
    return cy.get("body", { timeout: 60000 }).should(($body) => {
      expect($body.find(".react-loading-skeleton").length, "report loading placeholders").to.equal(0);
    });
  }

  // "Today", "Yesterday", "Last 7 Days" or "Last 30 Days". Picking one runs
  // the report for it straight away - no Search needed.
  selectDateRange(option) {
    return cy.contains(".order_Details_days", new RegExp(`^${option}$`), { timeout: 30000 }).click();
  }

  // One header per category box, with the category name in its <span>.
  categoryNames() {
    return cy.get(".q-attributes-bottom-header > span", { timeout: 60000 });
  }

  // The report as the page shows it, as text: per category its column
  // headers, item rows (cell texts, in header order) and "Total" row, plus
  // the "Grand Total" row. Only call once the report has loaded.
  readTable() {
    return cy.contains("tr", /^\s*Grand Total/, { timeout: 60000 }).should("be.visible").then(() => {
      const $ = Cypress.$;
      const doc = cy.state("document");
      const text = (el) => $(el).text().replace(/\s+/g, " ").trim();
      const cellsOf = (tr) => $(tr).find("td, th").map((_, cell) => text(cell)).get();

      const categories = $(doc)
        .find(".q-attributes-bottom-header")
        .map((_, header) => {
          const $table = $(header).closest(".box_shadow_div").find("table").first();
          const rows = $table.find("tbody tr").map((_, tr) => [cellsOf(tr)]).get();
          return {
            name: text($(header).children("span").first()),
            headers: $table.find("thead th").map((_, th) => text(th)).get(),
            items: rows.slice(0, -1),
            total: rows[rows.length - 1],
          };
        })
        .get();
      const grandTotalRow = $(doc).find("tr").filter((_, tr) => /^Grand Total/.test(text(tr))).first();

      return { categories, grandTotal: cellsOf(grandTotalRow) };
    });
  }

  // Downloads the report as shown, as a CSV built in the browser. The link
  // only appears once the report has data.
  exportCsv() {
    return cy.get("a.export-report-android:visible", { timeout: 30000 }).should("have.length", 1).click();
  }
}

module.exports = new DetailedCategoryReportPage();
