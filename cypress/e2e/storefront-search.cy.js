const storefrontPage = require("../pages/StorefrontPage");
const productDetailPage = require("../pages/ProductDetailPage");
const checkoutPage = require("../pages/CheckoutPage");
const ordersPage = require("../pages/OrdersPage");

describe("Storefront Search", () => {
  it("searches a random product, adds it to cart, checks out with customer login, places the order, confirms it in the admin Orders module, and marks it picked up", () => {
    cy.loginAndEnterStore(
      Cypress.env("storeName"),
      Cypress.env("username"),
      Cypress.env("password"),
      Cypress.env("storeUnderTest")
    );
    // cy.session() only restores cookies/localStorage - it leaves the browser
    // on about:blank rather than wherever enterStore() last navigated to, so
    // the store's admin dashboard (where "View Online Store" lives) has to be
    // visited explicitly, same as ProductsPage/CategoriesPage do after this
    // same cached command.
    cy.visit("/merchants/dashboard");

    storefrontPage.visitViaOnlineStoreLink().then((merchantId) => {
      storefrontPage.fetchRandomProductName(merchantId).then((productName) => {
        storefrontPage.searchProduct(productName);
        cy.contains(productName, { timeout: 10000 }).should("be.visible");
        storefrontPage.selectSearchResult(productName);

        productDetailPage.selectRandomQuantity();
        productDetailPage.addToCart();

        checkoutPage.goToPaymentCart(merchantId);
        checkoutPage.clickCheckoutWithLogin();
        checkoutPage.loginIfNeeded(Cypress.env("customerEmail"), Cypress.env("customerPassword"));

        cy.contains("Review your cart", { timeout: 15000 }).should("be.visible");
        // Confirms the login itself actually happened (not just that some
        // cart page loaded, which a guest checkout would also show). The
        // email lives inside the account dropdown menu, which is collapsed
        // (display: none) until clicked - checking existence rather than
        // visibility avoids failing on that, since finding it at all already
        // confirms the logged-in state.
        cy.contains(Cypress.env("customerEmail"), { timeout: 10000 }).should("exist");

        // Step 1 (Review cart) -> Step 2 (Details)
        checkoutPage.proceedToCheckout();
        checkoutPage.confirmOnDetailsPage();
        // Step 2 (Details) -> Step 3 (Payment)
        checkoutPage.proceedToCheckout();

        checkoutPage.selectPickupDate();
        checkoutPage.selectPickupTime();
        checkoutPage.placeOrder();
        checkoutPage.confirmOrderPlaced();

        checkoutPage.getOrderId().then((orderId) => {
          // Switching back to the admin session is just a cy.session()
          // restore (same key as the call above) - cookies get swapped back
          // instantly, no login form involved, even though the storefront
          // login in between cleared them via ensureCustomerLoggedOut().
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
          // "Picked Up" is a completed/terminal status, outside the default
          // Order Status filter (Accepted/Packing/+2 more) - clearing it
          // brings the order back into view to confirm the change actually
          // took effect.
          ordersPage.clearStatusFilter();
          ordersPage.confirmPickedUp(orderId);
        });
      });
    });
  });
});
