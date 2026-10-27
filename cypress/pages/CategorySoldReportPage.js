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

  // The picker's header button reads "Deselect All" while every store is
  // selected (the default) and "Select All" otherwise. Clears the selection
  // first when needed so "Select All" is always really clicked, then closes
  // the picker.
  selectAllStores() {
    this.storesTrigger().click();
    cy.get('[role="dialog"]', { timeout: 15000 })
      .contains("button", /^(Select|Deselect) All$/)
      .then(($button) => {
        if ($button.text() === "Deselect All") cy.wrap($button).click();
      });
    cy.get('[role="dialog"]').contains("button", /^Select All$/).click();
    cy.get("body").type("{esc}");
    return this.storesTrigger().should("have.text", "All Stores");
  }
}

module.exports = new CategorySoldReportPage();
