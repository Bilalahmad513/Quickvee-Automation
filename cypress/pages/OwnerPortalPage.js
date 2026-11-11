// Owner Report portal (quickvee.com/merchants/owner). Its own email/password
// login, separate from the back office. Confirmed against the real code
// (quickvee-admin-panel OwnerPortal + Reporting/OwnerReport; quickvee-e2e-api
// owner_portal.py):
//   - login UI /merchants/owner/login: input[type=email], input[type=password],
//     button "Login"; token stored in localStorage.ownerPortalToken.
//   - data: POST {REPORTS_BASE}api/owner-portal/report (JSON: outlet_ids,
//     start_date?, end_date?) with Bearer token -> { status, stores:[{merchant_id,
//     figures, status, attention, managers}], total, managers, attention,
//     settings, start_date, end_date, days, counts }.
// READ ONLY: logs in, reads the report, replays the read-only report call.
// Never retries a wrong password (5 fails lock the account for 15 min) and
// never saves settings (a write).
const REPORT_URL = /\/api\/owner-portal\/report(\b|$)/;
const LOGIN_URL = /\/api\/owner-portal\/login(\b|$)/;

const text = (el) => (el ? el.innerText || el.textContent || "" : "").replace(/\s+/g, " ").trim();
const parseBody = (b) => (typeof b === "string" ? Cypress._.attempt(JSON.parse, b) : b);

class OwnerPortalPage {
  // Records answered report calls: { fields, url, headers, status, body }.
  recordReport(calls) {
    cy.intercept({ method: "POST", url: REPORT_URL }, (req) => {
      const entry = { fields: typeof req.body === "object" ? { ...req.body } : parseBody(req.body) || {}, url: req.url, headers: { ...req.headers } };
      req.on("after:response", (res) => {
        entry.status = res.statusCode;
        entry.body = parseBody(res.body);
        calls.push(entry);
      });
    }).as("ownerReport");
    cy.intercept({ method: "POST", url: LOGIN_URL }).as("ownerLogin");
  }

  // UI sign-in. Yields after the dashboard's first report call answers.
  loginViaUi(email, password) {
    cy.visit("/merchants/owner/login");
    cy.get("input[type=email]", { timeout: 30000 }).should("be.visible").clear().type(email);
    cy.get("input[type=password]", { timeout: 15000 }).clear().type(password, { log: false });
    cy.contains("button", /^\s*Login\s*$/, { timeout: 10000 }).click();
    cy.wait("@ownerLogin", { timeout: 30000 }).then(({ response }) => {
      const body = parseBody(response && response.body) || {};
      expect(response && response.statusCode, `owner login (${JSON.stringify(body.detail || body.message || "")})`).to.equal(200);
      expect(body.token, "login returned a token").to.be.a("string").and.not.be.empty;
    });
    return cy.wait("@ownerReport", { timeout: 60000 }).then(({ response }) => parseBody(response && response.body));
  }

  reportVisible() {
    return cy.get(".df-table, [class*='df-']", { timeout: 30000 }).should("exist");
  }

  summaryText() {
    return cy.get("body").then(($b) => text($b.find("main")[0] || $b[0]));
  }

  // The portal API base, derived from a captured report call.
  base(call) {
    return call.url.replace(/\/report(\?.*)?$/, "");
  }

  // POST to another portal endpoint (/me, /settings) with the captured token.
  // Yields { status, body }. Used for the settings CRUD checks.
  post(call, path, body = {}) {
    const headers = { "Content-Type": "application/json" };
    if (call.headers.authorization) headers.Authorization = call.headers.authorization;
    return cy
      .request({ method: "POST", url: `${this.base(call)}${path}`, headers, body, timeout: 60000, failOnStatusCode: false, log: false })
      .then((res) => ({ status: res.status, body: parseBody(res.body) || {} }));
  }

  // Read-only replay of the report call with `overrides` (outlet_ids,
  // start_date, end_date). Yields { status, body }.
  replay(call, overrides = {}) {
    const headers = { "Content-Type": "application/json" };
    if (call.headers.authorization) headers.Authorization = call.headers.authorization;
    return cy
      .request({ method: "POST", url: call.url, headers, body: { ...call.fields, ...overrides }, timeout: 120000, failOnStatusCode: false, log: false })
      .then((res) => ({ status: res.status, body: parseBody(res.body) || {} }));
  }
}

module.exports = new OwnerPortalPage();
