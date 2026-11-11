const productsPage = require("../../pages/ProductsPage");
const productFormPage = require("../../pages/ProductFormPage");
const { TARGET, state, startWatching, ensureTargetStore } = require("../../support/storeGuard");
// Required here, not from support/e2e.js: the support file is bundled
// separately, so its copy of the store-guard state would never see this
// spec's verified store. Requiring it also registers cy.getUniqueProductData.
const { RUN_ID, replaceValue, findProductByUpc, titleOf, titleTaken, upcTaken, uniqueCategoryName } = require("../../support/productUniqueness");

// Creates PRODUCT_COUNT single products in the target store ONLY
// (cypress/fixtures/targetStore.json), each with a unique name, UPC and SKU,
// price 100 (cost below it, compare-at price above it), its own new
// category ("AI Cat <runId> <n>", created from the form), RELATED_COUNT
// related products and one extra tax.
// Override: --env productCount=3,productBaseUrl=https://...
const PRODUCT_COUNT = Number(Cypress.env("productCount") || 10);
const BASE_URL = Cypress.env("productBaseUrl") || TARGET.baseUrl;
const PHOTO = "cypress/fixtures/product-images/product-blue.png";
const PRICE = 100;
const RELATED_COUNT = 4;
const DEBUG_FILE = `cypress/reports-output/product-create-debug-${RUN_ID}.json`;

// Toast/field messages the form shows instead of sending the create request.
const DUPLICATE_MESSAGES = {
  name: /this (product )?title is already in use/i,
  upc: /UPC Code must be unique/i,
  sku: /fix the Custom Code errors/i,
};
const VALIDATION_MESSAGES = ["Select Category", "Title is required", "Price is required", "Title contains invalid characters"];

// The one optional extra: dropped when the server fails to create a product
// with it (e.g. HTTP 500 from the S3 upload), and left out for the rest of
// the run. SKU, UPC, tax and related products are required, never dropped.
const OPTIONAL_FEATURES = ["photo"];
const skippedFeatures = new Set();

const created = [];
const debugLog = [];
const normalize = (s) => String(s || "").trim().toLowerCase();
const isOk = (value) => value === true || value === 1 || value === "1" || value === "true";

// Price is fixed; cost is always below it and the compare-at price always
// above it - checked here, and again on what the create request sent.

function pricing() {
  const cost = Cypress._.random(40, 90, true);
  const compare = Cypress._.random(110, 150, true);
  const values = { price: PRICE.toFixed(2), cost: cost.toFixed(2), compare: compare.toFixed(2) };
  assertPriceRules(values, "generated pricing");
  return values;
}

function assertPriceRules({ price, cost, compare }, where) {
  expect(Number(cost), `${where}: cost ${cost} < price ${price}`).to.be.lessThan(Number(price));
  expect(Number(compare), `${where}: compare-at price ${compare} > price ${price}`).to.be.greaterThan(Number(price));
}

const skuFor = (n, attempt = 0) => `QVA${RUN_ID.slice(-8)}${String(n).padStart(2, "0")}${attempt ? attempt : ""}`;

function rawText(body) {
  if (body === undefined || body === null) return "";
  return typeof body === "string" ? body : JSON.stringify(body);
}

// What clicking "Save product" led to, or null while nothing has yet.
function saveOutcome(pageText) {
  if (state.violation) return { type: "blocked" };
  const response = state.lastCreate && state.lastCreate.response;
  if (response) {
    const raw = rawText(response.body);
    const body = typeof response.body === "string" ? Cypress._.attempt(JSON.parse, response.body) : response.body;
    const json = body && !(body instanceof Error) ? body : null;
    const ok = response.statusCode >= 200 && response.statusCode < 300 && json && isOk(json.status);
    if (ok) return { type: "created" };
    const message = (json && (json.message || json.update_message || json.success_message)) || "";
    return { type: "createFailed", statusCode: response.statusCode, message, raw: raw.slice(0, 500) };
  }
  if (DUPLICATE_MESSAGES.name.test(pageText)) return { type: "duplicate", field: "name" };
  if (DUPLICATE_MESSAGES.upc.test(pageText)) return { type: "duplicate", field: "upc" };
  if (DUPLICATE_MESSAGES.sku.test(pageText)) return { type: "duplicate", field: "sku" };
  if (pageText.includes("Generate & save")) return { type: "upcModal" };
  const validation = VALIDATION_MESSAGES.find((m) => pageText.includes(m));
  if (validation) return { type: "validation", message: validation };
  return null;
}

