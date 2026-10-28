const { outletDropDownTrigger, selectAllInOutletDropDown } = require("./reportStorePickers");

// Reporting > Sales > Discounts Report. Opens with only the current store
// selected in its "Outlet" picker.
class DiscountReportPage {
  visit() {
    cy.visit("/merchants/store-reporting/new-sale-report/discount");
    return outletDropDownTrigger().should("be.visible");
  }

  selectAllStoresAndSearch() {
    return selectAllInOutletDropDown();
  }
}

module.exports = new DiscountReportPage();
