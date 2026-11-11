const productFormPage = require("../../pages/ProductFormPage");
const reorderReportPage = require("../../pages/ReorderReportPage");
const { buildReorderReportHtml } = require("../../reports/reorderReportHtml");
const { TARGET, state, startWatching, ensureTargetStore } = require("../../support/storeGuard");
// Required here (not from support/e2e.js) so this spec shares the store
// guard's verified context - see "Products CRUD Operations.cy.js".
const { listProducts, titleOf } = require("../../support/productUniqueness");

// Sets a new Reorder point and Reorder quantity on REORDER_COUNT existing
// single products of the target store (cypress/fixtures/targetStore.json),
// then checks the Reorder Report shows exactly those values for each of
// them - in its API answer and in the rendered table.
// Override: --env reorderCount=3,reorderBaseUrl=https://...
const BASE_URL = Cypress.env("reorderBaseUrl") || "https://test.quickvee.us";
const REORDER_COUNT = Number(Cypress.env("reorderCount") || 10);
const DATE_RANGE = "Last 30 Days";

const VALIDATION_MESSAGES = [
  "Select Category",
  "Title is required",
  "Price is required",
  "Price must",
  "Reorder quantity must be greater than 0",
  "This product title is already in use",
  "Please fix",
];

const pool = []; // candidate products, in random order
const reordered = []; // { title, id, point, qty, before }
const results = []; // report comparison rows
let reportStepError = null; // why the report step failed, for the HTML report
const normalize = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
const isOk = (value) => value === true || value === 1 || value === "1" || value === "true";
const amount = (value) => Number(String(value ?? "").replace(/[^0-9.-]/g, ""));

// A whole number in [min, max] that differs from `current`, so the report
// can only match if the save really changed it.
function newValue(min, max, current) {
  let value = Cypress._.random(min, max);
  while (String(value) === String(current).trim()) value = Cypress._.random(min, max);
  return value;
}

function saveOutcome(pageText) {
  if (state.violation) return { type: "blocked" };
  const response = state.lastEdit && state.lastEdit.response;
  if (response) {
    const body = typeof response.body === "string" ? Cypress._.attempt(JSON.parse, response.body) : response.body;
    const json = body && !(body instanceof Error) ? body : null;
    const ok = response.statusCode >= 200 && response.statusCode < 300 && json && isOk(json.status);
    return ok ? { type: "saved" } : { type: "failed", statusCode: response.statusCode, message: (json && json.message) || String(response.body || "").slice(0, 300) };
  }
  if (pageText.includes("Generate & save")) return { type: "upcModal" };
  const validation = VALIDATION_MESSAGES.find((m) => pageText.includes(m));
  if (validation) return { type: "validation", message: validation };
  return null;
}

function waitForSave() {
  return cy
    .get("body", { timeout: 90000 })
    .should(($body) => expect(saveOutcome($body[0].innerText), "edit save outcome").to.not.equal(null))
    .then(($body) => saveOutcome($body[0].innerText));
}

// "Save changes" on the edit page; yields the outcome. A product without a
// UPC makes the form offer to generate one - accepted.
function saveChanges() {
  cy.get("body").then(($body) => $body.find(".Toastify__close-button").each((_, button) => button.click()));
  cy.then(() => (state.lastEdit = null));
  cy.contains("button", /^\s*Save changes\s*$/, { timeout: 30000 }).should("be.enabled").click();
  return waitForSave().then((outcome) => {
    if (outcome.type !== "upcModal") return outcome;
    cy.contains("button", "Generate & save").click();
    return waitForSave();
  });
}

// Reorders the next candidate from the pool. A product the form won't save
// as it is (e.g. no category) is skipped for the next one - up to 3 tries.
function reorderNext(n, triesLeft = 3) {
  const product = pool.shift();
  if (!product) throw new Error(`Ran out of ${TARGET.name} products to reorder (product ${n}).`);

  productFormPage.visitEdit(product.id);
  return productFormPage.readReorder().then((before) => {
    const point = newValue(5, 25, before.point);
    const qty = newValue(10, 60, before.qty);
    cy.log(`Product ${n}: **${product.title}** - reorder point ${before.point || "0"} -> ${point}, reorder quantity ${before.qty || "0"} -> ${qty}`);
    productFormPage.setReorder(point, qty);

    return saveChanges().then((outcome) => {
      if (outcome.type === "saved") {
        const sent = (state.lastEdit && state.lastEdit.fields) || {};
        expect(sent.reorder_level, "Reorder point sent").to.equal(String(point));
        expect(sent.reorder_qty, "Reorder quantity sent").to.equal(String(qty));
        const record = { n, id: product.id, title: product.title, point, qty, before };
        reordered.push(record);
        return cy.wrap(record, { log: false });
      }
      if (outcome.type === "blocked") throw new Error(state.stopRun);
      const why = outcome.type === "validation" ? `form said "${outcome.message}"` : `HTTP ${outcome.statusCode} ${outcome.message}`;
      if (triesLeft <= 1) throw new Error(`Could not save a reorder for product ${n}: ${why} (${product.title}).`);
      cy.log(`"${product.title}" could not be saved (${why}) - using another product`);
      return reorderNext(n, triesLeft - 1);
    });
  });
}

