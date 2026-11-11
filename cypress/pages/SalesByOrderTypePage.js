const { pickDateRange } = require("./datePicker");
const { selectAllInStoresFilter } = require("./reportStorePickers");

// Reporting > Sales > Sales by Order Type. Opens on Today with only the
// current store selected in its "Stores" picker (the same picker as Sales by
// Category); dates and stores only take effect once "Search" is clicked.
class SalesByOrderTypePage {
  visit() {
    cy.visit("/merchants/store-reporting/new-sale-report/new-sales-by-order-type");
    return cy.contains("button", /^Yesterday$/, { timeout: 30000 }).should("be.visible");
  }

  // `range`: { startDate, endDate } as "YYYY-MM-DD".
  selectDatesAndSearch(range) {
    pickDateRange("reactDatepicker", range);
    return cy.contains("button", /^Search$/).click();
  }

  selectAllStoresAndSearch() {
    return selectAllInStoresFilter();
  }
}

module.exports = new SalesByOrderTypePage();
