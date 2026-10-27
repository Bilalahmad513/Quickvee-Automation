// Reporting > Sales > Sales by Category. Opens with only the current store
// selected in its "Stores" picker.
class SalesByCategoryPage {
  visit() {
    cy.visit("/merchants/store-reporting/new-sale-report/sales-by-category");
    return this.storesTrigger().should("be.visible");
  }

  storesTrigger() {
    return cy.get(".qv-report-filter__stores .qv-multi-location__trigger", { timeout: 30000 });
  }

  // Ticks "All Stores" in the picker (only if it isn't ticked already -
  // clicking it again would untick every store), closes the picker and runs
  // the report with "Search".
  selectAllStoresAndSearch() {
    this.storesTrigger().click();
    cy.get('[data-testid="multi-location-menu"]', { timeout: 15000 })
      .contains('li[role="menuitem"]', /^All Stores$/)
      .then(($item) => {
        if (!$item.find(".Mui-checked").length) cy.wrap($item).click();
      });
    cy.get("body").click(0, 0);
    this.storesTrigger().should("have.text", "All Stores");
    return cy.contains("button", /^Search$/).click();
  }
}

module.exports = new SalesByCategoryPage();
