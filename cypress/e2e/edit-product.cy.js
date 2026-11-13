const productsPage = require("../pages/ProductsPage");
const productFormPage = require("../pages/ProductFormPage");
const storefrontPage = require("../pages/StorefrontPage");
const { randomProductName, randomPricePair, randomUpc } = require("../support/testData");

const SIZE_VALUE_POOL = ["Small", "Medium", "Large", "X-Large", "X-Small"];

// Each test creates its own product first (so no existing product is ever
// touched) and:
//   1. checks it on the online store ("View Online Store"): found by its
//      name, its page shows that name and its price (each variant's price);
//   2. opens it from the Products list - the row's chevron, then "Edit
//      product" - and changes it: name, category, brand and tag (brand / tag
//      only if the product has one), UPC and price;
//   3. after "Save changes", opens the edit form again: every new value must
//      be there, the old category / brand / tag gone, and the list must show
//      the new name;
//   4. checks the online store again: found by the new name, its page shows
//      the new name and new price(s), and the old name no longer comes up;
//   5. turns the product off from the admin (single product: "Active"
//      unticked; with variants: every variant's Active switch off) - the
//      online store's search mustn't find it any more;
//   6. turns it on again - found in the search again, with its name and
//      price(s).
// The online store takes a while to pick up any of these changes, so every
// online-store step keeps searching (and reloading) for up to a few minutes.
//
// Cost can't be edited: the edit form has it disabled ("Locked - adjust via
// Stocktake or receiving", confirmed live 13 Nov 2026), so the tests check
// it stays locked and unchanged instead. The online store never shows cost.
//
// Opening the online store clears the browser's cookies/storage (see
// StorefrontPage.visitViaOnlineStoreLink), so cy.enterDataStore() is called
// again to get back into the admin.

// Queued like a command, so it appears after the check before it passed.
function logStore(message) {
  cy.then(() => Cypress.log({ name: "online store", message }));
  cy.task("log", `[online store] ${message}`, { log: false });
}

// Opens the product on the online store and checks its name and price.
// `prices`: the price ("30.00") for a single product, or { variant: price }.
function checkOnlineStore(name, prices) {
  storefrontPage.visitViaOnlineStoreLink();
  storefrontPage.openProduct(name);
  logStore(`"${name}" found, its page reads "${name}"`);
  if (typeof prices === "string") {
    storefrontPage.waitForPrice(prices);
    logStore(`price $${prices}`);
    return;
  }
  Object.entries(prices).forEach(([variant, price]) => {
    storefrontPage.waitForPrice(price, { beforeCheck: () => storefrontPage.selectVariant(variant) });
    logStore(`${variant}: price $${price}`);
  });
}

// Back in the admin: opens the product from the Products list, turns it off
// (active: false) or on again, saves, and checks the edit form kept it.
// Single product: the "Active" checkbox; with variants: every variant's
// Active switch.
function setProductActive(name, active, { variants }) {
  cy.enterDataStore();
  productsPage.visit();
  productsPage.openEditForm(name).then((url) => {
    if (variants) productFormPage.setAllVariantsActive(active);
    else productFormPage.setActive(active);
    logChange(variants ? "Active (every variant)" : "Active", active ? "off" : "on", active ? "on" : "off");
    productFormPage.saveChanges();

    cy.visit(url);
    cy.get('input[placeholder="Enter product name"]', { timeout: 30000 }).should("have.value", name);
    if (variants) productFormPage.assertAllVariantsActive(active);
    else productFormPage.assertActive(active);
  });
}

// Turned off: the online store's search no longer finds it.
function checkHiddenOnStore(name) {
  storefrontPage.visitViaOnlineStoreLink();
  storefrontPage.waitForProductGone(name).then((gone) => {
    expect(gone, `"${name}" (turned off) no longer found in the online store's search`).to.equal(true);
    logStore(`"${name}" (turned off) no longer found in search`);
  });
}

function checkOldNameGone(oldName) {
  storefrontPage.waitForProductGone(oldName).then((gone) => {
    expect(gone, `old name "${oldName}" no longer found on the online store`).to.equal(true);
    logStore(`old name "${oldName}" no longer found`);
  });
}

// A new price above the cost, different from the old one.
function newPriceFor(cost, oldPrice) {
  let price;
  do {
    price = (Number(cost) + Cypress._.random(5, 30)).toFixed(2);
  } while (Number(price) === Number(oldPrice));
  return price;
}

function logChange(field, from, to) {
  const before = Array.isArray(from) ? from.join(", ") : from;
  const message = `${field}: ${before || "(none)"} -> ${to}`;
  cy.then(() => Cypress.log({ name: "edit", message }));
  cy.task("log", `[edit] ${message}`, { log: false });
}

