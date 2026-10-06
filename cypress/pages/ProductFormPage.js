class ProductFormPage {
  fillName(name) {
    return cy.get('input[placeholder="Enter product name"]').clear().type(name);
  }

  // Category, Brand and Tags all render as the same custom combobox: an
  // <input> whose very next sibling is the absolutely-positioned option
  // panel, each option a <button>, and typing a name with no match turns the
  // panel into a single `Create "<name>"` button. Picking randomly (instead
  // of a fixed option) means repeated runs don't keep piling onto the same
  // one; when the store has none yet, a uniquely-named one is created from
  // the same dropdown instead of failing the test.
  selectRandomOption(placeholder, uniqueNamePrefix) {
    const input = () => cy.get(`input[placeholder="${placeholder}"]`);
    // The option panel is the dropdown row's very next sibling - asserting on
    // its visibility gives Cypress's normal retry-ability (not a cy.wait())
    // for the panel's contents, whether that's existing options or none.
    const panel = () => input().parent().next();

    input().click();

    return panel()
      .should("be.visible")
      .find("button")
      .then(($buttons) => {
        if ($buttons.length > 0) {
          const randomIndex = Cypress._.random(0, $buttons.length - 1);
          cy.wrap($buttons[randomIndex]).click();
          return cy.get("body").type("{esc}");
        }

        const uniqueName = uniqueNamePrefix + Date.now().toString().slice(-5);
        input().type(uniqueName);
        cy.contains("button", `Create "${uniqueName}"`, { timeout: 8000 }).click();
        return cy.get("body").type("{esc}");
      });
  }

  selectRandomCategory() {
    return this.selectRandomOption("Add a category", "Auto Category ");
  }

  selectRandomBrand() {
    return this.selectRandomOption("Choose a brand", "Auto Brand ");
  }

  selectRandomTag() {
    return this.selectRandomOption("Add a tag", "Auto Tag ");
  }

  // Simple-product pricing row is Cost, Price*, Compare-at price in that
  // left-to-right order and all three share the same "0.00" placeholder.
  fillSimplePricing(cost, price) {
    cy.get('input[placeholder="0.00"]').eq(0).clear().type(cost);
    return cy.get('input[placeholder="0.00"]').eq(1).clear().type(price);
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

  // Each variant row renders a Cost input immediately followed by a Price
  // input, both sharing the "0.00" placeholder - walking them two at a time
  // gives every variant a cost lower than its sale price.
  fillAllVariantPrices(cost, price) {
    return cy.get('input[placeholder="0.00"]').then(($inputs) => {
      Cypress._.forEach($inputs, (el, index) => {
        cy.wrap(el).clear().type(index % 2 === 0 ? cost : price);
      });
    });
  }

  // Each variant row is collapsed by default and only shows UPC/Cost/Price -
  // clicking its chevron icon expands it to reveal the Inventory tab's
  // "Available to sell" field (the chevron is used as the click target
  // instead of the row header because the header's own center can land on
  // one of its inner inputs/toggles, which swallow the click instead of
  // bubbling up to expand the row). Interacting with one row re-renders and
  // reorders the list in ways that can detach or shuffle *other* rows' nodes,
  // so positional indexes (Nth chevron, Nth "Available to sell" label) drift
  // out of correspondence with each other across separate queries. Each row
  // carries a stable `data-npf-vcard="N"` identity attribute though, so
  // scoping both the chevron click and the field lookup to that same card
  // keeps every step tied to the right row regardless of what else reflows.
  fillAllVariantAvailableToSell(min = 10, max = 100) {
    return cy.get("[data-npf-vcard]").then(($cards) => {
      const indices = Cypress._.map($cards.toArray(), (el) => el.getAttribute("data-npf-vcard"));
      indices.forEach((idx) => {
        const card = () => cy.get(`[data-npf-vcard="${idx}"]`);
        card().find("[data-npf-vcard-chevron]").click();
        const quantity = String(Cypress._.random(min, max));
        card().contains("label", "Available to sell").parent().find("input").clear().type(quantity);
      });
    });
  }

  // Saving warns if any item has no UPC and offers to auto-generate one;
  // the branch has to `return` its cy chain so Cypress schedules it
  // properly (see store-view.cy.js for the same gotcha).
  //
  // The test environment occasionally throws up a transient "You're offline"
  // toast mid-save (a real network blip, not anything the test does), which
  // otherwise silently strands the product unsaved. Detecting it and
  // retrying the save a couple of times rides out that blip instead of
  // letting the test hang on an assertion that was never going to resolve.
  save(attemptsLeft = 2) {
    cy.contains("button", "Save product").click();
    return cy
      .get("body")
      .then(($body) => {
        if ($body.find('button:contains("Generate & save")').length > 0) {
          return cy.contains("button", "Generate & save").click();
        }
      })
      .then(() => {
        cy.wait(1000);
        return cy.get("body").then(($body) => {
          if ($body.text().includes("You're offline") && attemptsLeft > 0) {
            if ($body.find('[aria-label="Close"]').length > 0) {
              cy.contains("You're offline").parent().find('[aria-label="Close"]').click();
            }
            cy.wait(2000);
            return this.save(attemptsLeft - 1);
          }
        });
      });
  }

  assertAddedSuccessfully() {
    return cy.contains("Added Successfully", { timeout: 10000 }).should("be.visible");
  }
}

module.exports = new ProductFormPage();
