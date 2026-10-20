const productsPage = require("../pages/ProductsPage");
const productFormPage = require("../pages/ProductFormPage");
const storefrontPage = require("../pages/StorefrontPage");
const productDetailPage = require("../pages/ProductDetailPage");
const checkoutPage = require("../pages/CheckoutPage");
const ordersPage = require("../pages/OrdersPage");
const { randomProductName, randomPricePair } = require("../support/testData");

const SIZE_VALUE_POOL = ["Small", "Medium", "Large", "X-Large", "X-Small"];

describe("New Product Order", () => {
  // Both products are created under one admin login, then both are added to
  // the SAME cart and checked out together as a single order (one customer
  // login, one checkout) instead of two separate orders - each
  // cy.loginAndEnterStore() call and each full checkout cycle is where this
  // environment's chronic low-memory flakiness actually hits, so this keeps
  // both down to one.
  it("creates a simple and a variant product, and places one order containing both", () => {
    cy.loginAndEnterStore(
      Cypress.env("storeName"),
      Cypress.env("username"),
      Cypress.env("password"),
      Cypress.env("storeUnderTest")
    );

    // --- Create the simple product ---
    productsPage.visit();
    cy.contains("button", "Add product", { timeout: 15000 }).should("be.visible");

    const simpleProductName = randomProductName();
    const simplePricing = randomPricePair();

    productsPage.clickAddProduct();
    productsPage.chooseSingleProductType();
    productFormPage.fillName(simpleProductName);
    productFormPage.selectRandomCategory();
    productFormPage.selectRandomBrand();
    productFormPage.selectRandomTag();
    productFormPage.fillSimplePricing(simplePricing.cost, simplePricing.price);
    productFormPage.fillAvailableToSell();
    productFormPage.save();
    productFormPage.assertAddedSuccessfully();

    // --- Create the variant product (same admin session, no re-login) ---
    productsPage.visit();
    cy.contains("button", "Add product", { timeout: 15000 }).should("be.visible");

    const variantProductName = randomProductName();
    const [valueA, valueB] = Cypress._.sampleSize(SIZE_VALUE_POOL, 2);
    const variantPricing = randomPricePair();

    productsPage.clickAddProduct();
    productsPage.chooseVariantProductType();
    productFormPage.fillName(variantProductName);
    productFormPage.selectRandomCategory();
    productFormPage.selectRandomBrand();
    productFormPage.selectRandomTag();
    productFormPage.selectAttribute("Size");
    productFormPage.addVariantValue(valueA);
    productFormPage.addVariantValue(valueB);
    productFormPage.fillAllVariantPrices(variantPricing.cost, variantPricing.price);
    productFormPage.fillAllVariantAvailableToSell();
    productFormPage.save();
    productFormPage.assertAddedSuccessfully();

    // cy.session() leaves the browser on about:blank, not wherever
    // enterStore() last navigated to - same reasoning as storefront-search.cy.js.
    cy.visit("/merchants/dashboard");

    storefrontPage.visitViaOnlineStoreLink().then((merchantId) => {
      // --- Add the simple product to the cart ---
      storefrontPage.waitForProductSearchable(simpleProductName).then((found) => {
        expect(found, `"${simpleProductName}" to become searchable on the storefront within the timeout`).to.be
          .true;

        storefrontPage.selectSearchResult(simpleProductName);
        productDetailPage.selectRandomQuantity();
        productDetailPage.addToCart();

        // --- Add the variant product to the SAME cart (search box is in the
        // shared header, reachable from the product detail page we're still on) ---
        storefrontPage.waitForProductSearchable(variantProductName).then((foundVariant) => {
          expect(
            foundVariant,
            `"${variantProductName}" to become searchable on the storefront within the timeout`
          ).to.be.true;

          storefrontPage.selectSearchResult(variantProductName);
          productDetailPage.selectRandomVariant();
          productDetailPage.selectRandomQuantity();
          productDetailPage.addToCart();

          // --- Check out ONCE, for both items together ---
          checkoutPage.goToPaymentCart(merchantId);
          checkoutPage.clickCheckoutWithLogin();
          checkoutPage.loginIfNeeded(Cypress.env("customerEmail"), Cypress.env("customerPassword"));

          // Just "exist" (not "be.visible") - the cart page renders a
          // responsive mobile/desktop layout pair for each line item and
          // hides one copy via CSS, so the first DOM match for a product
          // name can legitimately be the hidden one even though the item is
          // plainly showing on screen (confirmed live via screenshot).
          cy.contains("Review your cart", { timeout: 15000 }).should("be.visible");
          cy.contains(simpleProductName, { timeout: 15000 }).should("exist");
          cy.contains(variantProductName, { timeout: 15000 }).should("exist");

          checkoutPage.proceedToCheckout();
          checkoutPage.confirmOnDetailsPage();
          checkoutPage.proceedToCheckout();

          checkoutPage.selectPickupDate();
          checkoutPage.selectPickupTime();
          checkoutPage.placeOrder();
          checkoutPage.confirmOrderPlaced();

          checkoutPage.getOrderId().then((orderId) => {
            // Same cy.session() restore pattern as storefront-search.cy.js -
            // instant cookie swap back to the admin session, no login form.
            cy.loginAndEnterStore(
              Cypress.env("storeName"),
              Cypress.env("username"),
              Cypress.env("password"),
              Cypress.env("storeUnderTest")
            );

            ordersPage.visit();
            ordersPage.selectOnlineOrders();
            ordersPage.searchOrderId(orderId);
            ordersPage.confirmOrderVisible(orderId);

            ordersPage.markAsPickedUp(orderId);
            ordersPage.clearStatusFilter();
            ordersPage.confirmPickedUp(orderId);
          });
        });
      });
    });
  });
});
