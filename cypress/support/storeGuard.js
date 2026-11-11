// Keeps product creation inside ONE store (cypress/fixtures/targetStore.json).
//
// - Switching: the logged-in user is a super admin, so the store is entered
//   the way the existing specs do it (Users > stores > View -> "Back to
//   Super Admin" shows). The header's store dropdown is not used: switching
//   there can ask for an OTP.
// - Verifying: the header's store name must be the target's, and the
//   Products page's own Products_list request must carry the target's
//   merchant_id. One retry (fresh login + store entry); a second failure
//   stops the run (state.stopRun - the spec's beforeEach throws on it).
// - Network safety net: every Product_api_react/add_product request is
//   inspected; one carrying another merchant_id, or asking to copy the
//   product to other stores (`stores`), is answered locally with a 403 and
//   never reaches the server.
const TARGET = require("../fixtures/targetStore.json");
const productsPage = require("../pages/ProductsPage");
const { parseMultipart, multipartField, bodyText } = require("./multipart");

// Lives for the whole spec file (module scope), across `it` blocks.
const state = {
  stopRun: null, // reason the whole run must stop
  violation: null, // a create request that was blocked
  createCarriesStoreId: null, // true/false once a create request was seen
  editCarriesStoreId: null, // same, for edit requests
  lastCreate: null, // { url, merchantId, stores, fields, response }
  lastEdit: null, // same, for the last edit request
  apiBase: null, // main API base URL (check_productTitle, check_upc_form, ...)
  ctx: null, // { searchUrl, authorization, fields } from Products_list
};

// Calls that go to the same API base as the form's own title/UPC checks
// (confirmed live on test.quickvee.us: all under ".../ci/"). Other calls
// can use other bases - add_product, Products_list and check_custom_code
// went to a different one, and SettingsReact_api sits under ".../ci/api/" -
// so only these reveal the base.
const MAIN_API_CALLS = [
  "Product_api_react/check_productTitle",
  "Product_api_react/check_upc_form",
  "Settingapi/tax_list",
  "LoginApiReact/chk_merchant",
];

function mainApiBase(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const match = parsed.pathname.match(/^(.*\/)([A-Za-z_]+\/[A-Za-z_]+)\/?$/);
  if (!match || !MAIN_API_CALLS.includes(match[2])) return null;
  return `${parsed.origin}${match[1]}`;
}

// Registers the intercepts. Call at the start of every test (intercepts are
// reset between tests).
function startWatching() {
  if (Cypress.env("productApiBaseUrl")) state.apiBase = Cypress.env("productApiBaseUrl");

  // Passive: only notes the main API's base URL from the app's own calls.
  cy.intercept({ method: "POST" }, (req) => {
    if (!state.apiBase) state.apiBase = mainApiBase(req.url);
  });

  guardProductWrite("**/Product_api_react/add_product", "createProduct", "lastCreate", "createCarriesStoreId", "create");
  // The app's own endpoint name ("edit_produt" - sic).
  guardProductWrite("**/Product_api_react/edit_produ*", "editProduct", "lastEdit", "editCarriesStoreId", "edit");
}

// Inspects every product write request (create / edit) before it leaves the
// browser: one carrying another merchant_id, or asking to copy the product
// to other stores (`stores`), is answered locally with a 403 and never
// reaches the server; the run is then stopped. The request's fields and the
// server's answer are kept on state[stateKey].
function guardProductWrite(urlGlob, alias, stateKey, carriesKey, what) {
  cy.intercept("POST", urlGlob, (req) => {
    const merchantId = multipartField(req.body, "merchant_id");
    const stores = multipartField(req.body, "stores");
    state[stateKey] = { url: req.url, merchantId, stores, fields: formFields(req.body), response: null };
    state[carriesKey] = merchantId !== null;

    let problem = null;
    if (merchantId !== null && merchantId !== TARGET.id) {
      problem = `${what} request was for merchant_id "${merchantId}", not ${TARGET.id}`;
    } else if (stores) {
      problem = `${what} request asked to copy the product to other stores ("${stores}")`;
    }
    if (problem) {
      state.violation = problem;
      state.stopRun = `STORE GUARD: blocked a product ${what} request - ${problem}.`;
      req.reply({ statusCode: 403, body: { status: false, message: `Blocked by Cypress store guard: ${problem}` } });
      return;
    }
    req.continue((res) => {
      state[stateKey].response = { statusCode: res.statusCode, body: res.body, contentType: res.headers["content-type"] };
    });
  }).as(alias);
}

