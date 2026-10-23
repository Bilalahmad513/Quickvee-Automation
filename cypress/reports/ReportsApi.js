const REPORT_DEFINITIONS = require("./reportDefinitions");

const REPORTS_API = "https://reports-api.quickvee.us/api/reports";

// Sent by the app with every reports-api call - they identify the logged-in
// user/session, not the report being asked for.
const LOGIN_FIELDS = [
  "token_id",
  "login_type",
  "login_user_type",
  "session_id",
  "login_merchant_id",
  "login_user_email",
];

function parseMultipart(body, contentType) {
  const boundary = contentType.split("boundary=")[1];
  const fields = {};
  body.split(`--${boundary}`).forEach((part) => {
    const match = part.match(/name="([^"]+)"\r?\n\r?\n([\s\S]*?)\r?\n$/);
    if (match) fields[match[1]] = match[2];
  });
  return fields;
}

// The API rejects anything but multipart/form-data, same as the storefront's
// product-listing API (see StorefrontPage.fetchNewestProducts).
function buildMultipart(fields) {
  const boundary = "----CypressBoundary" + Date.now() + Cypress._.random(0, 99999);
  const body =
    Object.entries(fields)
      .map(([key, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`)
      .join("") + `--${boundary}--\r\n`;
  return { boundary, body };
}

// Report APIs return money both as numbers (303) and strings ("303.00").
function toAmount(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : Math.round(n * 100) / 100;
}

class ReportsApi {
  // The bearer token and login fields live in the app's own runtime state,
  // not anywhere stable to read directly - so this lets the real dashboard
  // page make its own reports-api call once (for whichever store the session
  // is currently inside) and copies the auth + store id from that request.
  captureContext() {
    cy.intercept("POST", `${REPORTS_API}/dashboard`).as("reportsContext");
    cy.visit("/merchants/dashboard");
    return cy.wait("@reportsContext", { timeout: 30000 }).then(({ request }) => {
      const fields = parseMultipart(request.body, request.headers["content-type"]);
      return {
        authorization: request.headers.authorization,
        merchantId: fields.merchant_id,
        loginFields: Cypress._.pick(fields, LOGIN_FIELDS),
      };
    });
  }

  fetch(reportName, context, range) {
    const definition = REPORT_DEFINITIONS[reportName];
    const { boundary, body } = buildMultipart({
      merchant_id: context.merchantId,
      outlet_ids: context.merchantId,
      start_date: range.startDate,
      end_date: range.endDate,
      ...definition.extraFields(range),
      ...context.loginFields,
    });

    return cy
      .request({
        method: "POST",
        url: `${REPORTS_API}/${definition.endpoint}`,
        headers: {
          Authorization: context.authorization,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body,
      })
      .then((res) => {
        expect(res.body.status, `${reportName} API status`).to.equal(true);
        if (definition.reportedRange) {
          expect(definition.reportedRange(res.body), `${reportName} API's own reported date range`).to.deep.equal({
            startDate: range.startDate,
            endDate: range.endDate,
          });
        }
        return res.body;
      });
  }

  // Fetches every report the mappings need exactly once for this range, then
  // evaluates all mappings against those responses. Returns one row per
  // mapping instead of asserting, so a run reports every mismatch at once
  // rather than stopping at the first.
  reconcile(context, range, mappings) {
    const reportNames = Cypress._.uniq(mappings.flatMap((m) => [m.left.report, m.right.report]));
    const bodies = {};

    reportNames.forEach((name) => {
      this.fetch(name, context, range).then((body) => {
        bodies[name] = body;
      });
    });

    return cy.then(() =>
      mappings.map((mapping) => {
        const leftRaw = Cypress._.get(bodies[mapping.left.report], mapping.left.path);
        const rightRaw = Cypress._.get(bodies[mapping.right.report], mapping.right.path);
        const left = toAmount(leftRaw);
        const right = toAmount(rightRaw);
        return {
          range,
          leftLabel: mapping.left.label,
          rightLabel: mapping.right.label,
          left,
          right,
          leftRaw,
          rightRaw,
          match: left !== null && right !== null && left === right,
        };
      })
    );
  }
}

module.exports = new ReportsApi();
