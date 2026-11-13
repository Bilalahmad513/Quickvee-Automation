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

  // The list's search box ("Search by product name, variant name, UPC...")
  // filters as you type. Yields the product's row ([data-prod-row]), found
  // by its exact name (the title attribute), not a name merely containing it.
  // The search goes into the URL (?q=...) and the list reloads a moment
  // later - confirmed live that a row opened before that reload shuts again
  // - so this waits for the search to land in the URL, then a little more.
  searchProduct(name) {
    cy.get('input[placeholder^="Search by product name"]', { timeout: 30000 }).clear().type(name);
    cy.location("search", { timeout: 15000 }).should("include", "q=");
    cy.wait(1500);
    return cy.get(`[data-prod-title][title="${name}"]`, { timeout: 30000 }).should("be.visible").closest("[data-prod-row]");
  }

  // A row's own chevron (its last button) opens its actions underneath -
  // Edit product, View details, Sales history, ... (confirmed live: clicking
  // the product's name doesn't). Tried up to 3 times, in case the list
  // reloaded and shut the row again.
  openRowActions(name, attemptsLeft = 3) {
    cy.get(`[data-prod-title][title="${name}"]`, { timeout: 30000 }).closest("[data-prod-row]").find("button").last().click();
    return cy.get("body").then(($body) => {
      const shown = () => $body.find('a:contains("Edit product")').filter(":visible").length > 0;
      if (shown()) return;
      cy.wait(1500);
      return cy.get("body").then(($later) => {
        if ($later.find('a:contains("Edit product")').filter(":visible").length) return;
        if (attemptsLeft <= 1) throw new Error(`The actions under "${name}" (Edit product, ...) never opened.`);
        return this.openRowActions(name, attemptsLeft - 1);
      });
    });
  }

  // "Edit product" (under the row's actions) is a link to
  // /merchants/inventory/new-products/edit/<id>, the full product form.
  // Yields that URL.
  openEditForm(name) {
    this.searchProduct(name);
    this.openRowActions(name);
    cy.contains("a", "Edit product", { timeout: 10000 }).should("be.visible").click();
    cy.url({ timeout: 30000 }).should("include", "/edit/");
    cy.get('input[placeholder="Enter product name"]', { timeout: 30000 }).should("have.value", name);
    return cy.url();
  }
}

module.exports = new ProductsPage();