// Old toasts would otherwise read as the outcome of the next save.
function dismissToasts() {
  cy.get("body").then(($body) => $body.find(".Toastify__close-button").each((_, button) => button.click()));
  return cy.get(".Toastify__toast", { timeout: 15000 }).should("not.exist");
}

function waitForOutcome() {
  return cy
    .get("body", { timeout: 90000 })
    .should(($body) => {
      expect(saveOutcome($body[0].innerText), "save outcome (create response, duplicate or validation message)").to.not.equal(null);
    })
    .then(($body) => saveOutcome($body[0].innerText));
}

// Clicks "Save product" and yields the outcome. With no UPC typed the form
// asks to generate one - accepted, and the save goes on.
function submit() {
  dismissToasts();
  cy.then(() => (state.lastCreate = null));
  cy.contains("button", "Save product", { timeout: 15000 }).should("be.enabled").click();
  return waitForOutcome().then((outcome) => {
    if (outcome.type !== "upcModal") return outcome;
    cy.contains("button", "Generate & save").click();
    return waitForOutcome();
  });
}

function openAddForm() {
  productsPage.visit();
  productsPage.clickAddProduct();
  productsPage.chooseSingleProductType();
  cy.location("pathname", { timeout: 30000 }).should("include", "/inventory/new-products/add");
  return cy.location("search").should("include", "type=single");
}

// Each product gets its own new category (unique name checked store-wide
// beforehand), created through the form's Create category modal.
// The name is read when this step runs (it's generated by an earlier
// queued step), not when it's queued.
function chooseCategory(product) {
  return cy.then(() =>
    productFormPage.selectOrCreateCategory(product.category, { allowCreate: true }).then((result) => {
      cy.log(`Category **${product.category}** ${result}`);
    })
  );
}

// Products made by this run are only used as related products when too
// few others exist.
const madeByThisRun = (name) => name.includes(`Auto Product ${RUN_ID}`);

function fillForm(product, features) {
  productFormPage.fillName(product.name);
  chooseCategory(product);
  productFormPage.fillUpc(product.upc);
  productFormPage.fillSimplePricing(product.cost, product.price);
  productFormPage.fillComparePrice(product.compare);
  productFormPage.assertPricing(product);
  productFormPage.fillAvailableToSell();
  productFormPage.fillSku(product.sku);
  productFormPage.addTax().then((tax) => (product.tax = tax));
  // Existing products only - never the one being created; ones this run
  // made are used only if too few others are listed.
  productFormPage
    .addRelatedProducts(RELATED_COUNT, { avoid: (name) => madeByThisRun(name) || normalize(name) === normalize(product.name) })
    .then((related) => {
      expect(related.map(normalize), "related products").not.to.include(normalize(product.name));
      product.related = related;
    });
  if (features.photo) productFormPage.tryAttachPhoto(PHOTO);
}

function logAttempt(product, features, outcome) {
  const lastCreate = state.lastCreate || {};
  debugLog.push({
    product: product.n,
    name: product.name,
    features: Object.keys(features).filter((f) => features[f]),
    outcome: outcome.type,
    statusCode: outcome.statusCode,
    message: outcome.message,
    responseBody: outcome.raw,
    requestUrl: lastCreate.url,
    requestFields: lastCreate.fields,
  });
  return cy.writeFile(DEBUG_FILE, debugLog, { log: false });
}