// Every field of a multipart body: text fields with their value, file
// fields as "<file name>" - for the debug log of failed creates.
function formFields(body) {
  const fields = {};
  const pattern = /name="([^"]+)"(?:; filename="([^"]*)")?\r?\n(?:Content-Type:[^\r\n]*\r?\n)?\r?\n([^\r\n]*)/g;
  let match;
  const text = bodyText(body);
  while ((match = pattern.exec(text))) {
    const [, name, filename, value] = match;
    fields[name] = filename !== undefined ? `<file ${filename}>` : value;
  }
  return Cypress._.omit(fields, ["token", "token_id", "session_id"]);
}

// Opens the Products page and checks the header and the page's own
// Products_list request. Yields { ok, problems, ctx } - never throws on a
// wrong store, so the caller can retry.
function checkStore() {
  cy.intercept("POST", "**/Product_api_react/Products_list").as("productsList");
  productsPage.visit();

  return cy.wait("@productsList", { timeout: 60000 }).then(({ request }) => {
    const fields = parseMultipart(request.body, request.headers["content-type"]);
    const ctx = { searchUrl: request.url, authorization: request.headers.authorization, fields };

    return cy.get(".qv-app-header__store-name", { timeout: 30000 }).then(($name) => {
      const headerName = $name.text().trim();
      const problems = [];
      if (headerName.toLowerCase() !== TARGET.name.toLowerCase()) {
        problems.push(`header shows store "${headerName}", expected "${TARGET.name}"`);
      }
      if (fields.merchant_id !== TARGET.id) {
        problems.push(`Products page asked for merchant_id "${fields.merchant_id}", expected "${TARGET.id}"`);
      }
      return { ok: problems.length === 0, problems, ctx, headerName };
    });
  });
}

function enterTargetStore() {
  return cy.loginAndEnterStore(Cypress.env("storeName"), Cypress.env("username"), Cypress.env("password"), TARGET.name);
}

// Enters the target store (cached session) and verifies it, retrying once
// with a fresh login. Yields the Products_list context. A second failure
// sets state.stopRun and throws.
function ensureTargetStore() {
  enterTargetStore();
  return checkStore().then((first) => {
    if (first.ok) return verified(first);

    cy.log(`Store check failed (${first.problems.join("; ")}) - switching again`);
    cy.then(() => Cypress.session.clearAllSavedSessions());
    enterTargetStore();
    return checkStore().then((second) => {
      if (second.ok) return verified(second);
      state.stopRun = `STORE GUARD: not inside ${TARGET.name} (${TARGET.id}) after retrying - ${second.problems.join("; ")}. Run stopped.`;
      throw new Error(state.stopRun);
    });
  });
}

function verified(result) {
  state.ctx = result.ctx;
  cy.log(`Store verified: **${result.headerName}** (${result.ctx.fields.merchant_id})`);
  return cy.wrap(result.ctx, { log: false });
}

// Waits for the main API base URL to be noticed (the add-product form calls
// Settingapi/tax_list on load).
function apiBase() {
  return cy
    .wrap(state, { log: false })
    .its("apiBase", { timeout: 30000, log: false })
    .should("be.a", "string");
}

module.exports = { TARGET, state, startWatching, ensureTargetStore, apiBase };
