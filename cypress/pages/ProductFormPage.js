// Messages the form shows instead of saving when a required field is empty -
// confirmed live: saving with no category shows "Select Category" and sends
// no request at all. Add more here as they're found.
const SAVE_VALIDATION_MESSAGES = ["Select Category"];

// Which of the possible outcomes of clicking "Save product" is on screen, or
// null if none yet. Uses innerText so only visible text counts.
function saveOutcome($body) {
  if ($body.find('button:contains("Generate & save")').length > 0) return { type: "upcModal" };
  const text = $body[0].innerText;
  if (text.includes("Added Successfully")) return { type: "success" };
  if (text.includes("You're offline")) return { type: "offline" };
  const message = SAVE_VALIDATION_MESSAGES.find((m) => text.includes(m));
  if (message) return { type: "validation", message };
  return null;
}

class ProductFormPage {
  // First field on the form - the add-product page can sit on a loading
  // spinner well past the default 4s before the form renders.
  fillName(name) {
    return cy.get('input[placeholder="Enter product name"]', { timeout: 30000 }).clear().type(name);
  }

  // A selected option shows up as a chip (span.qv-inv-chip) above the
  // field's input. The chip is rendered from the form's own state, so seeing
  // it means the selection actually registered - not just that the option
  // was clicked. Waiting for it before moving on keeps a click that hadn't
  // landed yet from surfacing later as a "Select Category" save failure.
  assertChipSelected(placeholder, optionText) {
    return cy
      .get(`input[placeholder="${placeholder}"]`)
      .parent()
      .parent()
      .find(".qv-inv-chip", { timeout: 10000 })
      .should(($chips) => {
        const selected = Cypress._.map($chips, (chip) => chip.innerText.trim());
        expect(selected, `selected chips in "${placeholder}"`).to.include(optionText);
      });
  }

  // Category, Brand and Tags all render as the same custom combobox: an
  // <input> whose very next sibling is the absolutely-positioned option
  // panel, each option a <button>, and typing a name with no match turns the
  // panel into a single `Create "<name>"` button. Picking randomly (instead
  // of a fixed option) means repeated runs don't keep piling onto the same
  // one; when the store has none yet, a uniquely-named one is created from
  // the same dropdown instead of failing the test.
  //
  // `verifySelected` waits for the chosen option's chip before moving on (see
  // assertChipSelected). Only used for Categories - the one required field,
  // and the one whose chip layout is confirmed; Brand renders its pick
  // differently.
  selectRandomOption(placeholder, uniqueNamePrefix, { verifySelected = false } = {}) {
    const input = () => cy.get(`input[placeholder="${placeholder}"]`);
    // The option panel is the dropdown row's very next sibling - asserting on
    // its visibility gives Cypress's normal retry-ability (not a cy.wait())
    // for the panel's contents, whether that's existing options or none.
    const panel = () => input().parent().next();
    const confirm = (optionText) => {
      if (verifySelected) this.assertChipSelected(placeholder, optionText);
      return cy.get("body").type("{esc}");
    };

    input().click();

    // The panel's buttons aren't all options: long lists end in a "Load
    // more" button (confirmed live - picking it randomly selected nothing and
    // the save later failed with "Select Category"), and a typed name with no
    // match turns into a `Create "..."` button.
    const isRealOption = (el) => {
      const text = el.textContent.trim();
      return text !== "" && !/^load more$/i.test(text) && !text.startsWith('Create "');
    };

    return panel()
      .should("be.visible")
      .find("button")
      .then(($buttons) => {
        const options = $buttons.toArray().filter(isRealOption);
        if (options.length > 0) {
          const option = Cypress._.sample(options);
          const optionText = option.textContent.trim();
          cy.wrap(option).click();
          return confirm(optionText);
        }

        const uniqueName = uniqueNamePrefix + Date.now().toString().slice(-5);
        input().type(uniqueName);
        cy.contains("button", `Create "${uniqueName}"`, { timeout: 8000 }).click();
        return confirm(uniqueName);
      });
  }

  selectRandomCategory() {
    return this.selectRandomOption("Add a category", "Auto Category ", { verifySelected: true });
  }

  selectRandomBrand() {
    return this.selectRandomOption("Choose a brand", "Auto Brand ");
  }

  selectRandomTag() {
    return this.selectRandomOption("Add a tag", "Auto Tag ");
  }

