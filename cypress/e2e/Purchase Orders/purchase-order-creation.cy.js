// WRITE (CUD) SUITE - creates purchase orders and receives them, which adds
// stock. It is deliberately NOT part of all-tests.cy.js (the read-only /
// production run) and refuses to run anywhere but test.quickvee.us.
//
// Creates PO_COUNT purchase orders in ONE store
// (cypress/fixtures/purchaseOrderConfig.json - Monster01, BIL1813474MA),
// each with a random existing vendor, stock due today, a unique order /
// invoice number, and one product (different for every PO) at quantity 10 x
// 10.00 - then receives all units and checks the product's stock went up by
// the quantity. Every PO is written to an HTML report in
// cypress/e2e/reports/ (purchase-order-report-<stamp>.html and
// purchase-order-report-latest.html), even when some fail.
// The app's real flow (routes, texts, requests) is written up in
// PO_FLOW_NOTES.md next to this file - the steps below follow it.
// Override the count: CYPRESS_poCount=1 (or --env poCount=1).
const purchaseOrderPage = require("../../pages/PurchaseOrderPage");
const { CONFIG, state, assertTestEnvironment, startWatching, waitForCall, assertCallsForTarget, ensureTargetStore } = require("../../support/poStoreGuard");
const { buildPurchaseOrderHtml, summaryOf } = require("../../reports/purchaseOrderReportHtml");

const PO_COUNT = Number(Cypress.env("poCount") || CONFIG.poCount);
const QUANTITY = Number(CONFIG.quantity);
const UNIT_PRICE = Number(CONFIG.unitPrice).toFixed(2);
const RUN_ID = Date.now().toString();
const REPORT_DIR = "cypress/e2e/reports";
// API answers: reads within 30s; the create / receive saves get 60s.
const WRITE_TIMEOUT = 60000;

// Module scope: survives across `it` blocks, read by the `after` hook.
const pos = [];
const usedProductIds = new Set();
let current = null;

const pad2 = (n) => String(n).padStart(2, "0");
const stampOf = (now) =>
  `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}_` +
  [now.getHours(), now.getMinutes(), now.getSeconds()].map(pad2).join("-");

// Order number: 20 characters max; the app's own generator
// (generate_po_number) answers HTTP 500 on test, so the suite types one.
const orderNumberFor = (n) => `AP${RUN_ID.slice(-8)}${pad2(n)}`;
const invoiceFor = (n) => `INV-${RUN_ID}-${n}`;
const noteFor = (n) => `Automation PO ${n} - run ${RUN_ID}`;

const isOk = (value) => value === true || value === 1 || value === "1" || value === "true";
const is2xx = (code) => code >= 200 && code < 300;
const LIST_PATH = /\/merchants\/purchase-order\/?$/;
const detailPath = (po) => `/merchants/purchase-order/${encodeURIComponent(po.poId)}`;

function logLine(message) {
  cy.log(message);
  return cy.task("log", message, { log: false });
}

// Marks the step a PO is on; a failure's message and screenshot name it.
function stage(po, name) {
  return cy.then(() => {
    po.stage = name;
    Cypress.log({ name: "stage", message: `PO ${po.index}: ${name}` });
  });
}

// Products the PO can use: simple (no variants), not lottery, with an id,
// a name and a UPC (to search by), not used earlier in this run. Products
// that track stock are preferred so the stock check means something.
function pickProduct(products) {
  const valid = (products || []).filter(
    (p) =>
      p &&
      p.product_id &&
      String(p.product_title || "").trim() &&
      String(p.upc || "").trim() &&
      String(p.is_variant) === "0" &&
      String(p.is_lottery) !== "1" &&
      !usedProductIds.has(String(p.product_id))
  );
  const upcCount = Cypress._.countBy(valid, (p) => String(p.upc).trim());
  const unique = valid.filter((p) => upcCount[String(p.upc).trim()] === 1);
  const tracked = unique.filter((p) => String(p.track_quantity) === "1");
  return Cypress._.sample(tracked.length ? tracked : unique);
}

