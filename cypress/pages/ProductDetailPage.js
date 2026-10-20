class ProductDetailPage {
  // A variant product's detail page renders one button per attribute value
  // (e.g. Size: Small/Medium/Large) above the Quantity section instead of
  // going straight to it - confirmed live on a real variant product's
  // storefront page. One value renders pre-selected by default, but this
  // clicks a random one explicitly so the flow doesn't depend on that
  // default happening to be in stock. The class is CSS-modules-hashed
  // (`_flavorButton_<hash>`), so matched by a stable substring instead of
  // the full class name.
  selectRandomVariant() {
    return cy.get('button[class*="flavorButton"]', { timeout: 15000 }).then(($buttons) => {
      const button = Cypress._.sample($buttons.toArray());
      return cy.wrap(button).click();
    });
  }

  // Scopes every lookup here to the Quantity section (which also contains
  // the Add to cart button) rather than generic text/class selectors,
  // since "Add to cart" also appears repeatedly in the "Highest Selling
  // Products" suggestions further down the same page.
  quantitySection() {
    return cy.contains("span", "Quantity").parent();
  }

  increaseQuantity() {
    return this.quantitySection().find('button[aria-label="Increase quantity"]').click();
  }

  getQuantity() {
    return this.quantitySection().find("output").invoke("text");
  }

  // Quantity starts at 1 and only has +/- buttons (it's a read-only
  // <output>, not an editable input), so reaching a given amount means
  // clicking "+" that many times. Picking a random target instead of a
  // fixed one means repeated runs don't always add the same quantity.
  // Clicking "+" repeatedly back-to-back (no gap between clicks) was
  // confirmed live to lose clicks - the displayed quantity stayed at 1
  // despite several increases being queued, almost certainly because the
  // button's re-render after each click isn't done before the next click
  // fires. A short wait between clicks avoids that.
  selectRandomQuantity(min = 2, max = 5) {
    const target = Cypress._.random(min, max);
    for (let i = 1; i < target; i++) {
      this.increaseQuantity();
      cy.wait(400);
    }
    return this.getQuantity();
  }

  addToCart() {
    return this.quantitySection().contains("button", "Add to cart").click();
  }
}

module.exports = new ProductDetailPage();
