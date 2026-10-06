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
}

module.exports = new ProductsPage();