// Category always (it's required), Brand and Tags only if the product has
// one: the old one is removed and a different one picked. `changes` gets
// { from: [...], to } per field changed.
function changeCategoryBrandTag(changes) {
  [
    { label: "Categories", key: "category", pick: (exclude) => productFormPage.selectRandomCategory({ exclude }), always: true },
    { label: "Brand", key: "brand", pick: (exclude) => productFormPage.selectRandomBrand({ exclude }) },
    { label: "Tags", key: "tag", pick: (exclude) => productFormPage.selectRandomTag({ exclude }) },
  ].forEach(({ label, key, pick, always }) => {
    productFormPage.chipNames(label).then((old) => {
      if (!old.length && !always) {
        logChange(label, "", "(left empty - the product has none)");
        return;
      }
      productFormPage.removeChips(label);
      pick(old).then((picked) => {
        changes[key] = { label, from: old, to: picked };
        logChange(label, old, picked);
      });
    });
  });
}

// After saving and reopening: each changed field shows its new chip and
// none of its old ones.
function verifyCategoryBrandTag(changes) {
  ["category", "brand", "tag"].forEach((key) => {
    const change = changes[key];
    if (!change) return;
    productFormPage.fieldBlock(change.label).should(($block) => {
      const names = $block
        .find(".qv-inv-chip")
        .toArray()
        .map((chip) => chip.querySelector("span").innerText.trim());
      expect(names, `${change.label} after saving`).to.include(change.to);
      change.from.forEach((old) => expect(names, `${change.label} after saving`).to.not.include(old));
    });
  });
}

