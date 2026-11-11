// Keeps purchase-order writes inside ONE store on the TEST environment only
// (cypress/fixtures/purchaseOrderConfig.json) - same idea as storeGuard.js,
// which does this for products.
//
// - Environment: baseUrl and the page's origin must be test.quickvee.us.
//   Anything else (quickvee.com is production) stops the run before a
//   single page is opened.
// - Verifying: the header's store name must be the target's, and the PO
//   list page's own new_purchase_orders_list request must carry the
//   target's merchant_id (and login_merchant_id). One retry (fresh login +
//   store entry); a second failure stops the run (state.stopRun - the
//   spec's beforeEach throws on it).
// - Network safety net: every PO write request (create, receive, update,
//   void, delete, vendor email) is inspected before it leaves the browser;
//   one carrying another merchant_id / admin_id is answered locally with a
//   403 and never reaches the server, and the run is stopped.
//
// All PO calls go to api-node.quickvee.us/new_purchase_orders_api/<name>,
// multipart/form-data (confirmed live on test.quickvee.us).
const CONFIG = require("../fixtures/purchaseOrderConfig.json");
const { parseMultipart, bodyText } = require("./multipart");

const API = "**/new_purchase_orders_api/";

// Calls the page makes that only read - recorded (with their answers) so
// the spec can wait on them and check which merchant they were for.
const READ_CALLS = [
  "new_purchase_orders_list",
  "new_purchase_orders_list_count",
  "new_purchase_orders_count",
  "new_purchase_orders_vendor_list",
  "new_purchase_orders_product_list_v2",
  "generate_po_number",
  "new_purchase_order_details",
];
// name -> alias. The suite itself only creates and receives; the others
// are guarded in case the app sends them on its own.
const WRITE_CALLS = {
  add_new_purchase_order: "createPo",
  receive_new_purchase_order: "receivePo",
  update_new_purchase_order_items: "updatePo",
  update_new_purchase_order_items_soh: "updatePoSoh",
  void_new_purchase_order: "voidPo",
  delete_new_purchase_order: "deletePo",
  send_vendor_email: "emailPo",
};
// Fields that may name the store a write is for.
const STORE_FIELDS = ["merchant_id", "admin_id", "login_merchant_id"];
const SECRET = /token|session|password|authorization|email/i;

// Lives for the whole spec file (module scope), across `it` blocks.
const state = {
  stopRun: null, // reason the whole run must stop
  violation: null, // a write request that was blocked
  calls: [], // read calls of the current test: { name, fields, body, status }
  writes: [], // write calls of the current test: { name, fields, storeFields, response }
  carriesStoreId: {}, // write name -> the STORE_FIELDS it carried (last one seen)
};

function stopRun(reason) {
  state.stopRun = reason;
  throw new Error(reason);
}

// Throws (and stops the run) unless the suite points at the test site.
function assertTestEnvironment() {
  const baseUrl = Cypress.config("baseUrl") || "";
  let host = "";
  try {
    host = new URL(baseUrl).host;
  } catch {
    /* empty or invalid baseUrl - host stays "" */
  }
  if (host !== CONFIG.allowedHost) {
    stopRun(
      `ENVIRONMENT GUARD: baseUrl is "${baseUrl}", but this suite creates purchase orders and changes stock, ` +
        `so it may only run on https://${CONFIG.allowedHost}. Run stopped before anything was opened.`
    );
  }
}

function assertTestOrigin() {
  return cy.location("host", { log: false }).then((host) => {
    if (host !== CONFIG.allowedHost) stopRun(`ENVIRONMENT GUARD: the page is on "${host}", not ${CONFIG.allowedHost}. Run stopped.`);
  });
}

// A request's fields: multipart (what the app sends), JSON or url-encoded.
function fieldsOf(req) {
  const type = String(req.headers["content-type"] || "");
  if (type.includes("multipart/form-data")) return parseMultipart(req.body, type);
  if (req.body && typeof req.body === "object" && !(req.body instanceof ArrayBuffer)) return { ...req.body };
  const text = bodyText(req.body);
  const json = Cypress._.attempt(JSON.parse, text);
  if (json && !(json instanceof Error) && typeof json === "object") return json;
  return Object.fromEntries(new URLSearchParams(text));
}

const cleanFields = (fields) => Cypress._.omitBy(fields, (_, key) => SECRET.test(key));
const parseBody = (body) => (typeof body === "string" ? Cypress._.attempt(JSON.parse, body) : body);

