// TEST CASE 01 - WRITE (CUD) test, test.quickvee.us only, store Monster01.
//
// Steps: create a product -> create a Purchase Order for it -> delete the
// product -> open the PO Products Report.
// Expected result: the deleted product's entry against that PO shows the
// status "Deleted".
//
// Each step is its own test, run in order; a step whose earlier step failed
// fails straight away instead of acting on missing data.
// Safety: runs only on test.quickvee.us, checks the store (header +
// merchant_id of the page's own requests) before each step, and blocks
// before they reach the server: any product create / delete or PO write for
// another merchant, and any product delete for a product this test did not
// create.
// Report: cypress/e2e/reports/Test Case 01.html
const productsPage = require("../../pages/ProductsPage");
const productFormPage = require("../../pages/ProductFormPage");
const purchaseOrderPage = require("../../pages/PurchaseOrderPage");
const poProductsReportPage = require("../../pages/PoProductsReportPage");
const { presetDates } = require("../../pages/PoProductsReportPage");
const { CONFIG, state, assertTestEnvironment, startWatching, waitForCall, assertCallsForTarget, ensureTargetStore } = require("../../support/poStoreGuard");
const { parseMultipart } = require("../../support/multipart");
const { randomProductName } = require("../../support/testData");
const { buildUpc } = require("../../support/upc");
const { injectLogStyles } = require("../../reports/reconciliationReport");
const { buildPoProductsHtml, formatCheckLine, resultText } = require("../../reports/poProductsReportHtml");

const RUN_ID = Date.now().toString();
const REPORT_FILE = "cypress/e2e/reports/Test Case 01.html";
const QUANTITY = 10;
const UNIT_PRICE = "10.00";
const EXPECTED_STATUS = "Deleted";
const pad2 = (n) => String(n).padStart(2, "0");

// Shared by the steps (module scope survives across `it` blocks).
const tc = {
  product: { name: randomProductName(), upc: buildUpc(RUN_ID, 1), cost: "6.00", price: "15.00", id: null },
  po: { number: `TC01${RUN_ID.slice(-8)}`, invoice: `INV-TC01-${RUN_ID}`, note: `Test Case 01 - run ${RUN_ID}`, id: null, supplier: null },
  done: {}, // step name -> true once it passed
  checks: [],
};

const isOk = (v) => v === true || v === 1 || v === "1" || v === "true";
const parseBody = (body) => (typeof body === "string" ? Cypress._.attempt(JSON.parse, body) : body);
const field = (req, name) => parseMultipart(req.body, req.headers["content-type"])[name];

function record(section, field_, values) {
  const keys = values.map((v) => String(v.value));
  const match = values.every((v) => v.value !== null && v.value !== undefined) && keys.every((k) => k === keys[0]);
  const check = { store: `${CONFIG.storeName} (${CONFIG.merchantId})`, section, field: field_, match, values: values.map((v, i) => ({ ...v, differs: !match && i > 0 })) };
  Cypress.log({ name: match ? "match" : "mismatch", displayName: resultText(check), message: `**${section} · ${field_}** → ` + values.map((v) => `${v.label}: **${v.value}**`).join(" | ") });
  cy.task("log", formatCheckLine(check), { log: false });
  tc.checks.push(check);
  return check;
}

function requireStep(name) {
  if (!tc.done[name]) throw new Error(`Skipped: the "${name}" step did not complete.`);
}

// Product writes: only Monster01, and a delete only for this test's product.
function guardProductWrites() {
  cy.intercept("POST", "**/Product_api_react/add_product", (req) => {
    const merchantId = field(req, "merchant_id");
    if (merchantId !== CONFIG.merchantId || field(req, "stores")) {
      state.stopRun = `STORE GUARD: blocked add_product for merchant_id "${merchantId}" (stores "${field(req, "stores") || ""}").`;
      req.reply({ statusCode: 403, body: { status: false, message: state.stopRun } });
      return;
    }
    req.on("after:response", (res) => (tc.createAnswer = { status: res.statusCode, body: parseBody(res.body) }));
  }).as("addProduct");
  cy.intercept("POST", "**/Product_api_react/delete_product", (req) => {
    const merchantId = field(req, "merchant_id");
    const id = field(req, "id");
    if (merchantId !== CONFIG.merchantId || !tc.product.id || String(id) !== String(tc.product.id)) {
      state.stopRun = `SAFETY GUARD: blocked delete_product for id "${id}" / merchant_id "${merchantId}" - only product ${tc.product.id} of ${CONFIG.merchantId} may be deleted.`;
      req.reply({ statusCode: 403, body: { status: false, message: state.stopRun } });
      return;
    }
    req.on("after:response", (res) => (tc.deleteAnswer = { status: res.statusCode, body: parseBody(res.body) }));
  }).as("deleteProduct");
}

