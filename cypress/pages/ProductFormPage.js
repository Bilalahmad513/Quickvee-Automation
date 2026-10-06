class ProductFormPage {
  fillName(name) {
    return cy.get('input[placeholder="Enter product name"]').clear().type(name);
  }

  selectCategory(categoryName) {
    cy.get('input[placeholder="Add a category"]').click();
    cy.contains(categoryName, { timeout: 8000 }).first().click();
    return cy.get("body").type("{esc}");
  }

  // Simple-product pricing row is Cost, Price*, Compare-at price in that
  // left-to-right order and all three share the same "0.00" placeholder -
  // Price is always the 2nd one.
  fillSimplePrice(amount) {
    return cy.get('input[placeholder="0.00"]').eq(1).clear().type(amount);
  }

  // The helper text above the field also reads "e.g. Size, Flavor", so a
  // plain cy.contains(attributeName) also matches that static text. Typing
  // into the dropdown's own "Search attributes..." box filters the list down
  // to the real option, then it's targeted as a <button> (the only element
  // type the option renders as) to avoid matching the help text at all.
  selectAttribute(attributeName) {
    cy.contains("Choose attribute").click();
    cy.get('input[placeholder="Search attributes..."]', { timeout: 8000 })
      .should("be.visible")
      .type(attributeName);
    return cy.contains("button", attributeName, { timeout: 8000 }).click();
  }

  // The values input's placeholder is "e.g. Small, Medium, Large" when empty,
  // then switches to "Add value" once at least one value has been entered.
  addVariantValue(value) {
    const field = () =>
      cy.get('input[placeholder="e.g. Small, Medium, Large"], input[placeholder="Add value"]').first();
    field().click();
    return field().type(`${value}{enter}`);
  }

  // Fills every generated variant's Cost/Price field with the same test
  // amount - good enough to get past "every variant needs a price"
  // validation, not meant to set realistic per-variant pricing.
  fillAllVariantPrices(amount) {
    return cy.get('input[placeholder="0.00"]').each(($el) => {
      cy.wrap($el).clear().type(amount);
    });
  }

  // Saving warns if any item has no UPC and offers to auto-generate one;
  // the branch has to `return` its cy chain so Cypress schedules it
  // properly (see store-view.cy.js for the same gotcha).
  save() {
    cy.contains("button", "Save product").click();
    return cy.get("body").then(($body) => {
      if ($body.find('button:contains("Generate & save")').length > 0) {
        return cy.contains("button", "Generate & save").click();
      }
    });
  }

  assertAddedSuccessfully() {
    return cy.contains("Added Successfully", { timeout: 10000 }).should("be.visible");
  }
}

module.exports = new ProductFormPage();
