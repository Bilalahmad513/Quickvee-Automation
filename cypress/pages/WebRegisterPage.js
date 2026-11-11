const { parseMultipart, multipartField } = require("../support/multipart");

// Drives the full-screen web register (/merchants/web-register) to create an
// IN-STORE cash sale (is_online = 0) - the Create half of the Payment Report
// CRUD. Confirmed against the real UI (quickvee-admin-panel WebRegister):
//   - boot screen "Preparing the register" until the catalog syncs, then the
//     search box input[aria-label="Search products by name, UPC, or code"];
//   - product tiles .qv-prods button (.qv-tile-name / .qv-tile-price);
//   - the Pay button .qv-pay;
//   - PaymentMethodModal (.qv-dlg-card): tender tiles are <button>s labelled
//     "Cash ($x.xx)", "Credit (...)"; a full cash tender makes the balance
//     covered, then a "Complete order" button saves via Process_order/
//     saveOrderPos -> { status, order_id, id }.
// SAFETY: every saveOrderPos is inspected; one for another merchant_id is
// answered locally with 403 and never reaches the server, and the run stops.
const SAVE_URL = "**/Process_order/saveOrderPos";

const parseBody = (b) => (typeof b === "string" ? Cypress._.attempt(JSON.parse, b) : b);

class WebRegisterPage {
  // Records every saveOrderPos (and guards the merchant). `saves` collects
  // { merchantId, status, orderId, body }. Register before visit().
  recordSave(saves, merchantId) {
    cy.intercept("POST", SAVE_URL, (req) => {
      const mid = multipartField(req.body, "merchant_id") ?? (req.body && req.body.merchant_id);
      if (merchantId && mid && String(mid) !== String(merchantId)) {
        req.reply({ statusCode: 403, body: { status: false, message: `Cypress register guard: saveOrderPos was for "${mid}", not ${merchantId}` } });
        saves.push({ merchantId: mid, status: 403, blocked: true });
        throw new Error(`REGISTER GUARD: blocked an in-store save for merchant "${mid}", expected ${merchantId}.`);
      }
      req.continue((res) => {
        const body = parseBody(res.body) || {};
        saves.push({ merchantId: mid, status: res.statusCode, orderId: body.order_id || body.id, body });
      });
    }).as("saveOrderPos");
  }

  visit(registerPath) {
    cy.visit(registerPath);
    return this.waitReady();
  }

  // The catalog sync can take a while; wait for the search box to appear.
  waitReady() {
    return cy.get('input[aria-label="Search products by name, UPC, or code"]', { timeout: 180000 }).should("be.visible");
  }

  // Searches `term`, then adds the first in-stock tile to the cart. Handles a
  // variant pop-up (first variant) if one opens. Yields the tile's label.
  addFirstProduct(term) {
    this.waitReady().clear().type(term);
    return cy
      .get(".qv-prods", { timeout: 30000 })
      .find("button")
      .filter((_, el) => !el.querySelector(".qv-oos"))
      .then(($tiles) => {
        expect($tiles.length, `in-stock product tiles for "${term}"`).to.be.greaterThan(0);
        const $first = Cypress.$($tiles[0]);
        const name = $first.find(".qv-tile-name").text().trim();
        cy.wrap($first).click();
        // A variant product opens VariantModal; pick the first variant.
        cy.get("body").then(($b) => {
          if ($b.find(".qv-dlg-card").length && /variant/i.test($b.find(".qv-dlg-card").text())) {
            cy.get(".qv-dlg-card button").not(':contains("✕")').first().click();
          }
        });
        return cy.wrap(name, { log: false });
      });
  }

  openPayment() {
    // There can be more than one .qv-pay in the DOM (e.g. a responsive
    // duplicate); click the visible one.
    return cy.get(".qv-pay", { timeout: 15000 }).filter(":visible").first().should("not.be.disabled").click();
  }

  // Full cash tender, then Complete order; waits for the saved order id.
  payCashAndComplete() {
    const dump = (tag) => cy.get(".qv-dlg-card").then(($c) => cy.task("log", `[register modal ${tag}] ${JSON.stringify(Cypress.$($c).find("button").toArray().map((b) => (b.innerText || "").trim()).filter(Boolean))}`, { log: false }));
    cy.get(".qv-dlg-card", { timeout: 15000 }).should("be.visible");
    dump("open");
    // Click the Cash tile only if it's present (a $0 balance may be covered
    // already, showing just "Complete order").
    cy.get(".qv-dlg-card").then(($c) => {
      const cash = Cypress.$($c).find("button").filter((_, b) => /^\s*Cash\s*\(/.test((b.innerText || "").trim()));
      if (cash.length) cy.wrap(cash.first()).click();
    });
    dump("after-cash");
    cy.contains(".qv-dlg-card button", /Complete order|^\s*Complete\s*$|^\s*Done\s*$|^\s*Finish\s*$|Charge/i, { timeout: 15000 }).should("not.be.disabled").click();
    return cy.wait("@saveOrderPos", { timeout: 60000 }).then(({ response }) => {
      const body = parseBody(response && response.body) || {};
      expect(response && response.statusCode, `saveOrderPos status (${JSON.stringify(body.message || "")})`).to.equal(200);
      expect(body.status, "saveOrderPos status flag").to.not.equal(false);
      return cy.wrap({ orderId: body.order_id || body.id, body }, { log: false });
    });
  }

  // Close the receipt / confirmation so the register is ready for the next sale.
  dismissReceipt() {
    return cy.get("body").then(($b) => {
      const close = $b.find('.qv-dlg-card button:contains("New sale"), .qv-dlg-card button:contains("Done"), .qv-dlg-card button:contains("✕")');
      if (close.length) cy.wrap(close.last()).click({ force: true });
    });
  }
}

module.exports = new WebRegisterPage();
