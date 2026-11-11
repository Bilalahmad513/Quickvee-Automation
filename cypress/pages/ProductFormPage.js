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

const normalizeText = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();

// The picker's own container: its Field (nearest ancestor with a direct
// <label> child), or - for an unlabeled picker - the picker root, the
// input row's parent (chips row + input row + option list).
function fieldOf($input) {
  const $field = $input.parents().filter((_, el) => Cypress.$(el).children("label").length > 0).first();
  return $field.length ? $field : $input.parent().parent();
}

// Chip names in `$scope`: spans with a direct remove <button>, not inside a
// <button> themselves (option rows are buttons).
function chipTexts($scope) {
  return $scope
    .find("span")
    .filter((_, el) => Cypress.$(el).children("button").length > 0 && !el.closest("button"))
    .map((_, el) => el.textContent.trim())
    .get();
}

// The input of the field labelled `label` ("Price" also matches "Price *").
function fieldInput(label) {
  return cy
    .contains("label", new RegExp(`^\\s*${Cypress._.escapeRegExp(label)}\\s*\\*?\\s*$`), { timeout: 15000 })
    .parent()
    .find("input")
    .first();
}

const amountOf = (value) => Number(String(value || "").replace(/[^0-9.-]/g, ""));

// Whole-text match for an option, for cy.contains().
const exactText = (text) => new RegExp(`^\\s*${Cypress._.escapeRegExp(String(text).trim())}\\s*$`, "i");

// Which category step the page is at after typing `name`: "modal" (the
// Create category modal is open), "option" (an option with exactly `name`),
// "createRow" (only the `+ Create "<name>"` row), or null (still loading).
function categoryStep($body, name, allowCreate) {
  const heading = $body.find("div").filter((_, el) => el.children.length === 0 && /^\s*Create category\s*$/.test(el.textContent));
  if (allowCreate && heading.length) return "modal";
  const $buttons = $body.find('input[placeholder="Add a category"]').parent().next().find("button");
  if ($buttons.toArray().some((el) => normalizeText(el.textContent) === normalizeText(name))) return "option";
  if (allowCreate && $buttons.toArray().some((el) => el.textContent.includes(`Create "${name}"`))) return "createRow";
  return null;
}

class ProductFormPage {
  // First field on the form - the add-product page can sit on a loading
  // spinner well past the default 4s before the form renders.
  fillName(name) {
    return cy.get('input[placeholder="Enter product name"]', { timeout: 30000 }).clear().type(name);
  }

