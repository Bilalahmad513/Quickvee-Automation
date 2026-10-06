class CategoriesPage {
  visit() {
    cy.visit("/merchants/inventory/category");
    return this.recoverFromLoadFailure();
  }

  // This page occasionally throws a real "This page failed to load" error
  // (confirmed live, visible alongside a burst of third-party productfruits.com
  // widget requests on this route) - clicking "Try again" recovers it instead
  // of failing the whole test outright on what's an environment/widget glitch.
  recoverFromLoadFailure(attemptsLeft = 2) {
    return cy.get("body").then(($body) => {
      if ($body.text().includes("This page failed to load") && attemptsLeft > 0) {
        cy.contains("button", "Try again").click();
        cy.wait(2000);
        return this.recoverFromLoadFailure(attemptsLeft - 1);
      }
    });
  }

  clickAddCategory() {
    cy.contains("button", "Add category", { timeout: 15000 }).should("be.visible").click();
    return cy.contains("button", "Create category", { timeout: 10000 }).should("be.visible");
  }

  fillName(name) {
    return cy.get('input[placeholder="e.g. Vapes"]').clear().type(name);
  }

  save() {
    return cy.contains("button", "Create category").click();
  }

  assertCategoryExists(name) {
    return cy.contains(name, { timeout: 10000 }).should("be.visible");
  }

  // A category created here doesn't become searchable in the product form's
  // category picker on its own - confirmed live that it can still be missing
  // there after 2+ minutes and several page reloads. Clicking Sync pushes it
  // through immediately instead.
  clickSync() {
    return cy.contains("button", "Sync").click();
  }
}

module.exports = new CategoriesPage();
