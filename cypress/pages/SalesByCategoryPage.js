const { storesFilterTrigger, selectAllInStoresFilter } = require("./reportStorePickers");

// Reporting > Sales > Sales by Category. Opens with only the current store
// selected in its "Stores" picker.
class SalesByCategoryPage {
  visit() {
    cy.visit("/merchants/store-reporting/new-sale-report/sales-by-category");
    return storesFilterTrigger().should("be.visible");
  }

  selectAllStoresAndSearch() {
    return selectAllInStoresFilter();
  }
}

module.exports = new SalesByCategoryPage();