// The PO screen's product search for the product's UPC - retried while a
// just-saved product is not searchable yet. Yields the matching product.
function findInPicker(attempt = 1) {
  const from = state.calls.length;
  purchaseOrderPage.searchProduct(tc.product.upc);
  return waitForCall("new_purchase_orders_product_list_v2", (f) => f.search_by_product === tc.product.upc, { from }).then((call) => {
    expect(call.fields.merchant_id, "product search merchant_id").to.equal(CONFIG.merchantId);
    const found = ((call.body && call.body.data) || []).find((p) => String(p.upc).trim() === tc.product.upc);
    if (found) return found;
    if (attempt >= 6) throw new Error(`Product with UPC ${tc.product.upc} not found in the PO product search after ${attempt} tries.`);
    cy.wait(5000, { log: false }); // search index catch-up; nothing else to wait on
    purchaseOrderPage.searchProduct(" ");
    return findInPicker(attempt + 1);
  });
}

// Opens the PO Products Report for Monster01 only, Today, and searches the
// product's UPC. Yields { call, shown, rowText } for the product's entry.
function openReportEntry() {
  const calls = [];
  const dates = presetDates("Today");
  poProductsReportPage.recordCalls(calls);
  poProductsReportPage.visit();
  poProductsReportPage.waitForCall(calls, 0, (f) => Boolean(f.outlet_ids), "the page opening").then((first) => {
    expect(first.fields.merchant_id, "report is for Monster01").to.equal(CONFIG.merchantId);
  });
  poProductsReportPage.selectOnlyStores(["MONSTER01"]);
  cy.then(() => {
    const from = calls.length;
    poProductsReportPage.selectDateRange("Today");
    return poProductsReportPage.waitForCall(calls, from, (f) => f.start_date === dates.start && f.end_date === dates.end && f.outlet_ids === CONFIG.merchantId, "Today, MONSTER01");
  });
  return cy
    .then(() => {
      const from = calls.length;
      poProductsReportPage.search(tc.product.upc);
      return poProductsReportPage.waitForCall(
        calls,
        from,
        (f) => String(f.search_by || "").trim() === tc.product.upc && f.start_date === dates.start && f.outlet_ids === CONFIG.merchantId,
        `search ${tc.product.upc}`
      );
    })
    .then((call) => {
      poProductsReportPage.waitForRows(call.body.rows.length);
      return poProductsReportPage.readTable().then((shown) =>
        poProductsReportPage.table().then(($table) => {
          const tr = $table
            .find("tbody > tr")
            .toArray()
            .find((row) => row.innerText.includes(tc.product.upc));
          return { call, shown, rowText: tr ? tr.innerText.replace(/\s+/g, " ").trim() : null };
        })
      );
    });
}