// The first of `keys` the API row has (its naming differs across versions).
const pick = (row, keys) => {
  if (!row) return undefined;
  const key = keys.find((k) => row[k] !== undefined && row[k] !== null);
  return key === undefined ? undefined : row[key];
};

const rowValue = (row, header) => {
  const key = Object.keys(row).find((k) => normalize(k) === normalize(header));
  return key === undefined ? undefined : row[key];
};

function compareRow(product, label, expected, actual) {
  const match = actual !== undefined && actual !== null && actual !== "" && amount(actual) === Number(expected);
  results.push({ product: product.title, check: label, expected, actual, match });
}

describe("Inventory Reorder Report", { baseUrl: BASE_URL, retries: 0 }, () => {
  beforeEach(() => {
    if (state.stopRun) throw new Error(state.stopRun);
    startWatching();
    ensureTargetStore();
  });

  // `cypress open` keeps failure messages in the runner only - print them
  // to the terminal too, with a screenshot.
  afterEach(function () {
    if (this.currentTest.state !== "failed") return;
    const message = (this.currentTest.err && this.currentTest.err.message) || "unknown error";
    if (/^Reorder Report/.test(this.currentTest.title)) reportStepError = message.split("\n")[0];
    cy.task("log", `FAILED: ${this.currentTest.title}\n  ${message.split("\n").slice(0, 8).join("\n  ")}`);
    cy.screenshot(`reorder-report-failed-${Date.now()}`, { capture: "fullPage" });
  });

  after(() => {
    // HTML report: every reordered product and value, Mapped / Not Mapped.
    const now = new Date();
    const pad = (x) => String(x).padStart(2, "0");
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const htmlFile = `cypress/reports-output/inventory-reorder-report-${stamp}.html`;
    cy.writeFile(
      htmlFile,
      buildReorderReportHtml({
        reordered,
        results,
        info: {
          generatedAt: now.toLocaleString(),
          storeName: TARGET.name,
          storeId: TARGET.id,
          baseUrl: BASE_URL,
          dateRange: DATE_RANGE,
          requested: REORDER_COUNT,
          error: reportStepError,
        },
      })
    );
    cy.task("log", `HTML report written to ${htmlFile}`);

    const lines = results.map((r) => `${r.match ? "MATCH   " : "MISMATCH"} | ${r.product} | ${r.check} | set ${r.expected} | report ${r.actual}`);
    cy.task(
      "log",
      `\nReorder Report check in ${TARGET.name} (${TARGET.id}) on ${BASE_URL}: ${reordered.length}/${REORDER_COUNT} products reordered\n` +
        reordered.map((p) => `  ${p.n}. ${p.title} (id ${p.id}): reorder point ${p.before.point || 0} -> ${p.point}, reorder qty ${p.before.qty || 0} -> ${p.qty}`).join("\n") +
        `\n${lines.join("\n")}\n` +
        `Matched ${results.filter((r) => r.match).length}/${results.length} checks. Edit request carries the store id: ${state.editCarriesStoreId}`
    );
  });

  // Candidates come from the Reorder Report itself (DATE_RANGE): the live
  // report doesn't list every product - confirmed live that a product
  // picked from the Products list had no row - so only products it already
  // lists are reordered. Its rows are matched to the store's products by
  // title for their ids.
  it(`picks ${REORDER_COUNT} single products the Reorder Report lists in ${TARGET.name} (${TARGET.id})`, () => {
    reorderReportPage.visit();
    reorderReportPage.captureListCall(() => reorderReportPage.selectDateRange(DATE_RANGE)).then((call) => {
      const limitKey = ["limit", "perPage", "per_page", "pageSize"].find((k) => call.fields[k] !== undefined) || "limit";
      const asSent = (key, value) => (typeof call.fields[key] === "number" ? value : String(value));
      cy.task("log", `reorder_list request fields: ${JSON.stringify(Cypress._.omit(call.fields, ["token", "token_id", "session_id"])).slice(0, 600)}`, { log: false });
      cy.task("log", `reorder_list page answer (${call.rows.length} rows found): ${JSON.stringify(call.body).slice(0, 800)}`, { log: false });

      reorderReportPage.fetchRows(call, { [limitKey]: asSent(limitKey, 500), page: asSent("page", 1) }).then((rows) => {
        cy.task("log", `Reorder Report (${DATE_RANGE}) lists ${rows.length} rows; first: ${JSON.stringify(rows[0] || null).slice(0, 600)}`, { log: false });
        const reportName = (r) => reorderReportPage.rowName(r);
        const reportCounts = Cypress._.countBy(rows, (r) => normalize(reportName(r)));

        listProducts(1000).then((products) => {
          const byTitle = Cypress._.groupBy(products, (p) => normalize(titleOf(p)));
          // The row's own product id when the API sends one; otherwise the
          // one product with exactly that title.
          const toProduct = (row) => {
            const name = reportName(row);
            const matches = byTitle[normalize(name)] || [];
            const listed = matches.length === 1 ? matches[0] : null;
            const id = row.product_id ?? row.productId ?? (listed && listed.id);
            if (!id || (listed && String(listed.isvarient) === "1")) return null;
            return { id, title: name };
          };
          const candidates = Cypress._.uniqBy(
            rows
              .filter((r) => !String(r.variant ?? "").trim()) // single products only
              .filter((r) => reportName(r) && reportCounts[normalize(reportName(r))] === 1) // one report row per name
              .filter((r) => !/[%|"\\#]/.test(reportName(r))) // characters that can break the title search
              .map(toProduct)
              .filter(Boolean),
            "id"
          );
          expect(candidates.length, `single products listed in the Reorder Report to reorder (need ${REORDER_COUNT})`).to.be.at.least(REORDER_COUNT);
          Cypress._.shuffle(candidates).forEach((p) => pool.push({ id: p.id, title: titleOf(p).trim() }));
          cy.log(`${candidates.length} candidate products (of ${rows.length} report rows)`);
        });
      });
    });
  });

  Cypress._.times(REORDER_COUNT, (i) => {
    const n = i + 1;
    it(`reorders product ${n} of ${REORDER_COUNT} (new reorder point + reorder quantity)`, () => {
      reorderNext(n).then((p) => cy.log(`Saved **${p.title}**: reorder point ${p.point}, reorder quantity ${p.qty}`));
    });
  });

  it(`Reorder Report (${DATE_RANGE}) shows the same reorder point and restock amount for every reordered product`, () => {
    expect(reordered.length, "products reordered").to.be.greaterThan(0);

    reorderReportPage.visit();
    reorderReportPage.selectDateRange(DATE_RANGE);
    reorderReportPage.showColumns(["reorder_point", "reorder_amount"], ["Reorder point", "Restock amount"]);

    cy.wrap(reordered, { log: false }).each((product) => {
      reorderReportPage.search(product.title).then(({ fields, rows }) => {
        const storeId = fields.merchant_id ?? fields.merchantId;
        if (storeId !== undefined) expect(storeId, "report asked for store").to.equal(TARGET.id);
        const apiRow = rows.find((r) => normalize(reorderReportPage.rowName(r)) === normalize(product.title));
        cy.task("log", `reorder_list row for "${product.title}": ${JSON.stringify(apiRow || null).slice(0, 500)}`, { log: false });
        compareRow(product, "API reorder point", product.point, pick(apiRow, ["reorder_point", "reorderPoint", "reorder_level"]));
        compareRow(product, "API reorder qty", product.qty, pick(apiRow, ["reorder_qty", "reorderQty"]));
        compareRow(product, "API restock amount", product.qty, pick(apiRow, ["restock_amount", "restockAmount", "reorder_amount"]));
      });
      reorderReportPage.rowFor(product.title).then((row) => {
        compareRow(product, "Table: Reorder point", product.point, rowValue(row, "Reorder point"));
        compareRow(product, "Table: Restock amount", product.qty, rowValue(row, "Restock amount"));
      });
    });

    cy.then(() => {
      results.forEach((r) =>
        Cypress.log({ name: r.match ? "match" : "mismatch", message: `**${r.product}** · ${r.check}: set ${r.expected}, report ${r.actual}` })
      );
      const mismatches = results.filter((r) => !r.match);
      expect(mismatches.map((m) => `${m.product} · ${m.check}: set ${m.expected}, report ${m.actual}`), "mismatches").to.be.empty;
    });
  });
});
