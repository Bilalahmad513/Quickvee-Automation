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
}

module.exports = new DetailedCategoryReportPage();