// No retries: a retry after a save that went through would make extra data.
describe("Test Case 01", { baseUrl: CONFIG.baseUrl, retries: 0, defaultCommandTimeout: 15000 }, () => {
  before(() => {
    assertTestEnvironment();
    injectLogStyles();
    cy.task("log", `Test Case 01: product "${tc.product.name}" UPC ${tc.product.upc}, PO ${tc.po.number}, store ${CONFIG.storeName} (${CONFIG.merchantId}), run ${RUN_ID}`);
  });

  beforeEach(() => {
    if (state.stopRun) throw new Error(state.stopRun);
    assertTestEnvironment();
    startWatching();
    guardProductWrites();
    ensureTargetStore();
  });

  afterEach(function () {
    if (this.currentTest.state === "failed") {
      cy.task("log", `FAILED: ${this.currentTest.title}\n  ${(this.currentTest.err && this.currentTest.err.message || "").split("\n")[0]}`);
      cy.screenshot(`test-case-01-${this.currentTest.title.slice(0, 40).replace(/[^a-z0-9]+/gi, "-")}-${RUN_ID}`, { capture: "fullPage" });
    }
  });

  after(() => {
    const now = new Date();
    const html = buildPoProductsHtml({
      checks: tc.checks,
      info: {
        title: "Test Case 01",
        generatedAt: now.toLocaleString(),
        store: CONFIG.storeName,
        storeId: CONFIG.merchantId,
        url: `${CONFIG.baseUrl}/merchants/store-reporting/po-products-report`,
        api: `Product: "${tc.product.name}" UPC ${tc.product.upc} id ${tc.product.id || "—"} · PO ${tc.po.number} id ${tc.po.id || "—"}`,
        dateRange: "Today (MONSTER01 only, searched by the product's UPC)",
        startDate: presetDates("Today").start,
        endDate: presetDates("Today").end,
        merchantIds: [CONFIG.merchantId],
        pageSize: `Expected result: the entry shows "${EXPECTED_STATUS}" after the product is deleted`,
      },
    });
    cy.writeFile(REPORT_FILE, html);
    cy.task("log", `HTML report written to ${Cypress.config("projectRoot")}/${REPORT_FILE}`);
  });

  it("Step 1 - creates a product in Monster01", () => {
    productsPage.visit();
    productsPage.clickAddProduct();
    productsPage.chooseSingleProductType();
    cy.location("pathname", { timeout: 30000 }).should("include", "/inventory/new-products/add");
    productFormPage.fillName(tc.product.name);
    productFormPage.selectRandomCategory();
    productFormPage.fillUpc(tc.product.upc);
    productFormPage.fillSimplePricing(tc.product.cost, tc.product.price);
    productFormPage.fillAvailableToSell();
    cy.then(() => (tc.createAnswer = null));
    productFormPage.save();
    cy.wrap(tc, { timeout: 60000, log: false }).its("createAnswer").should("exist");
    cy.then(() => {
      if (state.stopRun) throw new Error(state.stopRun);
      const { status, body } = tc.createAnswer;
      cy.task("log", `Step 1: add_product answered HTTP ${status} - ${JSON.stringify(body).slice(0, 300)}`);
      expect(status, "add_product HTTP status").to.be.within(200, 299);
      expect(isOk(body && body.status), `add_product status (${body && body.message})`).to.equal(true);
    });
    productFormPage.assertAddedSuccessfully();
    record("Step 1 - Create product", "product created", [
      { label: "Expected", value: "created" },
      { label: `"${tc.product.name}" UPC ${tc.product.upc}`, value: "created" },
    ]);
    cy.then(() => (tc.done.product = true));
  });

  it("Step 2 - creates a Purchase Order for that product", () => {
    requireStep("product");
    const formFrom = state.calls.length;
    purchaseOrderPage.openAddForm();
    purchaseOrderPage.locationText().then((location) => expect(location.toLowerCase(), "Location picker").to.match(/^monster01\b/));

    waitForCall("new_purchase_orders_vendor_list", (f) => !f.search_by_vendor, { from: formFrom }).then((call) => {
      assertCallsForTarget(["new_purchase_orders_vendor_list"]);
      const vendors = ((call.body && call.body.data) || []).filter((v) => v.id && String(v.vendor_name || "").trim() && !/^no vendor$/i.test(String(v.vendor_name).trim()));
      if (!vendors.length) throw new Error(`${CONFIG.storeName} has no vendors.`);
      tc.po.supplier = String(Cypress._.sample(vendors).vendor_name).trim();
      purchaseOrderPage.selectSupplier(tc.po.supplier);
    });
    purchaseOrderPage.selectStockDueToday();
    waitForCall("generate_po_number", () => true, { from: formFrom });
    purchaseOrderPage.fillOrderNumber(tc.po.number).then((value) => (tc.po.number = value));
    purchaseOrderPage.fillSupplierInvoice(tc.po.invoice);
    purchaseOrderPage.fillNote(tc.po.note);

    // The product, by its UPC, in the PO screen's own product search.
    purchaseOrderPage.openProductPicker();
    findInPicker().then((found) => {
      tc.product.id = String(found.product_id);
      cy.task("log", `Step 2: product "${found.product_title}" found in the PO product search - id ${tc.product.id}`);
      expect(String(found.product_title).trim(), "product found by UPC").to.equal(tc.product.name);
      purchaseOrderPage.addProductFromPicker(tc.product.name, tc.product.upc);
    });
    cy.get('[role="dialog"]:has(input[placeholder^="Search product"])').should("not.exist");
    purchaseOrderPage.lineVariantKey().then((key) => expect(String(key), "PO line product").to.match(new RegExp(`^${tc.product.id}-`)));
    purchaseOrderPage.setLine(QUANTITY, UNIT_PRICE);
    purchaseOrderPage.lineTotalCost().should("equal", QUANTITY * Number(UNIT_PRICE));

    purchaseOrderPage.createButton().should("be.enabled").click();
    cy.wait("@createPo", { timeout: 60000 }).then(({ response }) => {
      if (state.violation) throw new Error(state.stopRun);
      const body = parseBody(response && response.body) || {};
      cy.task("log", `Step 2: create PO answered HTTP ${response && response.statusCode} - ${JSON.stringify(body).slice(0, 300)}`);
      expect(response.statusCode, `create PO HTTP status (${body.message})`).to.be.within(200, 299);
      expect(isOk(body.status), `create PO status (${body.message})`).to.equal(true);
      tc.po.id = String(body.po_id);
      if (body.po_number) tc.po.number = String(body.po_number);
    });
    cy.location("pathname", { timeout: 30000 }).should("not.match", /\/purchase-order\/add$/);
    record("Step 2 - Create PO", "PO created", [
      { label: "Expected", value: "created" },
      { label: "PO", value: "created" },
    ]);

    // Baseline: the report lists the entry while the product still exists.
    openReportEntry().then(({ call, rowText }) => {
      const rows = call.body.rows.filter((r) => String(r.upc).trim() === tc.product.upc);
      record("Step 2 - Report before delete", "entry listed", [
        { label: "Expected", value: 1 },
        { label: "Entries for the product (API)", value: rows.length },
        { label: "Entries for the product (screen)", value: rowText ? 1 : 0 },
      ]);
      record("Step 2 - Report before delete", "product_status (API)", [
        { label: "Expected", value: "active" },
        { label: "API rows[].product_status", value: rows[0] ? String(rows[0].product_status) : "no entry" },
      ]);
      cy.task("log", `Step 2: report entry before delete - screen "${rowText}" | API ${JSON.stringify(rows[0] || null).slice(0, 400)}`);
    });
    cy.then(() => (tc.done.po = true));
  });

  it("Step 3 - deletes the product", () => {
    requireStep("po");
    productFormPage.visitEdit(tc.product.id);
    cy.get('input[placeholder="Enter product name"]').should("have.value", tc.product.name);
    // The "More actions" menu closes on any scroll, and Cypress scrolls an
    // element into view before clicking it - so the page is put at the top
    // first and both clicks skip that scrolling.
    cy.scrollTo("top", { ensureScrollable: false });
    cy.get('button[title="More actions"]', { timeout: 30000 }).should("be.visible").click({ scrollBehavior: false });
    cy.contains("[data-npf-actionsmenu] button", /Delete item/, { timeout: 15000 }).should("be.visible").click({ scrollBehavior: false });
    cy.contains("Delete this product?", { timeout: 15000 }).should("be.visible");
    cy.contains("b", tc.product.name).should("be.visible");
    cy.then(() => (tc.deleteAnswer = null));
    cy.contains("button", /^\s*Delete product\s*$/).should("be.enabled").click();
    cy.wrap(tc, { timeout: 60000, log: false }).its("deleteAnswer").should("exist");
    cy.then(() => {
      if (state.stopRun) throw new Error(state.stopRun);
      const { status, body } = tc.deleteAnswer;
      cy.task("log", `Step 3: delete_product answered HTTP ${status} - ${JSON.stringify(body).slice(0, 300)}`);
      expect(status, "delete_product HTTP status").to.be.within(200, 299);
      expect(isOk(body && body.status), `delete_product status (${body && (body.delete_message || body.message)})`).to.equal(true);
    });
    cy.contains("Deleted Successfully", { timeout: 15000 }).should("be.visible");
    record("Step 3 - Delete product", "product deleted", [
      { label: "Expected", value: "deleted" },
      { label: `Product id ${tc.product.id}`, value: "deleted" },
    ]);
    cy.then(() => (tc.done.deleted = true));
  });

  it(`Step 4 - PO Products Report shows the deleted product's entry as "${EXPECTED_STATUS}"`, () => {
    requireStep("deleted");
    openReportEntry().then(({ call, rowText }) => {
      const rows = call.body.rows.filter((r) => String(r.upc).trim() === tc.product.upc);
      const api = rows[0];
      const statusOnScreen = rowText && /\bdeleted\b/i.test(rowText) ? EXPECTED_STATUS : rowText ? "no status shown" : "entry not listed";
      cy.task("log", `Step 4: report entry after delete - screen "${rowText}" | API ${JSON.stringify(api || null).slice(0, 400)}`);

      record("Step 4 - Report after delete", "entry still listed", [
        { label: "Expected", value: 1 },
        { label: "Entries for the product (API)", value: rows.length },
        { label: "Entries for the product (screen)", value: rowText ? 1 : 0 },
      ]);
      record("Step 4 - Report after delete", "product_status (API)", [
        { label: "Expected", value: EXPECTED_STATUS.toLowerCase() },
        { label: "API rows[].product_status", value: api ? String(api.product_status) : "no entry" },
      ]);
      if (api) {
        record("Step 4 - Report after delete", "quantities (API)", [
          { label: "Expected (ordered, not received)", value: "received 0" },
          { label: "API", value: `received ${Number(api.stock_received)}` },
        ]);
      }
      record("Step 4 - Report after delete", "status shown on screen (EXPECTED RESULT)", [
        { label: "Expected", value: EXPECTED_STATUS },
        { label: "Screen shows", value: statusOnScreen },
      ]);
    });
    cy.then(() => {
      const failed = tc.checks.filter((c) => !c.match);
      expect(failed, "\n" + failed.map(formatCheckLine).join("\n")).to.be.empty;
    });
  });
});