// The product's quantity from the picker's search for its UPC (the app's
// own product_list_v2 call). Yields a number, or null when not readable.
function stockFromSearch(product) {
  const upc = String(product.upc).trim();
  const from = state.calls.length;
  purchaseOrderPage.searchProduct(upc);
  return waitForCall("new_purchase_orders_product_list_v2", (f) => f.search_by_product === upc, { from }).then((call) => {
    expect(call.fields.merchant_id, "product search merchant_id").to.equal(CONFIG.merchantId);
    const row = ((call.body && call.body.data) || []).find((p) => String(p.product_id) === String(product.product_id));
    const quantity = row ? Number(row.quantity) : NaN;
    return Number.isFinite(quantity) ? quantity : null;
  });
}

// The last write request `name` of this test, once answered (or blocked).
function waitForWrite(name, what) {
  return cy
    .document({ log: false, timeout: WRITE_TIMEOUT })
    .should((doc) => {
      const write = Cypress._.findLast(state.writes, (w) => w.name === name);
      const messages = purchaseOrderPage.formMessages(doc);
      expect(Boolean(state.violation || (write && write.response)), `${what} answered${messages.length ? ` - page shows: ${messages.join(" | ")}` : ""}`).to.equal(true);
    })
    .then(() => {
      if (state.violation) throw new Error(state.stopRun);
      return Cypress._.findLast(state.writes, (w) => w.name === name).response;
    });
}

const isDetailsFor = (po) => (c) => c.name === "new_purchase_order_details" && String(c.fields.po_id) === String(po.poId);

// Waits until the PO's detail page has loaded the PO (its own
// new_purchase_order_details answer for po.poId, made after calls[from]),
// and yields that answer's po_data. When the app went to the list instead
// (it can, right after a receive), the PO is opened by its URL - at most 3
// times in all.
function loadPo(po, from, opens = 0) {
  return cy
    .document({ log: false, timeout: 30000 })
    .should((doc) => {
      const answered = state.calls.slice(from).some(isDetailsFor(po));
      expect(answered || LIST_PATH.test(doc.location.pathname), `details of PO ${po.poNumber} (id ${po.poId}) loaded, or the app went to the list`).to.equal(true);
    })
    .then((doc) => {
      const call = Cypress._.findLast(state.calls.slice(from), isDetailsFor(po));
      const data = call && isOk(call.body && call.body.status) && call.body.po_data;
      if (data && !LIST_PATH.test(doc.location.pathname)) {
        expect(call.fields.merchant_id, "PO details request merchant_id").to.equal(CONFIG.merchantId);
        return data;
      }
      if (opens >= 3) {
        throw new Error(`PO ${po.poNumber} (id ${po.poId}) did not load on its detail page after ${opens} visits (now on ${doc.location.pathname}).`);
      }
      logLine(`PO ${po.index}: on ${doc.location.pathname} without the PO's details - opening ${detailPath(po)}`);
      const next = state.calls.length;
      cy.visit(detailPath(po));
      return loadPo(po, next, opens + 1);
    });
}