  // A selected option shows up as a chip in a row above the field's input:
  // a <span> holding the name and a remove <button> (no class to rely on -
  // the picker styles it inline). The chip is rendered from the form's own
  // state, so seeing it means the selection actually registered - not just
  // that the option was clicked. Waiting for it before moving on keeps a
  // click that hadn't landed yet from surfacing later as a "Select
  // Category" save failure.
  //
  // Scoped to the field's own container: the nearest ancestor of the input
  // with its own <label> ("Categories *" etc.), so other pickers' chips and
  // the open option list never count.
  assertChipSelected(placeholder, optionText) {
    return cy.get(`input[placeholder="${placeholder}"]`, { timeout: 10000 }).should(($input) => {
      const selected = chipTexts(fieldOf($input)).map(normalizeText);
      expect(selected, `selected in the "${placeholder}" field`).to.include(normalizeText(optionText));
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

  // Picks the first category the store already has - never creates one. A
  // store with none can't get products this way, so that throws.
  selectFirstExistingCategory() {
    const placeholder = "Add a category";
    const input = () => cy.get(`input[placeholder="${placeholder}"]`, { timeout: 30000 });
    input().click();
    return input()
      .parent()
      .next()
      .should("be.visible")
      .find("button", { timeout: 15000 })
      .then(($buttons) => {
        const options = $buttons.toArray().filter((el) => {
          const text = el.textContent.trim();
          return text !== "" && !/^load more$/i.test(text) && !text.startsWith('Create "');
        });
        if (!options.length) throw new Error("NO_CATEGORIES: this store has no categories to pick.");
        const optionText = options[0].textContent.trim();
        cy.wrap(options[0]).click();
        this.assertChipSelected(placeholder, optionText);
        cy.get("body").type("{esc}");
        return cy.wrap(optionText, { log: false });
      });
  }

  // Selects the category `name` in the Categories field, or creates it.
  //
  // After typing, whichever of these shows up first is handled (waited for,
  // not a fixed delay):
  //   - an option with exactly `name`         -> clicked
  //   - the "Create category" modal            -> filled and submitted
  //   - the list's `+ Create "<name>"` row     -> clicked, which opens the modal
  // The modal (name prefilled, Delivery + Pickup ticked, optional Taxes,
  // Cancel / "Create category") posts Categoryapi/add_category; on
  // {status: "Success"} it closes and the new category becomes a chip in
  // the Categories field. Yields "selected" or "created".
  //
  // `allowCreate: false` only ever selects (waits up to 60s - a new
  // category takes a few seconds to become searchable).
  selectOrCreateCategory(name, { allowCreate = true } = {}) {
    const placeholder = "Add a category";
    const input = () => cy.get(`input[placeholder="${placeholder}"]`, { timeout: 30000 });

    input().scrollIntoView().click();
    input().clear().type(name);

    return cy
      .get("body", { timeout: allowCreate ? 30000 : 60000 })
      .should(($body) => {
        expect(categoryStep($body, name, allowCreate), allowCreate ? `"${name}" option, its Create row or the Create category modal` : `existing "${name}" option`).to.not.equal(null);
      })
      .then(($body) => {
        const step = categoryStep($body, name, allowCreate);
        if (step === "option") {
          // Clicked through a query, not a stored element: the list
          // re-renders while it loads (confirmed live - a stale element
          // can't be clicked).
          input().parent().next().contains("button", exactText(name)).click();
          this.assertChipSelected(placeholder, name);
          cy.get("body").type("{esc}");
          return cy.wrap("selected", { log: false });
        }
        if (step === "createRow") input().parent().next().contains("button", `Create "${name}"`).click();
        return this.submitCategoryModal(name);
      });
  }

  // The "Create category" modal: the container of its own heading (the app
  // renders it without role="dialog" or a .modal class).
  categoryModal() {
    return cy.contains("div", /^\s*Create category\s*$/, { timeout: 15000 }).parent();
  }

  submitCategoryModal(name) {
    const placeholder = "Add a category";
    cy.intercept("POST", "**/Categoryapi/add_category").as("createCategory");

    this.categoryModal()
      .should("be.visible")
      .within(() => {
        cy.get('input[placeholder="Enter category name"]').then(($name) => {
          if ($name.val().trim() !== name) cy.wrap($name).clear().type(name);
        });
        cy.get('input[placeholder="Enter category name"]').should("have.value", name);
        // Delivery and Pickup stay ticked (the modal's defaults); Taxes left empty.
        cy.contains("button", /^\s*Create category\s*$/).should("be.enabled").click();
      });

    return cy.wait("@createCategory", { timeout: 30000 }).then(({ response }) => {
      expect(response.statusCode, "add_category HTTP status").to.be.within(200, 299);
      const body = typeof response.body === "string" ? Cypress._.attempt(JSON.parse, response.body) : response.body;
      const ok = body && (body.status === "Success" || body.message === "Success");
      const message = (body && (body.update_message || body.msg || body.message)) || "";

      if (ok) {
        cy.contains("div", /^\s*Create category\s*$/).should("not.exist");
        this.assertChipSelected(placeholder, name);
        cy.get("body").type("{esc}");
        return cy.wrap("created", { log: false });
      }
      if (/exist|already|duplicate/i.test(message)) {
        cy.log(`"${name}" already exists - selecting it instead`);
        this.categoryModal().within(() => cy.contains("button", /^\s*Cancel\s*$/).click());
        cy.contains("div", /^\s*Create category\s*$/).should("not.exist");
        return this.selectOrCreateCategory(name, { allowCreate: false });
      }
      throw new Error(`Creating category "${name}" failed: ${message || JSON.stringify(body)}`);
    });
  }

  // Price, Cost and Compare-at price as entered, and the form's computed
  // Margin (%) and Profit ($) - which must follow price and cost.
  assertPricing({ price, cost, compare }) {
    fieldInput("Price").should(($i) => expect(amountOf($i.val()), "Price in the form").to.equal(Number(price)));
    fieldInput("Cost").should(($i) => {
      expect(amountOf($i.val()), "Cost in the form").to.equal(Number(cost));
      expect(amountOf($i.val()), "Cost below price").to.be.lessThan(Number(price));
    });
    fieldInput("Compare-at price").should(($i) => {
      expect(amountOf($i.val()), "Compare-at price in the form").to.equal(Number(compare));
      expect(amountOf($i.val()), "Compare-at price above price").to.be.greaterThan(Number(price));
    });
    const profit = Number(price) - Number(cost);
    const margin = (profit / Number(price)) * 100;
    fieldInput("Profit").should(($i) => expect(amountOf($i.val()), "Profit = price - cost").to.be.closeTo(profit, 0.011));
    return fieldInput("Margin").should(($i) => expect(amountOf($i.val()), "Margin % = profit / price").to.be.closeTo(margin, 0.011));
  }

  // An existing product's edit page (/merchants/inventory/new-products/edit/<id>),
  // once its saved data has loaded into the form.
  visitEdit(productId) {
    cy.visit(`/merchants/inventory/new-products/edit/${productId}`);
    return cy.get('input[placeholder="Enter product name"]', { timeout: 60000 }).should("not.have.value", "");
  }

  // "Reorder point" and "Reorder quantity" (whole numbers; quantity must be
  // above 0) as the form shows them: { point, qty }.
  readReorder() {
    return fieldInput("Reorder point")
      .invoke("val")
      .then((point) => fieldInput("Reorder quantity").invoke("val").then((qty) => ({ point: String(point || ""), qty: String(qty || "") })));
  }

  setReorder(point, qty) {
    fieldInput("Reorder point").scrollIntoView().clear().type(String(point));
    fieldInput("Reorder quantity").clear().type(String(qty));
    fieldInput("Reorder point").should("have.value", String(point));
    return fieldInput("Reorder quantity").should("have.value", String(qty));
  }

  // "Compare-at price" ($, "0.00" placeholder), scoped by its label.
  fillComparePrice(value) {
    return cy.contains("Compare-at price").parent().find('input[placeholder="0.00"]').clear().type(value);
  }

  // "Related Products" (same picker as Categories, up to 15). Picks `count`
  // different existing products, one per opening of the picker, preferring
  // ones `avoid(name)` doesn't flag (e.g. products made by this same run);
  // flagged ones are used only when too few others are listed. Yields their
  // names.
  addRelatedProducts(count, { avoid = () => false } = {}) {
    const placeholder = "Search products to add...";
    const input = () => cy.get(`input[placeholder="${placeholder}"]`, { timeout: 30000 });
    const picked = [];
    const candidates = ($buttons) => $buttons.toArray().filter((el) => this.isRealOption(el) && !picked.includes(el.textContent.trim()));

    const pickOne = () => {
      input().scrollIntoView().click();
      return input()
        .parent()
        .next()
        .should("be.visible")
        .find("button", { timeout: 20000 })
        .should(($buttons) => {
          const need = count - picked.length;
          expect(candidates($buttons).length, `existing products listed for Related Products (${need} more needed)`).to.be.at.least(need);
        })
        .then(($buttons) => {
          const all = candidates($buttons);
          const option = all.find((el) => !avoid(el.textContent.trim())) || all[0];
          const name = option.textContent.trim();
          picked.push(name);
          // Clicked through a query so a re-rendered list can't leave a stale element.
          input().parent().next().contains("button", exactText(name)).click();
          return cy.get("body").type("{esc}");
        });
    };

    Cypress._.times(count, () => pickOne());
    // The picker has no label of its own, so its chips are read from the
    // picker root (input row's parent), not a labelled field.
    return input()
      .should(($input) => expect(chipTexts($input.parent().parent()).length, "related products selected").to.be.at.least(count))
      .then(() => picked);
  }

  // A real option row - not "Load more" or the `+ Create "…"` row.
  isRealOption(el) {
    const text = el.textContent.trim();
    return text !== "" && !/^load more$/i.test(text) && !/Create "/.test(text);
  }

  // "Tax Information" > "+ Add another tax" > "Choose a tax": picks the first
  // tax not already on the product. Yields its name.
  addTax() {
    cy.contains("+ Add another tax", { timeout: 15000 }).scrollIntoView().click();
    return cy
      .get('input[placeholder="Choose a tax"]', { timeout: 15000 })
      .parent()
      .next()
      .find("button", { timeout: 20000 })
      .should("have.length.at.least", 1)
      .first()
      .then(($tax) => {
        const name = $tax.find("span").first().text().trim() || $tax.text().trim();
        cy.get('input[placeholder="Choose a tax"]').parent().next().contains("button", name).click();
        cy.get('button[title="Remove tax"]', { timeout: 10000 }).should("have.length.at.least", 1);
        return cy.wrap(name, { log: false });
      });
  }

  // "Pricing & Inventory" > UPC (input name="upcCode", 30 chars max). Blur
  // starts the form's own uniqueness check.
  fillUpc(upc) {
    return cy.get('input[name="upcCode"]', { timeout: 15000 }).scrollIntoView().clear().type(upc).blur();
  }

  // Like attachPhoto(), but never fails the test: a missing file input or a
  // rejected image is only logged. Yields true if the form took the photo.
  tryAttachPhoto(fixturePath) {
    return cy.get("body").then(($body) => {
      // The product photos input is the multi-file one (each variant row has
      // its own single-file input); any image input is the fallback.
      let $input = $body.find('input[type="file"][multiple]');
      if (!$input.length) $input = $body.find('input[type="file"][accept*="image"], input[type="file"][accept*="png"]');
      if (!$input.length) {
        cy.log("Photo upload skipped - no photo input found");
        return cy.wrap(false, { log: false });
      }
      cy.wrap($input.first()).selectFile(fixturePath, { force: true });
      // The thumbnail renders from a local object URL right after the pick;
      // a rejected file shows a toast instead.
      return cy.get("body").then(($after) => {
        const attached = $after.find('button[title="Remove photo"]').length > 0;
        cy.log(attached ? "Photo attached" : "Photo was not accepted - continuing without it");
        return cy.wrap(attached, { log: false });
      });
    });
  }

  removePhotos() {
    return cy.get("body").then(($body) => {
      $body.find('button[title="Remove photo"]').each((_, button) => button.click());
    });
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