describe("Edit Product", () => {
  beforeEach(() => {
    cy.enterDataStore();
    productsPage.visit();
  });

  it("creates a simple product, then edits its name, category, brand, tag, UPC and price", () => {
    const originalName = randomProductName();
    const pricing = randomPricePair();
    productsPage.clickAddProduct();
    productsPage.chooseSingleProductType();
    productFormPage.fillName(originalName);
    productFormPage.selectRandomCategory();
    productFormPage.selectRandomBrand();
    productFormPage.selectRandomTag();
    productFormPage.fillSimplePricing(pricing.cost, pricing.price);
    productFormPage.fillAvailableToSell();
    productFormPage.save();
    productFormPage.assertAddedSuccessfully();

    // --- On the online store as created ---
    checkOnlineStore(originalName, pricing.price);

    // --- Edit it ---
    const changes = {};
    const newName = randomProductName();
    const newUpc = randomUpc();

    cy.enterDataStore();
    productsPage.visit();
    productsPage.openEditForm(originalName).then((url) => (changes.url = url));

    productFormPage.fillName(newName);
    logChange("Name", originalName, newName);
    changeCategoryBrandTag(changes);

    productFormPage
      .simpleField("UPC")
      .invoke("val")
      .then((oldUpc) => logChange("UPC", oldUpc, newUpc));
    productFormPage.simpleField("UPC").clear().type(newUpc);

    productFormPage
      .simpleField("Cost")
      .should("be.disabled")
      .invoke("val")
      .then((cost) => {
        changes.cost = cost;
        logChange("Cost", cost, "(locked on the edit form - not editable)");
        productFormPage
          .simpleField("Price")
          .invoke("val")
          .then((oldPrice) => {
            changes.price = newPriceFor(cost, oldPrice);
            logChange("Price", oldPrice, changes.price);
            productFormPage.simpleField("Price").clear().type(changes.price);
          });
      });

    productFormPage.saveChanges();

    // --- Saved? Open the edit form again and check every field ---
    cy.then(() => cy.visit(changes.url));
    cy.get('input[placeholder="Enter product name"]', { timeout: 30000 }).should("have.value", newName);
    verifyCategoryBrandTag(changes);
    productFormPage.simpleField("UPC").should("have.value", newUpc);
    productFormPage.simpleField("Price").should(($input) => expect(Number($input.val()), "Price after saving").to.equal(Number(changes.price)));
    productFormPage.simpleField("Cost").should(($input) => {
      expect($input, "Cost").to.be.disabled;
      expect(Number($input.val()), "Cost after saving (unchanged)").to.equal(Number(changes.cost));
    });

    // --- And the list shows it under its new name, UPC and price ---
    productsPage.visit();
    cy.then(() =>
      productsPage
        .searchProduct(newName)
        .should("contain.text", newUpc)
        .and("contain.text", `$${changes.price}`)
    );

    // --- And the online store shows the new name and price ---
    cy.then(() => checkOnlineStore(newName, changes.price));
    checkOldNameGone(originalName);

    // --- Turned off: gone from the online store's search ---
    setProductActive(newName, false, { variants: false });
    checkHiddenOnStore(newName);

    // --- Turned on again: back on the online store ---
    setProductActive(newName, true, { variants: false });
    cy.then(() => checkOnlineStore(newName, changes.price));
  });

  it("creates a product with variants, then edits its name, category, brand, tag, and each variant's UPC and price", () => {
    const originalName = randomProductName();
    const [valueA, valueB] = Cypress._.sampleSize(SIZE_VALUE_POOL, 2);
    const pricing = randomPricePair();
    productsPage.clickAddProduct();
    productsPage.chooseVariantProductType();
    productFormPage.fillName(originalName);
    productFormPage.selectRandomCategory();
    productFormPage.selectRandomBrand();
    productFormPage.selectRandomTag();
    productFormPage.selectAttribute("Size");
    productFormPage.addVariantValue(valueA);
    productFormPage.addVariantValue(valueB);
    productFormPage.fillAllVariantPrices(pricing.cost, pricing.price);
    productFormPage.fillAllVariantAvailableToSell();
    productFormPage.save();
    productFormPage.assertAddedSuccessfully();

    // --- On the online store as created: every variant at the same price ---
    storefrontPage.visitViaOnlineStoreLink();
    storefrontPage.openProduct(originalName);
    logStore(`"${originalName}" found, its page reads "${originalName}"`);
    storefrontPage.variantButtonNames().then((variants) => {
      expect(variants, "variants on the online store").to.have.length(2);
      variants.forEach((variant) => {
        storefrontPage.waitForPrice(pricing.price, { beforeCheck: () => storefrontPage.selectVariant(variant) });
        logStore(`${variant}: price $${pricing.price}`);
      });
    });

    // --- Edit it ---
    const changes = { variants: {} };
    const newName = randomProductName();

    cy.enterDataStore();
    productsPage.visit();
    productsPage.openEditForm(originalName).then((url) => (changes.url = url));

    productFormPage.fillName(newName);
    logChange("Name", originalName, newName);
    changeCategoryBrandTag(changes);

    // Each variant's row (collapsed, as the form opens) has its UPC, Cost
    // (disabled) and Price right in it. Rows are looked up by their
    // data-npf-vcard id each time - typing in one can re-render the others.
    cy.get("[data-npf-vcard]", { timeout: 30000 }).then(($cards) => {
      const ids = $cards.toArray().map((el) => el.getAttribute("data-npf-vcard"));
      ids.forEach((id) => {
        const card = () => cy.get(`[data-npf-vcard="${id}"]`);
        card()
          .find("[data-npf-vcard-name]")
          .invoke("text")
          .then((variantText) => {
            const variant = variantText.trim();
            const upc = randomUpc();
            card()
              .find('input[name="upcCode"]')
              .first()
              .invoke("val")
              .then((oldUpc) => logChange(`${variant} UPC`, oldUpc, upc));
            card().find('input[name="upcCode"]').first().clear().type(upc);
            card()
              .find('input[placeholder="0.00"]')
              .then(($inputs) => {
                const $cost = $inputs.filter(":disabled").first();
                const $price = $inputs.not(":disabled").first();
                expect($cost.length, `${variant} Cost is locked`).to.equal(1);
                const price = newPriceFor($cost.val(), $price.val());
                changes.variants[variant] = { upc, price, cost: $cost.val() };
                logChange(`${variant} Cost`, $cost.val(), "(locked on the edit form - not editable)");
                logChange(`${variant} Price`, $price.val(), price);
              });
            card()
              .find('input[placeholder="0.00"]')
              .not(":disabled")
              .first()
              .then(($price) => cy.wrap($price).clear().type(changes.variants[variant].price));
          });
      });
    });

    productFormPage.saveChanges();

    // --- Saved? Open the edit form again and check every field ---
    cy.then(() => cy.visit(changes.url));
    cy.get('input[placeholder="Enter product name"]', { timeout: 30000 }).should("have.value", newName);
    verifyCategoryBrandTag(changes);
    cy.get("[data-npf-vcard]", { timeout: 30000 })
      .should("have.length", 2)
      .each(($card) => {
        const variant = $card.find("[data-npf-vcard-name]").text().trim();
        const expected = changes.variants[variant];
        expect(expected, `variant "${variant}" was edited`).to.exist;
        cy.wrap($card).find('input[name="upcCode"]').first().should("have.value", expected.upc);
        cy.wrap($card)
          .find('input[placeholder="0.00"]')
          .should(($inputs) => {
            const $cost = $inputs.filter(":disabled").first();
            const $price = $inputs.not(":disabled").first();
            expect(Number($price.val()), `${variant} Price after saving`).to.equal(Number(expected.price));
            expect(Number($cost.val()), `${variant} Cost after saving (unchanged)`).to.equal(Number(expected.cost));
          });
      });

    // --- And the list shows it under its new name ---
    productsPage.visit();
    productsPage.searchProduct(newName).should("be.visible");

    // --- And the online store shows the new name and each variant's new price ---
    const newPrices = () => Cypress._.mapValues(changes.variants, (v) => v.price);
    cy.then(() => checkOnlineStore(newName, newPrices()));
    checkOldNameGone(originalName);

    // --- Every variant turned off: gone from the online store's search ---
    setProductActive(newName, false, { variants: true });
    checkHiddenOnStore(newName);

    // --- Every variant turned on again: back on the online store ---
    setProductActive(newName, true, { variants: true });
    cy.then(() => checkOnlineStore(newName, newPrices()));
  });
});