// No retries: a retry after a create that went through would make an
// extra PO. defaultCommandTimeout is raised for this suite only (the repo's
// default is Cypress's 4s, too short for this environment's PO pages).
describe("Purchase Order Creation", { baseUrl: CONFIG.baseUrl, retries: 0, defaultCommandTimeout: 15000 }, () => {
  before(() => {
    assertTestEnvironment();
    logLine(`Purchase Order Creation: ${PO_COUNT} PO(s) in ${CONFIG.storeName} (${CONFIG.merchantId}) on ${Cypress.config("baseUrl")}, run ${RUN_ID}`);
  });

  // A failing beforeEach makes Mocha skip every remaining test, which is
  // exactly what an environment / store-guard failure must do.
  beforeEach(function () {
    // This PO's report row exists before the store guard runs, so a guard
    // failure is recorded against the right PO.
    const n = Number((this.currentTest.title.match(/purchase order (\d+) of/) || [])[1]);
    current = {
      index: n,
      stage: "store-guard",
      invoiceNumber: invoiceFor(n),
      note: noteFor(n),
      quantity: QUANTITY,
      unitPrice: UNIT_PRICE,
      createStatus: "Not created",
      receiveStatus: "Not received",
    };
    pos.push(current);
    if (state.stopRun) throw new Error(state.stopRun);
    assertTestEnvironment();
    startWatching();
    ensureTargetStore();
  });

  afterEach(function () {
    if (this.currentTest.state !== "failed") return;
    const message = ((this.currentTest.err && this.currentTest.err.message) || "unknown error").split("\n")[0].slice(0, 400);
    const po = current || {};
    po.failedStage = po.stage || "store-guard";
    po.error = `Stage ${po.failedStage}: ${message}`;
    po.screenshot = `po-${pad2(po.index || 0)}-${po.failedStage}-failed-${RUN_ID}`;
    cy.task("log", `FAILED: ${this.currentTest.title}\n  ${po.error}`);
    cy.screenshot(po.screenshot, { capture: "fullPage" });
  });

  after(() => {
    // A PO whose test never started (run stopped) still gets a row.
    for (let n = 1; n <= PO_COUNT; n++) {
      if (pos.some((p) => p.index === n)) continue;
      pos.push({ index: n, createStatus: "Not attempted", receiveStatus: "—", failedStage: "store-guard", error: state.stopRun || "Run stopped before this PO" });
    }
    pos.sort((a, b) => a.index - b.index);
    const seen = Object.entries(state.carriesStoreId);
    const storeIdNote = seen.length
      ? seen.map(([name, keys]) => `${name}: ${keys.length ? keys.join(", ") : "NO store identifier (relied on UI + session checks)"}`).join(" | ")
      : "no write request was sent";
    const now = new Date();
    const html = buildPurchaseOrderHtml({
      pos,
      info: {
        generatedAt: now.toLocaleString(),
        baseUrl: Cypress.config("baseUrl"),
        storeName: CONFIG.storeName,
        merchantId: CONFIG.merchantId,
        runId: RUN_ID,
        poCount: PO_COUNT,
        quantity: QUANTITY,
        unitPrice: UNIT_PRICE,
        storeIdNote,
      },
    });
    const file = `${REPORT_DIR}/purchase-order-report-${stampOf(now)}.html`;
    const latest = `${REPORT_DIR}/purchase-order-report-latest.html`;
    cy.writeFile(file, html);
    cy.writeFile(latest, html);
    const s = summaryOf(pos);
    const root = Cypress.config("projectRoot");
    logLine(
      `Purchase orders: ${s.attempted} attempted, ${s.created} created, ${s.received} received, ${s.failed} failed\n` +
        `Write requests' store fields: ${storeIdNote}\n` +
        `HTML report: ${root}/${file}\nLatest copy: ${root}/${latest}`
    );
  });

  for (let n = 1; n <= PO_COUNT; n++) {
    it(`creates and receives purchase order ${n} of ${PO_COUNT} in ${CONFIG.storeName} (${CONFIG.merchantId})`, () => {
      const po = current; // made by beforeEach, which has verified the store
      let product;

      // --- Open the form and check it is for the target store ---
      stage(po, "open-form");
      const formFrom = state.calls.length;
      purchaseOrderPage.openAddForm();
      purchaseOrderPage.locationText().then((location) => {
        expect(location.toLowerCase(), "Location picker").to.match(new RegExp(`^${CONFIG.storeName.toLowerCase()}\\b`));
      });
      cy.get(".qv-app-header__store-name").invoke("text").then((name) => expect(name.trim().toLowerCase(), "header store").to.equal(CONFIG.storeName.toLowerCase()));

      // --- Supplier: a random existing vendor, never "No Vendor" ---
      stage(po, "supplier");
      waitForCall("new_purchase_orders_vendor_list", (f) => !f.search_by_vendor, { from: formFrom }).then((call) => {
        assertCallsForTarget(["new_purchase_orders_vendor_list"]);
        const vendors = ((call.body && call.body.data) || []).filter((v) => {
          const name = String(v.vendor_name || "").trim();
          return v.id && name && name.toLowerCase() !== "no vendor";
        });
        if (!vendors.length) {
          state.stopRun = `${CONFIG.storeName} has no vendors - add one before running this suite. Run stopped.`;
          throw new Error(state.stopRun);
        }
        po.supplier = String(Cypress._.sample(vendors).vendor_name).trim();
        purchaseOrderPage.selectSupplier(po.supplier);
      });

      // --- Stock due today ---
      stage(po, "stock-due");
      purchaseOrderPage.selectStockDueToday().then((value) => (po.stockDue = value));

      // --- Order number, invoice, note ---
      stage(po, "invoice");
      // The app tries to generate an order number on load - wait for that
      // answer so it can't overwrite the one typed here.
      waitForCall("generate_po_number", () => true, { from: formFrom });
      purchaseOrderPage.fillOrderNumber(orderNumberFor(n)).then((value) => (po.poNumber = value));
      purchaseOrderPage.fillSupplierInvoice(po.invoiceNumber);
      stage(po, "note");
      purchaseOrderPage.fillNote(po.note);

      // --- Product: random, from the picker's own product_list_v2 answer ---
      stage(po, "product");
      const pickerFrom = state.calls.length;
      purchaseOrderPage.openProductPicker();
      waitForCall("new_purchase_orders_product_list_v2", (f) => !f.search_by_product, { from: pickerFrom }).then((call) => {
        assertCallsForTarget(["new_purchase_orders_product_list_v2"]);
        product = pickProduct(call.body && call.body.data);
        if (!product) throw new Error("No usable product (simple, active, with a name and a unique UPC, not used yet) in the picker's list.");
        usedProductIds.add(String(product.product_id));
        po.productName = String(product.product_title).trim();
        po.upc = String(product.upc).trim();
        po.productId = String(product.product_id);
        logLine(`PO ${n}: vendor "${po.supplier}", product "${po.productName}" (id ${po.productId}, UPC ${po.upc}, track_quantity ${product.track_quantity})`);

        stockFromSearch(product).then((qty) => (po.stockBefore = qty));
        purchaseOrderPage.addProductFromPicker(po.productName, po.upc);
      });
      cy.get('[role="dialog"]:has(input[placeholder^="Search product"])').should("not.exist");
      purchaseOrderPage.lineVariantKey().then((key) => expect(String(key), "PO line product").to.match(new RegExp(`^${po.productId}-`)));
      purchaseOrderPage.lineCurrentInventory().then((qty) => {
        po.stockBeforeUi = qty;
        if (po.stockBefore === null || po.stockBefore === undefined) po.stockBefore = qty;
      });

      // --- Line: quantity 10 x 10.00 = 100.00 ---
      stage(po, "qty-price");
      purchaseOrderPage.setLine(QUANTITY, UNIT_PRICE);
      purchaseOrderPage.lineTotalCost().then((total) => {
        po.totalCost = total;
        expect(total, "line Total Cost").to.equal(QUANTITY * Number(UNIT_PRICE));
      });

      // --- Create ---
      stage(po, "create-api");
      const createFrom = state.calls.length;
      cy.document({ log: false }).then((doc) => {
        purchaseOrderPage.createButton().should(($button) => {
          const messages = purchaseOrderPage.formMessages(doc);
          expect($button.prop("disabled"), `"Create PO" enabled${messages.length ? ` - page shows: ${messages.join(" | ")}` : ""}`).to.equal(false);
        });
      });
      purchaseOrderPage.createButton().click();
      waitForWrite("add_new_purchase_order", "create PO request").then((response) => {
        const body = response.body || {};
        const code = response.statusCode;
        po.createStatus = is2xx(code) && isOk(body.status) ? "Created" : `Failed (HTTP ${code})`;
        logLine(`PO ${n}: create answered HTTP ${code} - ${JSON.stringify(body).slice(0, 300)}`);
        expect(code, `create PO HTTP status (${body.message})`).to.be.within(200, 299);
        expect(isOk(body.status), `create PO status (${body.message})`).to.equal(true);
        expect(String(body.po_id || ""), "po_id in the create answer").to.match(/^\d+$/);
        po.poId = String(body.po_id);
        if (body.po_number) po.poNumber = String(body.po_number);
      });

      // --- After create the app opens /merchants/purchase-order/<po_id> ---
      stage(po, "post-create-navigation");
      cy.location("pathname", { timeout: 30000 })
        .should((path) => expect(path, "left the add form").not.to.match(/\/purchase-order\/add$/))
        .then((path) => {
          po.afterCreateUrl = path;
          logLine(`PO ${n}: after create the app is on ${path}`);
          if (path !== detailPath(po) && !LIST_PATH.test(path)) {
            throw new Error(`expected route ${detailPath(po)} (or the list) but the app went to ${path}`);
          }
        });
      cy.then(() => loadPo(po, createFrom)).then((data) => {
        expect(String(data.po_number), "PO number on the new PO").to.equal(po.poNumber);
        expect(String(data.merchant_id), "PO merchant_id").to.equal(CONFIG.merchantId);
        expect(String(data.po_received_status), "new PO po_received_status (0 = active)").to.equal("0");
      });
      cy.document({ log: false }).should((doc) => {
        const shown = purchaseOrderPage.statusOnPage(doc, po.poNumber);
        expect(shown.page, `detail page of ${po.poNumber}`).to.equal("detail");
        expect(shown.status, "status of the new PO").to.match(/^Active$/i);
      });

      // --- Receive all units ---
      stage(po, "receive");
      purchaseOrderPage.openReceiveDialog();
      purchaseOrderPage.receiveAll(QUANTITY);
      waitForWrite("receive_new_purchase_order", "receive PO request").then((response) => {
        const body = response.body || {};
        const code = response.statusCode;
        po.receiveStatus = is2xx(code) && isOk(body.status) ? "Receive sent" : `Failed (HTTP ${code})`;
        logLine(`PO ${n}: receive answered HTTP ${code} - ${JSON.stringify(body).slice(0, 300)}`);
        expect(code, `receive PO HTTP status (${body.message})`).to.be.within(200, 299);
        expect(isOk(body.status), `receive PO status (${body.message})`).to.equal(true);
      });
      cy.get('[aria-label="Receive units"]', { timeout: 30000 }).should("not.exist");

      // --- Status: the PO's own details answer, then the page ---
      // po_received_status "0" active, "2" fully received.
      stage(po, "status-check");
      cy.location("pathname").then((path) => {
        po.afterReceiveUrl = path;
        logLine(`PO ${n}: after receive the app is on ${path}`);
        const from = state.calls.length;
        cy.visit(detailPath(po));
        return loadPo(po, from, 1);
      }).then((data) => {
        logLine(
          `PO ${n}: details after receive - po_received_status ${data.po_received_status}, ` +
            `received ${data.total_received_qty} / ${data.total_required_qty}, pending ${data.total_pending_qty}`
        );
        expect(Number(data.total_received_qty), "units received").to.equal(QUANTITY);
        expect(Number(data.total_pending_qty), "units still pending").to.equal(0);
        expect(String(data.po_received_status), "po_received_status (2 = received)").to.equal("2");
      });
      // Detail page header, or the PO's list row if the app went back there.
      cy.document({ log: false, timeout: 30000 }).should((doc) => {
        const shown = purchaseOrderPage.statusOnPage(doc, po.poNumber);
        expect(shown.page, `${po.poNumber} on its detail page or the list`).to.be.oneOf(["detail", "list"]);
        expect(shown.status, `status of ${po.poNumber} (${shown.page} page)`).to.match(/^Received$/i);
        expect(shown.receiveButton, "Receive button gone").to.equal(false);
      });
      cy.then(() => (po.receiveStatus = "Received"));

      // --- Stock after: the picker's search for the same UPC ---
      stage(po, "stock-check");
      purchaseOrderPage.openAddForm();
      purchaseOrderPage.openProductPicker();
      cy.then(() => stockFromSearch(product)).then((after) => {
        po.stockAfter = after;
        if (after === null || po.stockBefore === null || po.stockBefore === undefined) {
          po.stockCheck = "not verified (stock not readable)";
          logLine(`PO ${n}: stock not readable (before ${po.stockBefore}, after ${after}) - not verified`);
          return;
        }
        const diff = after - po.stockBefore;
        po.stockCheck = diff === QUANTITY ? `+${QUANTITY} ✔` : `expected +${QUANTITY}, got ${diff >= 0 ? "+" : ""}${diff}`;
        logLine(`PO ${n}: stock ${po.stockBefore} -> ${after} (${po.stockCheck})`);
        expect(after, `stock of "${po.productName}" after receiving ${QUANTITY}`).to.equal(po.stockBefore + QUANTITY);
      });
      purchaseOrderPage.closeProductPicker();
      stage(po, "done");
    });
  }
});
