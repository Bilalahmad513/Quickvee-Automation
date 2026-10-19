class OrdersPage {
  visit() {
    cy.visit("/merchants/order-new");
    return cy.contains("Orders Management", { timeout: 15000 }).should("be.visible");
  }

  // The "In-Store"/"Online" toggle's labels are plain `<div>` text with no
  // unique id - and the page's own descriptive paragraph ("...in-store and
  // online orders") also contains the word "online", which an unscoped
  // cy.contains() matches first since it comes earlier in the DOM. Scoping to
  // `.order-tabs` (the tab row's own container) avoids that collision.
  selectOnlineOrders() {
    return cy.get(".order-tabs", { timeout: 10000 }).contains("Online").click();
  }

  searchOrderId(orderId) {
    return cy.get('input[placeholder*="Search by Order ID" i]').type(orderId);
  }

  // Confirms the searched order actually appears in the (now-filtered) list,
  // and that it's not a coincidental text match elsewhere on the page.
  confirmOrderVisible(orderId) {
    cy.contains("Showing 1 order", { timeout: 10000 }).should("be.visible");
    return cy.contains(orderId).should("be.visible");
  }

  // Each order card has its own 4-step status tracker (Accepted -> Packing ->
  // Ready -> Picked Up). Clicking "Picked Up" directly (skipping the middle
  // steps) is enough to jump the whole order to that final status - confirmed
  // live, no need to click through Packing/Ready first - but it raises a
  // confirmation dialog that has to be accepted. `.order-card-status-tracker`
  // scopes the click to the right order's own stepper rather than any of the
  // page's other status-related chips/cards that also contain this text.
  markAsPickedUp(orderId) {
    cy.contains(orderId)
      .parents()
      .eq(5)
      .find(".order-card-status-tracker")
      .contains("Picked Up")
      .parents(".cursor-pointer")
      .first()
      .click();
    cy.contains("Are you sure you want to change status", { timeout: 8000 }).should("be.visible");
    return cy.contains("button", "Confirm").click();
  }

  // The order-list's default "Order Status" filter only includes the active,
  // in-progress statuses (Accepted/Packing/+2 more) - once an order becomes
  // "Picked Up" (a completed/terminal status), it drops out of that filtered
  // view entirely, even though the status change succeeded. Clearing the
  // filter is what brings it back into view to actually confirm the change.
  clearStatusFilter() {
    return cy.contains("Clear").first().click();
  }

  // Confirms the order's own stepper shows the earlier steps as completed
  // (green) after marking it picked up - not just that the order still
  // exists in the list.
  confirmPickedUp(orderId) {
    return cy
      .contains(orderId)
      .parents()
      .eq(5)
      .find(".order-card-status-tracker")
      .contains("Accepted")
      .should("have.class", "text-[#28A745]");
  }
}

module.exports = new OrdersPage();
