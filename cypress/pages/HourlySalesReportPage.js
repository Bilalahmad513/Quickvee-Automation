const { storesFilterTrigger, selectAllInStoresFilter } = require("./reportStorePickers");

// Reporting > Sales > Hourly Sales Report. Opens with only the current store
// selected in its "Stores" picker.
class HourlySalesReportPage {
  visit() {
    cy.visit("/merchants/store-reporting/new-sale-report/hourly-sales-report");
    return storesFilterTrigger().should("be.visible");
  }

  selectAllStoresAndSearch() {
    return selectAllInStoresFilter();
  }
}

module.exports = new HourlySalesReportPage();
