const { storesFilterTrigger, selectAllInStoresFilter } = require("./reportStorePickers");

// Reporting > Sales > Overall Sales Summary. Opens with only the current
// store selected in its "Stores" picker.
class SalesSummaryPage {
  visit() {
    cy.visit("/merchants/store-reporting/new-sale-report/sales-summary");
    return storesFilterTrigger().should("be.visible");
  }

  selectAllStoresAndSearch() {
    return selectAllInStoresFilter();
  }
}

module.exports = new SalesSummaryPage();
