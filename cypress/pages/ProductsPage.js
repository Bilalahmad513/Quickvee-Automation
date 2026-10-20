class ProductsPage {
  visit() {
    return cy.visit("/merchants/inventory/new-products");
  }

  clickAddProduct() {
    cy.contains("button", "Add product", { timeout: 15000 }).should("be.visible").click();
    return cy.contains("Choose product type", { timeout: 10000 }).should("be.visible");
  }

  // "Continue" is rendered as an <a>, not a <button>.
  chooseSingleProductType() {
    cy.contains("Single product").click();
    return cy.contains("a", "Continue").click();
  }

  chooseVariantProductType() {
    cy.contains("Product with variants").click();
    return cy.contains("a", "Continue").click();
  }

  // A newly created product doesn't appear in the storefront's own search
  // right away (same delayed-indexing behavior CategoriesPage.clickSync()
  // works around for categories) - confirmed live it can still be missing
  // from the storefront's product-listing API after 2+ minutes of polling.
  // Clicking Sync here pushes it through instead of waiting indefinitely.
  clickSync() {
    return cy.contains("button", "Sync").click();
  }
}

module.exports = new ProductsPage();
