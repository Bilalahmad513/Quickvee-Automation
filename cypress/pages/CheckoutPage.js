class CheckoutPage {
  // The cart drawer's "Continue to checkout" is a real `<a href="/payment-cart/
  // <merchantId>?orderMethod=pickup">` link (confirmed live), but clicking
  // through the drawer was confirmed flaky under Cypress - the drawer can
  // report itself visible and then be `display: none` by the very next
  // command, with nothing in between to explain why. Navigating straight to
  // that URL lands on the exact same page without depending on the drawer
  // staying open.
  goToPaymentCart(merchantId) {
    return cy.visit(`/payment-cart/${merchantId}?orderMethod=pickup`, { failOnStatusCode: false });
  }

  // Only appears for a guest (not-yet-logged-in) cart - a no-op otherwise so
  // this step doesn't fail when the customer session is already signed in.
  // Checking for the button immediately after the page loads was confirmed
  // live to race the page's own data fetches (pricing/cart totals) - the
  // button hadn't rendered yet, so the check silently (and wrongly)
  // concluded it was absent. Waiting for "Grand Total" first - rendered in
  // the same order-summary panel, right alongside this button - gives the
  // page a real, checkable signal that it has actually finished loading.
  clickCheckoutWithLogin() {
    cy.contains("Grand Total", { timeout: 15000 }).should("be.visible");
    return cy.get("body").then(($body) => {
      if ($body.find('button:contains("Checkout with Login")').length > 0) {
        return cy.contains("button", "Checkout with Login").click();
      }
    });
  }

  // Only lands on /customer-login when not already signed in - a no-op
  // otherwise, so the test doesn't fail once a customer session already
  // exists. The page's top area also has a "Sign in" TAB-style toggle
  // (already active by default, `type="button"`) with the exact same text as
  // the real submit button - confirmed live that clicking by text alone
  // unreliably hits the inert tab instead, silently doing nothing (no
  // network request at all). `button[type="submit"]` targets only the real
  // one.
  loginIfNeeded(email, password) {
    return cy.url().then((url) => {
      if (url.includes("/customer-login")) {
        cy.get('input[name="username"]').type(email);
        cy.get('input[name="password"]').type(password);
        return cy.get('button[type="submit"]').click();
      }
    });
  }

  // Used on both the Review-cart (Step 1) and Details (Step 2) pages. The
  // button's real DOM textContent is mixed-case on Step 1 but all-uppercase
  // on Step 2 (confirmed live, not just CSS text-transform) - matchCase:false
  // handles both without needing to know which step we're on.
  proceedToCheckout() {
    return cy.contains("button", "Proceed to checkout", { matchCase: false }).click();
  }

  // The Review-cart -> Details transition is async (the SPA router swaps
  // content after the click, not on it) - confirmed live that clicking
  // "Proceed to checkout" a second time immediately after the first, with no
  // wait in between, can land on the still-mounting Details page and not
  // register. Waiting for "ID Verification" (unique to Details) first
  // confirms the page actually transitioned before clicking again.
  //
  // The pre-filled ID document itself loads separately and later: the field
  // shows a literal "Upload Document Here" placeholder until the customer's
  // saved document reference finishes fetching and replaces it with the
  // filename. Confirmed live that clicking "Proceed to checkout" before that
  // swap happens trips a real, persistent client-side validation error
  // ("Please select document") that blocks the Details -> Payment
  // transition for the rest of the test - so this field must be waited on
  // directly, not just the static "ID Verification" heading.
  confirmOnDetailsPage() {
    cy.contains("ID Verification", { timeout: 15000 }).should("be.visible");
    return cy.contains("Upload Document Here", { timeout: 10000 }).should("not.exist");
  }

  // The Details page's Contact/ID fields come pre-filled from the logged-in
  // customer's saved account data, and the Payment page's payment method and
  // pickup option are pre-selected by default - confirmed live, nothing to
  // fill in either step before this. Clicking "Proceed to checkout" from
  // Details triggers several sequential API calls (account detail, payment
  // config, card list, notification settings) before the Payment form
  // actually renders - confirmed live that querying for "Choose Date" first
  // avoids a race where `pickupdate` is queried while the Details form is
  // still on screen.
  selectPickupDate() {
    cy.contains("Choose Date", { timeout: 15000 }).should("be.visible");
    cy.get('input[name="pickupdate"]').click();
    return cy.get('button[role="gridcell"]:not([disabled])', { timeout: 8000 }).first().click();
  }

  // The visible "Select Time" label and the underlying native input are both
  // `pointer-events: none` (MUI's floating-label pattern) - the real
  // clickable trigger is the MUI Select's div[role="combobox"], confirmed
  // live via id="pickup-time-select".
  selectPickupTime(time = "09:30 AM") {
    cy.get("#pickup-time-select").click();
    return cy.contains('[role="option"]', time, { timeout: 8000 }).click();
  }

  placeOrder() {
    return cy.contains("button", "PLACE ORDER").click();
  }

  // Confirms the redirect to the order receipt page and that the receipt
  // itself rendered (not just the "Payment in progress" transitional state) -
  // confirmed live via the real "Order receipt" / "Order #" text.
  confirmOrderPlaced() {
    cy.url({ timeout: 20000 }).should("include", "orderSummeryPage");
    return cy.contains("Order receipt", { timeout: 15000 }).should("be.visible");
  }
}

module.exports = new CheckoutPage();
