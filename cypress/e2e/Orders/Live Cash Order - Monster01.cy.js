const productsPage = require("../../pages/ProductsPage");
const productFormPage = require("../../pages/ProductFormPage");
const storefrontPage = require("../../pages/StorefrontPage");
const productDetailPage = require("../../pages/ProductDetailPage");
const checkoutPage = require("../../pages/CheckoutPage");
const ordersPage = require("../../pages/OrdersPage");
const storeGuard = require("../../support/storeGuard");
const { parseMultipart } = require("../../support/multipart");
// Requiring this registers cy.getUniqueProductData AND gives the category helper.
const { RUN_ID, uniqueCategoryName } = require("../../support/productUniqueness");

// LIVE end-to-end on production (quickvee.com), store Monster01 (BIL1813474MA):
//   1) create a UNIQUE category + UNIQUE product (names checked store-wide first)
//   2) place ONE real CASH pickup order for it today (no card, no 3DS, no pause)
//   3) confirm via the real signal: saveOrder 2xx + result.order_id, and the
//      /orderSummeryPage?orderId=... redirect; capture the orderId + total
//   4) fulfil that order in admin: mark it Picked Up (Order_list_api/
//      changeStatus_api 2xx) and confirm the status
//   5) verify the order's values (product, total) render in the online orders list
//
// SAFETY: storeGuard (fixtures/targetStore.json = Monster01/BIL1813474MA)
// verifies we are inside Monster01 and 403s any catalog write for another
// merchant. One run = one category + one product + one order, then fulfil it.
describe("Live CRUD - Monster01 cash order + fulfilment (production)", { baseUrl: "https://quickvee.com", retries: 0, testIsolation: false, defaultCommandTimeout: 20000, pageLoadTimeout: 120000 }, () => {
  const made = { category: null, product: null, qty: null, orderId: null, total: null, pickedUp: false };

  beforeEach(() => {
    if (storeGuard.state.stopRun) throw new Error(storeGuard.state.stopRun);
    storeGuard.startWatching();
  });

  after(() => {
    cy.task("log", `RUN ${RUN_ID} SUMMARY -> category="${made.category}" product="${made.product}" qty=${made.qty} orderId=${made.orderId} total=${made.total} pickedUp=${made.pickedUp}`, { log: false });
  });

  it("Step 1-3: create unique category + product and place a CASH pickup order", () => {
    // --- Enter Monster01 on production (header + merchant_id verified) ---
    storeGuard.ensureTargetStore();

    // --- Open the add-product form first (loads tax_list -> sets the API base
    //     the store-scoped uniqueness checks need) ---
    productsPage.visit();
    cy.contains("button", "Add product", { timeout: 20000 }).should("be.visible");
    productsPage.clickAddProduct();
    productsPage.chooseSingleProductType();

    // --- Unique names, checked against Monster01 before use ---
    uniqueCategoryName(1).then((c) => (made.category = c));
    cy.getUniqueProductData(1).then((p) => (made.product = p.name));

    cy.then(() => {
      cy.task("log", `RUN ${RUN_ID}: creating category="${made.category}" product="${made.product}"`, { log: false });
      productFormPage.fillName(made.product);
      productFormPage.selectOrCreateCategory(made.category); // creates the unique category
      productFormPage.selectRandomBrand();
      productFormPage.selectRandomTag();
      productFormPage.fillSimplePricing("5.00", "9.99"); // cost, price
      productFormPage.fillAvailableToSell(46, 46); // available to sell = 46
      productFormPage.save(); // auto-handles the "Generate & save" UPC modal + waits add_product 2xx
      productFormPage.assertAddedSuccessfully();
      cy.task("log", `CREATED product "${made.product}" in category "${made.category}"`, { log: false });
    });

    // --- Online store: order the product, paid by CASH ---
    cy.visit("/merchants/dashboard");
    storefrontPage.visitViaOnlineStoreLink().then((merchantId) => {
      storefrontPage.dismissAgeVerification();
      storefrontPage.waitForProductSearchable(made.product, { timeoutMs: 300000, pollIntervalMs: 5000 });
      storefrontPage.searchProduct(made.product);
      storefrontPage.selectSearchResult(made.product);
      // Order exactly 1 unit: leave the default quantity (1); do NOT increase.
      productDetailPage.getQuantity().then((q) => {
        made.qty = String(q).trim();
        expect(made.qty, "default product quantity on the detail page is 1").to.equal("1");
      });
      productDetailPage.addToCart();

      checkoutPage.goToPaymentCart(merchantId);
      checkoutPage.clickCheckoutWithLogin();
      checkoutPage.loginIfNeeded(Cypress.env("liveCustomerEmail"), Cypress.env("liveCustomerPassword"));
      checkoutPage.proceedToCheckout(); // Review -> Details
      checkoutPage.confirmOnDetailsPage();
      checkoutPage.proceedToCheckout(); // Details -> Payment

      // Cash is the default payment method (paymentType 'newcash').
      cy.contains(/\bcash\b/i, { timeout: 15000 }).should("exist");
      checkoutPage.selectPickupDate();
      checkoutPage.selectPickupTime();

      // --- Place the order; confirm via the REAL success signal ---
      cy.intercept("POST", "**/Process_order_online/saveOrder").as("saveOrder");
      checkoutPage.placeOrder();
      cy.wait("@saveOrder", { timeout: 60000 }).then(({ request, response }) => {
        const body = typeof response.body === "string" ? Cypress._.attempt(JSON.parse, response.body) : response.body;
        expect(response.statusCode, "saveOrder HTTP status").to.be.within(200, 299);
        const orderId = body && body.result && body.result.order_id;
        const fields = parseMultipart(request.body, request.headers["content-type"]) || {};
        const pay = Object.fromEntries(Object.entries(fields).filter(([k]) => /pay|cash|card|tender|method|type/i.test(k)));
        cy.task("log", `saveOrder payment fields: ${JSON.stringify(pay)}`, { log: false });
        if (!orderId) throw new Error(`Order was NOT placed. saveOrder returned: ${JSON.stringify(body).slice(0, 500)}`);
        const r = body.result || {};
        const t = r.grand_total ?? r.total ?? r.amount ?? r.order_total ?? r.amt;
        if (t != null) made.total = String(t).replace(/[^0-9.]/g, "");
        cy.task("log", `saveOrder result.order_id=${orderId}; captured total=${made.total}; result total fields: ${JSON.stringify(Cypress._.pick(r, ["grand_total", "total", "amount", "order_total", "amt"]))}`, { log: false });
      });

      // Known behaviour: redirect to /orderSummeryPage?orderId=...
      cy.url({ timeout: 20000 }).should("include", "orderSummeryPage");
      checkoutPage.getOrderId().then((id) => {
        made.orderId = id;
        cy.task("log", `CAPTURED orderId=${id} from /orderSummeryPage`, { log: false });
      });
      // Best-effort: capture the order total shown on the summary page.
      cy.get("body").then(($b) => {
        const m = $b.text().match(/Grand\s*Total[^$]*\$\s*([0-9][0-9.,]*)/i) || $b.text().match(/\bTotal[^$]*\$\s*([0-9][0-9.,]*)/i);
        made.total = m ? m[1].replace(/,/g, "") : null;
        cy.log(`ORDER PLACED (cash): orderId=${made.orderId} total=${made.total} qty=${made.qty} product="${made.product}"`);
      });
    });
  });

  it("Step 4: fulfil the order in admin (mark Picked Up)", () => {
    expect(made.orderId, "orderId captured in Step 1-3").to.be.a("string").and.not.be.empty;
    // Re-enter the admin panel + Monster01 (the storefront login cleared it).
    storeGuard.ensureTargetStore();
    ordersPage.visit(); // /merchants/order-new (Orders Management)
    ordersPage.selectOnlineOrders();
    ordersPage.searchOrderId(made.orderId);
    ordersPage.confirmOrderVisible(made.orderId);

    cy.intercept("POST", "**/Order_list_api/changeStatus_api").as("changeStatus");
    ordersPage.markAsPickedUp(made.orderId);
    cy.wait("@changeStatus", { timeout: 30000 }).then(({ response }) => {
      const body = typeof response.body === "string" ? Cypress._.attempt(JSON.parse, response.body) : response.body;
      expect(response.statusCode, "changeStatus_api HTTP status").to.be.within(200, 299);
      expect(body && body.status, "changeStatus_api status flag").to.not.equal(false);
      made.pickedUp = true;
      cy.task("log", `changeStatus_api OK for orderId=${made.orderId} -> Picked Up`, { log: false });
    });
    // Picked Up is terminal; clear the status filter to see it, then confirm.
    ordersPage.clearStatusFilter();
    ordersPage.searchOrderId(made.orderId);
    ordersPage.confirmPickedUp(made.orderId);
    cy.log(`FULFILLED orderId=${made.orderId}: Picked Up`);
  });

  it("Step 5: verify the order's values (product, qty, total) render in the order detail", () => {
    // Works standalone too: pass --env verifyOrderId=<id> to re-check an
    // existing order without placing a new one.
    const orderId = made.orderId || Cypress.env("verifyOrderId");
    expect(orderId, "orderId (from Step 1-3 or --env verifyOrderId)").to.be.a("string").and.not.be.empty;
    const normMoney = (s) => String(s == null ? "" : s).replace(/[^0-9.]/g, "");

    storeGuard.ensureTargetStore();
    // The list row only shows the total + status; product name + line items live
    // in the order's data (order_product) and the detail modal - NOT the
    // collapsed row. So verify against the list API's order object (the data the
    // card/detail render from) and confirm the product renders in the detail.
    cy.intercept("POST", "**/orders-management-new-ui/order_list").as("orderList");
    ordersPage.visit();
    ordersPage.selectOnlineOrders();
    ordersPage.clearStatusFilter();
    ordersPage.searchOrderId(orderId);
    ordersPage.confirmOrderVisible(orderId);
    cy.wait("@orderList", { timeout: 30000 });

    cy.get("@orderList.all").then((calls) => {
      // The order_list response has order_data[] rows keyed by order_id, each
      // with total_amount and an items[] array ({ name, qty, ... }).
      let order = null;
      const walk = (node) => {
        if (order || !node || typeof node !== "object") return;
        if (Array.isArray(node)) return node.forEach(walk);
        if (node.order_id && String(node.order_id).toUpperCase() === String(orderId).toUpperCase() && Array.isArray(node.items)) {
          order = node;
          return;
        }
        Object.values(node).forEach(walk);
      };
      calls.forEach((c) => {
        const b = c.response && c.response.body;
        walk(typeof b === "string" ? Cypress._.attempt(JSON.parse, b) : b);
      });
      expect(order, `order ${orderId} present in order_list (order_data[].order_id)`).to.not.equal(null);

      const items = Array.isArray(order.items) ? order.items : [];
      const names = items.map((i) => String(i.name || "").trim()).filter(Boolean);
      const uniqueNames = [...new Set(names)];
      const totalQty = items.reduce((s, i) => s + (Number(i.qty) || 0), 0);
      const total = order.total_amount;
      cy.task("log", `order ${orderId}: products=${JSON.stringify(uniqueNames)} lines=${items.length} totalQty=${totalQty} total=${total} payment=${order.payment_method} status=${order.order_status}/m_status=${order.m_status}`, { log: false });

      // --- Genuine render checks (fail if truly missing) ---
      expect(names.length, `order ${orderId}: product line(s) render`).to.be.greaterThan(0);
      expect(totalQty, `order ${orderId}: a quantity renders`).to.be.greaterThan(0);
      if (made.qty) {
        cy.log(`REPORT qty: expected ${made.qty} | actual ${totalQty}`);
        expect(totalQty, `order ${orderId}: rendered total quantity == ordered quantity`).to.equal(Number(made.qty));
      }
      expect(normMoney(total), `order ${orderId}: a total renders`).to.not.equal("");

      // Bonus confirmations (from Step 2 cash + Step 4 fulfilment):
      cy.log(`REPORT payment_method=${order.payment_method} (expected Cash), m_status=${order.m_status} (4 = Picked Up)`);

      // --- Findings vs expected (only when known from this run) ---
      if (made.product) {
        const want = String(made.product).trim().toLowerCase();
        const hit = names.some((n) => n.toLowerCase().includes(want) || want.includes(n.toLowerCase()));
        cy.log(`REPORT product: expected "${made.product}" | actual ${JSON.stringify(uniqueNames)} | match=${hit}`);
        expect(hit, `expected product "${made.product}" among rendered ${JSON.stringify(uniqueNames)}`).to.equal(true);
      } else {
        cy.log(`REPORT product (actual, no expected): ${JSON.stringify(uniqueNames)}`);
      }
      if (made.total) {
        const ok = normMoney(total) === normMoney(made.total);
        cy.log(`REPORT total: expected ${made.total} | actual ${total} | match=${ok}`);
        expect(ok, `expected total ${made.total} == rendered total ${total}`).to.equal(true);
      } else {
        cy.log(`REPORT total (actual, no expected): ${total}`);
      }
      cy.wrap(uniqueNames[0]).as("firstProduct");
    });

    // --- UI render confirmation: open the detail; the product name should be
    //     rendered there. It's one of several line rows in a scrollable modal,
    //     so assert it EXISTS (in-viewport visibility is not required). ---
    cy.contains(orderId).parents().eq(5).find("button").contains(/View Details/i).click({ force: true });
    cy.get("@firstProduct").then((p) => {
      if (p) cy.contains(String(p), { timeout: 15000, matchCase: false }).should("exist");
    });
    cy.log(`Step 5 verified order ${orderId}`);
  });
});