  // Same combobox as selectRandomOption, but deterministic: typing the exact
  // name filters the panel down to that one option instead of picking (or
  // creating) at random - for when the test needs this specific, already-
  // existing option rather than any option.
  //
  // An option created moments earlier (e.g. by a just-run "add category"
  // step) can take several seconds to become searchable here - confirmed
  // live that the panel shows only a `Create "<name>"` button for a while
  // before the real, exact-match option appears. `cy.contains("button",
  // name)` would happily (and wrongly) click that `Create` button instead,
  // since it also contains `name` as a substring - so this polls via
  // `.should()` for a button whose full text is an EXACT match, not merely
  // one that contains it, retrying for as long as that takes instead of a
  // fixed `cy.wait()`.
  selectOptionByName(placeholder, name, { timeout = 20000, verifySelected = false } = {}) {
    const input = () => cy.get(`input[placeholder="${placeholder}"]`);
    const panelButtons = () => input().parent().next().find("button", { timeout });
    const findExact = ($buttons) =>
      Cypress._.find($buttons.toArray(), (el) => el.textContent.trim() === name);

    input().click();
    input().type(name);

    return panelButtons()
      .should(($buttons) => {
        expect(findExact($buttons), `exact option button for "${name}"`).to.exist;
      })
      .then(($buttons) => {
        cy.wrap(findExact($buttons)).click();
        if (verifySelected) this.assertChipSelected(placeholder, name);
        return cy.get("body").type("{esc}");
      });
  }

  selectCategoryByName(name) {
    return this.selectOptionByName("Add a category", name, { verifySelected: true });
  }

  // Simple-product pricing row is Cost, Price*, Compare-at price in that
  // left-to-right order and all three share the same "0.00" placeholder.
  fillSimplePricing(cost, price) {
    cy.get('input[placeholder="0.00"]').eq(0).clear().type(cost);
    return cy.get('input[placeholder="0.00"]').eq(1).clear().type(price);
  }

  // A simple product saved with no stock quantity set defaults to 0 -
  // confirmed live that such a product never becomes searchable on the
  // storefront (the storefront's own product-listing API never returns it,
  // even after 2+ minutes of polling and clicking the Products page's Sync
  // button), regardless of indexing delay. "Available to sell" is the
  // simple-product equivalent of the variant flow's "Available to sell"
  // field (see fillAllVariantAvailableToSell) - its own input shares a bare
  // "0" placeholder with the neighboring Reorder point/quantity fields, so
  // the lookup is scoped to the label's own container to target the right
  // one.
  fillAvailableToSell(min = 10, max = 100) {
    const quantity = String(Cypress._.random(min, max));
    return cy.contains("Available to sell").parent().find('input[placeholder="0"]').clear().type(quantity);
  }

  // Single products' "SKU Codes" section: a list of "Custom Code" inputs,
  // the first one #multi-custom-code-0-0. Each code is checked for
  // uniqueness across the store (shared with UPCs) when the field loses
  // focus, so this blurs it to start that check before saving.
  fillSku(sku) {
    return cy.get("#multi-custom-code-0-0", { timeout: 15000 }).scrollIntoView().clear().type(sku).blur();
  }

  // The "Add photos" button wraps a hidden, multi-file <input type="file">
  // (jpg/png, 5 MB max). Each picked image shows as a thumbnail with its own
  // "Remove photo" button - waiting for that confirms the form took it.
  attachPhoto(fixturePath) {
    cy.contains("button", "Add photos", { timeout: 15000 }).scrollIntoView();
    cy.contains("button", "Add photos").find('input[type="file"]').selectFile(fixturePath, { force: true });
    return cy.get('button[title="Remove photo"]', { timeout: 15000 }).should("have.length.at.least", 1);
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

    // Waits (Cypress's built-in retry on `.should()`) for whichever outcome
    // shows up first, instead of guessing a fixed delay. The offline toast
    // and validation messages count as outcomes too: neither brings up the
    // UPC modal or a success message, so waiting only for those two used to
    // sit out the full 15s and fail with a message that hid the real cause.
    return cy
      .get("body", { timeout: 15000 })
      .should(($body) => {
        expect(
          saveOutcome($body),
          "a save outcome: UPC modal, success, form validation message, or offline toast"
        ).to.not.equal(null);
      })
      .then(($body) => {
        const outcome = saveOutcome($body);

        if (outcome.type === "validation") {
          throw new Error(
            `Save was blocked by the form's own validation ("${outcome.message}") - no save request was sent.`
          );
        }
        if (outcome.type === "offline") return this.retrySaveAfterOffline(attemptsLeft);
        if (outcome.type === "upcModal") {
          cy.contains("button", "Generate & save").click();
          cy.wait(1000);
          return cy.get("body").then(($after) => {
            if ($after[0].innerText.includes("You're offline")) return this.retrySaveAfterOffline(attemptsLeft);
          });
        }
      });
  }

  retrySaveAfterOffline(attemptsLeft) {
    if (attemptsLeft <= 0) {
      throw new Error(`Saving kept hitting the "You're offline" toast, even after retrying.`);
    }
    cy.get("body").then(($body) => {
      if ($body.find('[aria-label="Close"]').length > 0) {
        cy.contains("You're offline").parent().find('[aria-label="Close"]').click();
      }
    });
    cy.wait(2000);
    return this.save(attemptsLeft - 1);
  }

  assertAddedSuccessfully() {
    return cy.contains("Added Successfully", { timeout: 10000 }).should("be.visible");
  }
}

module.exports = new ProductFormPage();