// Registers the intercepts. Call at the start of every test (Cypress drops
// intercepts between tests), before the page is visited.
function startWatching() {
  state.calls.length = 0;
  state.writes.length = 0;

  READ_CALLS.forEach((name) => {
    cy.intercept({ method: "POST", url: `${API}${name}` }, (req) => {
      const fields = fieldsOf(req);
      // after:response only observes: a request the app cancels itself
      // (it aborts the previous search when the text changes) is simply
      // never recorded, instead of failing the test as a req.continue
      // callback would.
      req.on("after:response", (res) => {
        state.calls.push({ name, fields, body: parseBody(res.body), status: res.statusCode });
      });
    });
  });

  Object.entries(WRITE_CALLS).forEach(([name, alias]) => {
    cy.intercept({ method: "POST", url: `${API}${name}` }, (req) => {
      const fields = fieldsOf(req);
      const storeFields = Cypress._.pick(fields, STORE_FIELDS);
      const write = { name, fields: cleanFields(fields), storeFields, response: null };
      state.writes.push(write);
      state.carriesStoreId[name] = Object.keys(storeFields);

      const wrong = Object.entries(storeFields).filter(([, value]) => String(value) !== CONFIG.merchantId);
      if (wrong.length) {
        const problem = `${name} was for ${wrong.map(([k, v]) => `${k}="${v}"`).join(", ")}, not ${CONFIG.merchantId}`;
        state.violation = problem;
        state.stopRun = `STORE GUARD: blocked a purchase-order write - ${problem}. Run stopped.`;
        req.reply({ statusCode: 403, body: { status: false, message: `Blocked by Cypress store guard: ${problem}` } });
        return;
      }
      req.on("after:response", (res) => {
        write.response = { statusCode: res.statusCode, body: parseBody(res.body) };
      });
    }).as(alias);
  });
}

// The latest answered read call `name` (made after `from` calls were seen)
// whose fields pass `isWanted`. Fails the test if it never comes.
function waitForCall(name, isWanted = () => true, { from = 0, timeout = 30000 } = {}) {
  const matching = (list) => list.slice(from).filter((c) => c.name === name && isWanted(c.fields));
  return cy
    .wrap(state.calls, { log: false, timeout })
    .should((list) => {
      expect(matching(list).length, `answered ${name} request`).to.be.greaterThan(0);
    })
    .then((list) => Cypress._.last(matching(list)));
}

// Every read call so far must be for the target store.
function assertCallsForTarget(names) {
  return cy.then(() => {
    const seen = state.calls.filter((c) => names.includes(c.name));
    expect(seen.length, `${names.join(" / ")} requests seen`).to.be.greaterThan(0);
    seen.forEach((c) => {
      expect(c.fields.merchant_id, `${c.name} merchant_id`).to.equal(CONFIG.merchantId);
      if (c.fields.login_merchant_id !== undefined) expect(c.fields.login_merchant_id, `${c.name} login_merchant_id`).to.equal(CONFIG.merchantId);
    });
  });
}

// Like waitForCall, but never fails: yields the answered call, or null
// once `timeout` ms have passed without one.
function callOrNull(name, from, timeout = 30000) {
  const started = Date.now();
  const find = () => Cypress._.findLast(state.calls.slice(from), (c) => c.name === name);
  return cy
    .wrap(null, { log: false, timeout: timeout + 5000 })
    .should(() => {
      expect(Boolean(find()) || Date.now() - started > timeout, `answered ${name} request (or ${timeout / 1000}s passed)`).to.equal(true);
    })
    .then(() => find() || null);
}

// Opens the PO list and checks the origin, the header and the page's own
// new_purchase_orders_list request. Yields { ok, problems, headerName } -
// never throws on a wrong store or a list that didn't load (seen on test:
// the list spinning with no answer), so the caller can retry.
function checkStore() {
  const from = state.calls.length;
  cy.visit("/merchants/purchase-order");
  assertTestOrigin();
  return callOrNull("new_purchase_orders_list", from).then((call) =>
    cy.get(".qv-app-header__store-name", { timeout: 30000 }).then(($name) => {
      const headerName = $name.text().trim();
      const problems = [];
      if (!call) {
        problems.push("the PO list did not load (no answered new_purchase_orders_list request in 30s)");
        return { ok: false, problems, headerName };
      }
      if (headerName.toLowerCase() !== CONFIG.storeName.toLowerCase()) {
        problems.push(`header shows store "${headerName}", expected "${CONFIG.storeName}"`);
      }
      ["merchant_id", "login_merchant_id"].forEach((key) => {
        if (call.fields[key] !== undefined && call.fields[key] !== CONFIG.merchantId) {
          problems.push(`PO list asked for ${key} "${call.fields[key]}", expected "${CONFIG.merchantId}"`);
        }
      });
      if (call.fields.merchant_id === undefined) problems.push("PO list request carried no merchant_id");
      return { ok: problems.length === 0, problems, headerName };
    })
  );
}

function enterTargetStore() {
  return cy.loginAndEnterStore(Cypress.env("storeName"), Cypress.env("username"), Cypress.env("password"), CONFIG.storeName);
}

// Enters the target store (cached session) and verifies it, retrying once
// with a fresh login. A second failure sets state.stopRun and throws.
function ensureTargetStore() {
  enterTargetStore();
  return checkStore().then((first) => {
    if (first.ok) return verified(first);

    cy.log(`Store check failed (${first.problems.join("; ")}) - switching again`);
    cy.then(() => Cypress.session.clearAllSavedSessions());
    enterTargetStore();
    return checkStore().then((second) => {
      if (second.ok) return verified(second);
      stopRun(`STORE GUARD: not inside ${CONFIG.storeName} (${CONFIG.merchantId}) after retrying - ${second.problems.join("; ")}. Run stopped.`);
    });
  });
}

function verified(result) {
  cy.log(`Store verified: **${result.headerName}** (${CONFIG.merchantId})`);
  return cy.wrap(result, { log: false });
}

module.exports = {
  CONFIG,
  state,
  assertTestEnvironment,
  assertTestOrigin,
  startWatching,
  waitForCall,
  assertCallsForTarget,
  ensureTargetStore,
};
