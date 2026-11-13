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
  //
  // `exclude`: option names not to pick (e.g. the one an edited product
  // already has, so the edit really changes it).
  selectRandomOption(placeholder, uniqueNamePrefix, { verifySelected = false, exclude = [] } = {}) {
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
      return text !== "" && !/^load more$/i.test(text) && !text.startsWith('Create "') && !exclude.includes(text);
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
          return confirm(optionText).then(() => optionText);
        }

        const uniqueName = uniqueNamePrefix + Date.now().toString().slice(-5);
        input().type(uniqueName);
        cy.contains("button", `Create "${uniqueName}"`, { timeout: 8000 }).click();
        return confirm(uniqueName).then(() => uniqueName);
      });
  }

  // Each yields the name it picked (or created).
  selectRandomCategory({ exclude = [] } = {}) {
    return this.selectRandomOption("Add a category", "Auto Category ", { verifySelected: true, exclude });
  }

  selectRandomBrand({ exclude = [] } = {}) {
    return this.selectRandomOption("Choose a brand", "Auto Brand ", { exclude });
  }

  selectRandomTag({ exclude = [] } = {}) {
    return this.selectRandomOption("Add a tag", "Auto Tag ", { exclude });
  }

  // --- Edit form (Products > a product > "Edit product") ---------------
  // Same form as Add product, with "Save changes" instead of "Save product".
  // Confirmed live (13 Nov 2026): Cost and "Available to sell" are disabled
  // there - "Locked - adjust via Stocktake or receiving" - for single and
  // variant products alike, so neither can be changed by editing.

  // A Product Information field's box (label + chips + input), by its
  // label: "Brand", "Tags", "Categories" (shown as "Categories*").
  fieldBlock(label) {
    return cy.contains("label", new RegExp(`^${label}\\s*\\*?$`), { timeout: 30000 }).parent();
  }

  // The names on a field's chips (selected options), e.g. ["CAT 07"].
  chipNames(label) {
    return this.fieldBlock(label).then(($block) =>
      $block
        .find(".qv-inv-chip")
        .toArray()
        .map((chip) => chip.querySelector("span").innerText.trim())
    );
  }

  // Removes every chip from a field with its "x" - one at a time, as each
  // removal re-renders the field. A Brand chip has to go before another
  // brand can be picked (one brand per product: the "Choose a brand" box
  // only shows while there's none).
  removeChips(label) {
    return this.fieldBlock(label).then(($block) => {
      const $button = $block.find(".qv-inv-chip button").first();
      if (!$button.length) return;
      cy.wrap($button).click();
      return this.removeChips(label);
    });
  }

  // The Pricing & Inventory field under `label` ("UPC", "Cost", "Price") on
  // a single product.
  simpleField(label) {
    return cy.contains("label", new RegExp(`^${label}$`), { timeout: 30000 }).parent().find("input").first();
  }

  // --- Active (shown / sold anywhere) --------------------------------------
  // Confirmed live (13 Nov 2026):
  // - Single product: "Active" in Product Options is a <button> acting as a
  //   checkbox - its first <span> holds a check mark (<svg>) while ticked,
  //   nothing when not. Each click flips it.
  // - Product with variants: there's no Active for the whole product; each
  //   variant's row has its own Active switch ([role="switch"],
  //   aria-checked "true"/"false"; the row then reads Active / Inactive).
  //   Turning every variant off is what takes the product off sale.

  activeCheckbox() {
    return cy.contains("button", "Uncheck to disable this product everywhere", { timeout: 30000 });
  }

  isActiveTicked($button) {
    return $button.children("span").first().find("svg").length > 0;
  }

  setActive(active) {
    this.activeCheckbox().then(($button) => {
      if (this.isActiveTicked($button) !== active) cy.wrap($button).click();
    });
    return this.assertActive(active);
  }

  assertActive(active) {
    return this.activeCheckbox().should(($button) => {
      expect(this.isActiveTicked($button), "Active ticked").to.equal(active);
    });
  }

  variantActiveSwitch(id) {
    return cy.get(`[data-npf-vcard="${id}"] [role="switch"]`, { timeout: 30000 }).first();
  }

  setAllVariantsActive(active) {
    cy.get("[data-npf-vcard]", { timeout: 30000 }).then(($cards) => {
      $cards
        .toArray()
        .map((el) => el.getAttribute("data-npf-vcard"))
        .forEach((id) => {
          this.variantActiveSwitch(id).then(($switch) => {
            if ($switch.attr("aria-checked") !== String(active)) cy.wrap($switch).click();
          });
          this.variantActiveSwitch(id).should("have.attr", "aria-checked", String(active));
        });
    });
    return this.assertAllVariantsActive(active);
  }

  assertAllVariantsActive(active) {
    return cy.get("[data-npf-vcard]", { timeout: 30000 }).should(($cards) => {
      $cards.toArray().forEach((card) => {
        const name = (card.querySelector("[data-npf-vcard-name]") || {}).textContent || card.getAttribute("data-npf-vcard");
        const state = card.querySelector('[role="switch"]').getAttribute("aria-checked");
        expect(state, `variant ${name} Active`).to.equal(String(active));
      });
    });
  }

  saveChanges() {
    cy.contains("button", "Save changes").click();
    // Whatever comes first: a success message, leaving the edit page, or
    // one of the messages that mean nothing was saved.
    return cy
      .get("body", { timeout: 20000 })
      .should(($body) => {
        const text = $body[0].innerText;
        const left = !$body[0].ownerDocument.location.pathname.includes("/edit/");
        const done = left || /success/i.test(text) || /You're offline/.test(text) || SAVE_VALIDATION_MESSAGES.some((m) => text.includes(m));
        expect(done, "a save outcome: success message, left the edit page, validation message or offline toast").to.equal(true);
      })
      .then(($body) => {
        const text = $body[0].innerText;
        const message = SAVE_VALIDATION_MESSAGES.find((m) => text.includes(m));
        if (message) throw new Error(`Save was blocked by the form's own validation ("${message}").`);
        if (/You're offline/.test(text)) throw new Error(`Saving the changes hit the "You're offline" toast.`);
      });
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
  // one. Every simple product the tests create gets a random 1-100 here
  // (user, 13 Nov 2026), so none is saved with 0 in stock.
  fillAvailableToSell(min = 1, max = 100) {
    const quantity = String(Cypress._.random(min, max));
    return cy
      .contains("Available to sell")
      .parent()
      .find('input[placeholder="0"]')
      .clear()
      .type(quantity)
      .should("have.value", quantity);
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