// Opens a fresh add-product form, fills it and saves. A duplicate name/UPC
// is regenerated (2 retries); a failed create first checks whether the
// product got saved anyway, then retries with the next optional feature
// left out.
// `formOpen`: the first attempt reuses the form the test already opened.
function createProduct(product, features, budget = { duplicate: 2, fallback: OPTIONAL_FEATURES.length }, formOpen = false) {
  if (!formOpen) openAddForm();
  fillForm(product, features);

  return submit().then((outcome) => {
    logAttempt(product, features, outcome);

    if (outcome.type === "created") {
      const sent = (state.lastCreate && state.lastCreate.fields) || {};
      product.photo = Boolean(features.photo && Object.values(sent).some((v) => /^<file /.test(String(v))));
      // What was actually saved follows the rules too.
      assertPriceRules({ price: sent.price, cost: sent.costperItem, compare: sent.compare_price }, "create request");
      expect(sent.upc, "UPC sent").to.equal(product.upc);
      expect(sent.custom_code, "SKU sent").to.equal(product.sku);
      return cy.wrap(product, { log: false });
    }
    if (outcome.type === "blocked") throw new Error(state.stopRun);
    if (outcome.type === "validation") throw new Error(`Save blocked by the form: "${outcome.message}".`);
    if (outcome.type === "upcModal") throw new Error("The form kept asking to generate a UPC.");

    let field = outcome.field;
    if (outcome.type === "createFailed" && /already|unique|exist|duplicate/i.test(outcome.message)) {
      field = /upc|code/i.test(outcome.message) ? "upc" : "name";
    }
    if (field === "sku") {
      if (budget.duplicate <= 0) throw new Error(`Still a duplicate SKU after retrying: ${product.sku}`);
      product.skuAttempt = (product.skuAttempt || 0) + 1;
      product.sku = skuFor(product.n, product.skuAttempt);
      cy.log(`SKU already in use - retrying with ${product.sku}`);
      return createProduct(product, features, { ...budget, duplicate: budget.duplicate - 1 });
    }
    if (field) {
      if (budget.duplicate <= 0) throw new Error(`Still a duplicate ${field} after retrying: ${product[field]}`);
      cy.log(`Duplicate ${field} "${product[field]}" - regenerating`);
      return replaceValue(product.n, product, field).then(({ name, upc }) => {
        Object.assign(product, { name, upc });
        return createProduct(product, features, { ...budget, duplicate: budget.duplicate - 1 });
      });
    }

    // The server failed (e.g. HTTP 500 with no body). Never create twice:
    // if the name is now taken, the product was saved after all.
    return titleTaken(product.name).then((saved) => {
      if (saved) {
        cy.log(`Server answered HTTP ${outcome.statusCode}, but "${product.name}" exists - counting it as created`);
        product.note = `server answered HTTP ${outcome.statusCode} but saved it`;
        return cy.wrap(product, { log: false });
      }
      // Only drop what this request actually carried (a photo the form
      // didn't take was never sent).
      const sent = (state.lastCreate && state.lastCreate.fields) || {};
      const carried = { photo: Object.values(sent).some((v) => /^<file /.test(String(v))) };
      const drop = OPTIONAL_FEATURES.find((f) => features[f] && carried[f]);
      if (!drop || budget.fallback <= 0) {
        throw new Error(
          `Create request failed: HTTP ${outcome.statusCode} ${outcome.message || `body "${outcome.raw}"`}` +
            `${features.photo ? "" : " (already without the photo)"}. Request + response of every attempt: ${DEBUG_FILE}`
        );
      }
      cy.log(`Create failed (HTTP ${outcome.statusCode}) - retrying without the ${drop}`);
      return createProduct(product, { ...features, [drop]: false }, { ...budget, fallback: budget.fallback - 1 }).then((p) => {
        skippedFeatures.add(drop);
        return p;
      });
    });
  });
}

// The product must now be in the target store: found by UPC in the
// Products page search with the same name - or, if that search index hasn't
// caught up, both store-scoped uniqueness checks now report the name and UPC
// as taken.
function verifyInStore(product) {
  if (!product.upc) {
    return titleTaken(product.name).then((taken) => {
      expect(taken, `"${product.name}" exists in ${TARGET.id}`).to.equal(true);
      product.verifiedBy = "check_productTitle";
    });
  }
  return findProductByUpc(product.upc).then((found) => {
    if (found) {
      expect(normalize(titleOf(found)), `name of the product with UPC ${product.upc}`).to.equal(normalize(product.name));
      product.verifiedBy = "search";
      return;
    }
    titleTaken(product.name).then((nameTaken) => {
      upcTaken(product.upc).then((upcIsTaken) => {
        expect(nameTaken && upcIsTaken, `"${product.name}" / UPC ${product.upc} exists in ${TARGET.id}`).to.equal(true);
        product.verifiedBy = "uniqueness APIs (search index not updated yet)";
      });
    });
  });
}

