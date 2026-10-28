const { selectAllInSelectAllPopover } = require("./reportStorePickers");

// Reporting > Sales > Category Sold Report. Unlike the other category
// reports it opens with every store on the account already selected, and
// reloads its data on every change in the store picker (no Search button).
class CategorySoldReportPage {
  visit() {
    cy.visit("/merchants/store-reporting/category-sold-report");
    return this.storesTrigger().should("be.visible");
  }

  // Reads "All Stores", "2 Stores Selected", etc.
  storesTrigger() {
    return cy.contains('button[aria-haspopup="dialog"]', /Stores?\b/, { timeout: 30000 });
  }

  selectAllStores() {
    selectAllInSelectAllPopover(() => this.storesTrigger());
    return this.storesTrigger().should("have.text", "All Stores");
  }

  // Downloads the report as shown (selected stores and dates) as a CSV.
  exportCsv() {
    return cy.contains("button", /Export CSV/, { timeout: 30000 }).click();
  }
}

module.exports = new CategorySoldReportPage();
