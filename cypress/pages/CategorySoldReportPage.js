const { selectAllInSelectAllPopover, selectCurrentStoreInSelectAllPopover } = require("./reportStorePickers");
const { selectReportDates } = require("./reportDateRangeButton");
const { toNumber } = require("../support/csv");

// Reporting > Sales > Category Sold Report. Unlike the other category
// reports it opens with every store on the account already selected, and
// reloads its data on every change in the store picker (no Search button).
const NOT_AVAILABLE = /This report isn't available for your account/;

class CategorySoldReportPage {
  visit() {
    cy.visit("/merchants/store-reporting/category-sold-report");
    return this.storesTrigger().should("be.visible");
  }

  // Like visit(), but yields whether the report is available in this store
  // at all - an account without it only gets "This report isn't available
  // for your account yet" (seen live on the Item Sold Report).
  visitIfAvailable() {
    cy.visit("/merchants/store-reporting/category-sold-report");
    cy.contains(new RegExp(`Export CSV|${NOT_AVAILABLE.source}`), { timeout: 30000 }).should("be.visible");
    return cy.get("body").then(($body) => !NOT_AVAILABLE.test($body.text()));
  }

  // Reads "All Stores", "2 Stores Selected", etc.
  storesTrigger() {
    return cy.contains('button[aria-haspopup="dialog"]', /Stores?\b/, { timeout: 30000 });
  }

  selectAllStores() {
    selectAllInSelectAllPopover(() => this.storesTrigger());
    return this.storesTrigger().should("have.text", "All Stores");
  }

  // Leaves only the store the session is in selected ("Deselect All").
  selectCurrentStoreOnly() {
    return selectCurrentStoreInSelectAllPopover(() => this.storesTrigger());
  }

  // `range`: { label, startDate, endDate } ("YYYY-MM-DD") - the same date
  // range button as the Item Sold Report (reportDateRangeButton.js).
  selectDates(range) {
    return selectReportDates(range);
  }

  exportCsv() {
    return cy.contains("button", /Export CSV/, { timeout: 30000 }).click();
  }

  // The summary card above the table, as numbers: { Subtotal, Discounts,
  // "Subtotal w/ Discounts", Total, Cost, Profit, Margin }. Each figure is a
  // <p> label followed by a <p> value inside its own box (confirmed live).
  summary() {
    const totals = {};
    return cy
      .contains("p", /^Subtotal$/, { timeout: 15000 })
      .parent()
      .parent()
      .children()
      .each(($box) => {
        const [label, value] = $box.find("p").toArray();
        if (label && value) totals[label.textContent.trim()] = toNumber(value.textContent);
      })
      .then(() => totals);
  }
}

module.exports = new CategorySoldReportPage();