// No retries: a retry after a save that went through would create an extra
// product.
describe("Products CRUD Operations", { baseUrl: BASE_URL, retries: 0 }, () => {
  // A failing beforeEach makes Mocha skip every remaining test, which is
  // exactly what a store-guard failure must do.
  beforeEach(() => {
    if (state.stopRun) throw new Error(state.stopRun);
    startWatching();
    ensureTargetStore();
  });

  // `cypress open` keeps failure messages in the runner only - print them
  // to the terminal too, with a screenshot, so a run can be read afterwards.
  afterEach(function () {
    if (this.currentTest.state !== "failed") return;
    const message = (this.currentTest.err && this.currentTest.err.message) || "unknown error";
    cy.task("log", `FAILED: ${this.currentTest.title}\n  ${message.split("\n").slice(0, 8).join("\n  ")}`);
    cy.screenshot(`product-creation-failed-${RUN_ID}-${(this.currentTest.title.match(/\d+/) || ["x"])[0]}`, { capture: "fullPage" });
  });

  after(() => {
    const rows = created.map((p) => ({
      "#": p.n,
      name: p.name,
      upc: p.upc,
      sku: p.sku,
      price: p.price,
      cost: p.cost,
      compare: p.compare,
      category: p.category,
      tax: p.tax,
      related: (p.related || []).join(", "),
      photo: p.photo ? "yes" : "no",
      storeId: TARGET.id,
      verifiedBy: p.verifiedBy,
    }));
    console.table(rows);
    const header = ["#", "Name", "UPC", "SKU", "Price", "Cost", "Compare", "Category", "Tax", "Related", "Photo", "Store ID"];
    const lines = rows.map((r) =>
      [r["#"], r.name, r.upc, r.sku, r.price, r.cost, r.compare, r.category, r.tax, r.related, r.photo, r.storeId].join(" | ")
    );
    const carries =
      state.createCarriesStoreId === null
        ? "no create request was seen"
        : state.createCarriesStoreId
          ? "yes (merchant_id checked on every request)"
          : "NO - relied on the header + Products_list store checks";
    cy.writeFile(DEBUG_FILE, debugLog, { log: false });
    cy.task(
      "log",
      `\nProducts created in ${TARGET.name} (${TARGET.id}) on ${BASE_URL}: ${rows.length}/${PRODUCT_COUNT}\n` +
        `${header.join(" | ")}\n${lines.join("\n")}\n` +
        `Create request carries the store id: ${carries}\n` +
        `Left out after server errors: ${[...skippedFeatures].join(", ") || "nothing"}\n` +
        `Create attempts log: ${DEBUG_FILE}`
    );
  });

  Cypress._.times(PRODUCT_COUNT, (i) => {
    const n = i + 1;

    it(`creates product ${n} of ${PRODUCT_COUNT} in ${TARGET.name} (${TARGET.id})`, () => {
      // The form's page load also reveals the API the uniqueness checks use.
      openAddForm();
      cy.getUniqueProductData(n).then(({ name, upc }) => {
        const product = { n, name, upc, sku: skuFor(n), ...pricing() };
        uniqueCategoryName(n).then((categoryName) => (product.category = categoryName));
        const features = Cypress._.fromPairs(OPTIONAL_FEATURES.map((f) => [f, !skippedFeatures.has(f)]));
        cy.log(`Product ${n} in ${TARGET.name} (${TARGET.id}): **${name}** · UPC ${upc}`);

        createProduct(product, features, undefined, true).then(() => {
          verifyInStore(product);
          cy.then(() => {
            created.push(product);
            cy.log(
              `Created **${product.name}** · UPC ${product.upc} · SKU ${product.sku} · $${product.price} ` +
                `(cost $${product.cost}, compare $${product.compare}) · tax ${product.tax} · ${RELATED_COUNT} related · ${TARGET.id}`
            );
          });
        });
      });
    });
  });
});
