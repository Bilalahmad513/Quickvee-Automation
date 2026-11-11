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

// LIVE end-to-end on production (quickvee.com), store Monster01 (BIL1813474MA),
// but for a PRODUCT WITH VARIANTS (the 4th test; the single-product flow lives
// in "Live Cash Order - Monster01.cy.js" and is untouched):
//   1) create a unique category + a VARIANT product (attribute "Size", 2 values),
//      each variant priced 9.99, available-to-sell 46, UPC auto-generated
//   2) order ONE specific variant (qty 1) by Cash pickup
//   3) confirm via saveOrder 2xx + /orderSummeryPage redirect; capture orderId
//   4) fulfil in admin (mark Picked Up) and verify the ordered VARIANT, qty=1,
//      and total render in the order detail
//   5) end on the merchants dashboard
//
// SAFETY: storeGuard (fixtures/targetStore.json = Monster01/BIL1813474MA) checks
// the store and 403s any catalog write for another merchant. One run = one
// category + one variant product + one order of qty 1.
const VARIANT_VALUES = ["Small", "Large"]; // Size options; we order the first.

describe("Live CRUD - Monster01 CASH order (variants) + fulfilment (production)", { baseUrl: "https://quickvee.com", retries: 0, testIsolation: false, defaultCommandTimeout: 20000, pageLoadTimeout: 120000 }, () => {
  const made = { category: null, product: null, variants: null, variant: null, qty: null, orderId: null, total: null, pickedUp: false };

  beforeEach(() => {
    if (storeGuard.state.stopRun) throw new Error(storeGuard.state.stopRun);
    storeGuard.startWatching();
  });

  after(() => {
    cy.task("log", `RUN ${RUN_ID} SUMMARY (variants) -> category="${made.category}" product="${made.product}" variants=${JSON.stringify(made.variants)} orderedVariant="${made.variant}" qty=${made.qty} orderId=${made.orderId} total=${made.total} pickedUp=${made.pickedUp}`, { log: false });
  });

  it("Step 1-3: create a unique category + VARIANT product and place a CASH order for one variant", () => {
    // --- Enter Monster01 on production (header + merchant_id verified) ---
    storeGuard.ensureTargetStore();

    // --- Open the variant add-product form (loads tax_list -> API base for the
    //     store-scoped uniqueness checks) ---
    productsPage.visit();
    cy.contains("button", "Add product", { timeout: 20000 }).should("be.visible");
    productsPage.clickAddProduct();
    productsPage.chooseVariantProductType();

    // --- Unique names, checked against Monster01 first ---
    uniqueCategoryName(1).then((c) => (made.category = c));
    cy.getUniqueProductData(1).then((p) => (made.product = p.name));

    cy.then(() => {
      made.variants = VARIANT_VALUES.slice();
      made.variant = VARIANT_VALUES[0]; // order "Small"
      cy.task("log", `RUN ${RUN_ID}: creating VARIANT product "${made.product}" (Size: ${made.variants.join(", ")}) in "${made.category}"`, { log: false });
      productFormPage.fillName(made.product);
      productFormPage.selectOrCreateCategory(made.category);
      productFormPage.selectRandomBrand();
      productFormPage.selectRandomTag();
      productFormPage.selectAttribute("Size");
      made.variants.forEach((v) => productFormPage.addVariantValue(v));
      productFormPage.fillAllVariantPrices("5.00", "9.99"); // cost, price (per variant)
      productFormPage.fillAllVariantAvailableToSell(46, 46); // available to sell = 46 per variant
      productFormPage.save(); // auto-handles the "Generate & save" UPC modal + waits add_product 2xx
      productFormPage.assertAddedSuccessfully();
      cy.task("log", `CREATED variant product "${made.product}" (Size: ${made.variants.join(", ")})`, { log: false });
    });

    // --- Online store: order ONE specific variant, paid by CASH ---
    cy.visit("/merchants/dashboard");
    storefrontPage.visitViaOnlineStoreLink().then((merchantId) => {
      storefrontPage.dismissAgeVerification();
      storefrontPage.waitForProductSearchable(made.product, { timeoutMs: 300000, pollIntervalMs: 5000 });
      storefrontPage.searchProduct(made.product);
      storefrontPage.selectSearchResult(made.product);

      // Select the recorded variant (option button) and confirm it's reflected.
      cy.contains('button[class*="flavorButton"]', new RegExp(`^\\s*${made.variant}\\s*$`), { timeout: 15000 }).click();
      cy.contains("9.99", { timeout: 10000 }).should("exist"); // variant price reflected

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
        cy.task("log", `saveOrder result.order_id=${orderId}; captured total=${made.total}`, { log: false });
      });

      cy.url({ timeout: 20000 }).should("include", "orderSummeryPage");
      checkoutPage.getOrderId().then((id) => {
        made.orderId = id;
        cy.task("log", `CAPTURED orderId=${id} from /orderSummeryPage`, { log: false });
      });
      cy.get("body").then(($b) => {
        const m = $b.text().match(/Grand\s*Total[^$]*\$\s*([0-9][0-9.,]*)/i) || $b.text().match(/\bTotal[^$]*\$\s*([0-9][0-9.,]*)/i);
        if (!made.total && m) made.total = m[1].replace(/,/g, "");
        cy.log(`ORDER PLACED (cash, variant "${made.variant}"): orderId=${made.orderId} total=${made.total} qty=${made.qty}`);
      });
    });
  });

  it("Step 4: fulfil the order in admin (mark Picked Up)", () => {
    expect(made.orderId, "orderId captured in Step 1-3").to.be.a("string").and.not.be.empty;
    storeGuard.ensureTargetStore();
    ordersPage.visit();
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
    ordersPage.clearStatusFilter();
    ordersPage.searchOrderId(made.orderId);
    ordersPage.confirmPickedUp(made.orderId);
    cy.log(`FULFILLED orderId=${made.orderId}: Picked Up`);
  });

  it("Step 5: verify the ordered VARIANT, qty=1 and total render in the order detail", () => {
    const orderId = made.orderId || Cypress.env("verifyOrderId");
    expect(orderId, "orderId (from Step 1-3 or --env verifyOrderId)").to.be.a("string").and.not.be.empty;
    const normMoney = (s) => String(s == null ? "" : s).replace(/[^0-9.]/g, "");

    storeGuard.ensureTargetStore();
    cy.intercept("POST", "**/orders-management-new-ui/order_list").as("orderList");
    ordersPage.visit();
    ordersPage.selectOnlineOrders();
    ordersPage.clearStatusFilter();
    ordersPage.searchOrderId(orderId);
    ordersPage.confirmOrderVisible(orderId);
    cy.wait("@orderList", { timeout: 30000 });

    cy.get("@orderList.all").then((calls) => {
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
      // The ordered line: its name should carry the product; variant is either in
      // the name ("... - Small") or a non-zero variant_id.
      const line = items.find((i) => String(i.name || "").toLowerCase().includes(String(made.product || "").toLowerCase())) || items[0] || {};
      const lineName = String(line.name || "");
      const variantId = String(line.variant_id ?? "0");
      cy.task("log", `order ${orderId}: products=${JSON.stringify(uniqueNames)} lines=${items.length} totalQty=${totalQty} total=${total} line.name="${lineName}" variant_id=${variantId} payment=${order.payment_method} m_status=${order.m_status}`, { log: false });

      // --- Genuine render checks ---
      expect(names.length, `order ${orderId}: product line(s) render`).to.be.greaterThan(0);
      expect(totalQty, `order ${orderId}: a quantity renders`).to.be.greaterThan(0);
      if (made.qty) {
        cy.log(`REPORT qty: expected ${made.qty} | actual ${totalQty}`);
        expect(totalQty, `order ${orderId}: rendered qty == ordered qty`).to.equal(Number(made.qty));
      }
      expect(normMoney(total), `order ${orderId}: a total renders`).to.not.equal("");

      // --- Product + VARIANT reflected ---
      if (made.product) {
        const want = String(made.product).trim().toLowerCase();
        const hit = names.some((n) => n.toLowerCase().includes(want) || want.includes(n.toLowerCase()));
        cy.log(`REPORT product: expected "${made.product}" | actual ${JSON.stringify(uniqueNames)} | match=${hit}`);
        expect(hit, `expected product "${made.product}" among rendered ${JSON.stringify(uniqueNames)}`).to.equal(true);
      }
      if (made.variant) {
        const nameHasVariant = lineName.toLowerCase().includes(String(made.variant).toLowerCase());
        const variantReflected = nameHasVariant || (variantId && variantId !== "0");
        cy.log(`REPORT variant: ordered "${made.variant}" | item.name="${lineName}" | variant_id=${variantId} | reflected=${variantReflected} (byName=${nameHasVariant})`);
        expect(variantReflected, `ordered variant "${made.variant}" reflected in the order item (name or non-zero variant_id)`).to.equal(true);
      }
      if (made.total) {
        const ok = normMoney(total) === normMoney(made.total);
        cy.log(`REPORT total: expected ${made.total} | actual ${total} | match=${ok}`);
        expect(ok, `expected total ${made.total} == rendered total ${total}`).to.equal(true);
      }
      cy.wrap(uniqueNames[0]).as("firstProduct");
    });

    // UI confirmation: open the detail; the product renders there.
    cy.contains(orderId).parents().eq(5).find("button").contains(/View Details/i).click({ force: true });
    cy.get("@firstProduct").then((p) => {
      if (p) cy.contains(String(p), { timeout: 15000, matchCase: false }).should("exist");
    });
    cy.log(`Step 5 verified variant order ${orderId}`);
  });

  it("Step 6: ends on the merchants dashboard", () => {
    storeGuard.ensureTargetStore();
    cy.visit("/merchants/dashboard");
    cy.url({ timeout: 30000 }).should("include", "/merchants/dashboard");
    cy.get(".qv-app-header__store-name", { timeout: 30000 }).should("be.visible");
    cy.log("Ended on the merchants dashboard");
  });
});
