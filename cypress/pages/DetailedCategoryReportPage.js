// Reporting > Sales > Category Sales (Detailed). Opens with only the current
// store selected in its "Outlet" picker.
class DetailedCategoryReportPage {
  visit() {
    cy.visit("/merchants/store-reporting/new-sale-report/detailed-category-report");
    return this.outletTrigger().should("be.visible");
  }

  outletTrigger() {
    return cy.get(".OutletDropDown .qv-multi-select", { timeout: 30000 });
  }

  // Ticks "All" in the Outlet picker (only if it isn't ticked already),
  // closes the picker and runs the report with "Search". The page also has a
  // Category picker with its own hidden "All" item - confirmed live - so this
  // only looks inside the picker that's actually open.
  selectAllStoresAndSearch() {
    this.outletTrigger().click();
    cy.get(".qv-multi-select__menu:visible", { timeout: 15000 })
      .contains('li[role="menuitem"]', /^All$/)
      .then(($item) => {
        if (!$item.find(".Mui-checked").length) cy.wrap($item).click();
      });
    cy.get("body").type("{esc}");
    cy.get(".qv-multi-select__menu:visible").should("not.exist");
    return cy.contains("button", /^Search$/).click();
  }
}

module.exports = new DetailedCategoryReportPage();
