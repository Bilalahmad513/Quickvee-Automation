const REPORT_DEFINITIONS = require("./reportDefinitions");

const REPORTS_API = "https://reports-api.quickvee.us/api/reports";

// Large stores over long ranges (e.g. a year) can take the API longer than
// cy.request's default 30s - confirmed live a location-sales-fact call that
// never answered within 30s, then passed on retry.
const REQUEST_TIMEOUT = 60000;

// Gives every dashboardViewAfter() its own intercept alias.
let dashboardCallCounter = 0;

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

// The multipart APIs reject anything but multipart/form-data, same as the
// storefront's product-listing API (see StorefrontPage.fetchNewestProducts).
function buildMultipart(fields) {
  const boundary = "----CypressBoundary" + Date.now() + Cypress._.random(0, 99999);
  const body =
    Object.entries(fields)
      .map(([key, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`)
      .join("") + `--${boundary}--\r\n`;
  return { boundary, body };
}

// The JSON-bodied APIs (location report) send the same login fields plus
// `email` and `token`, with token_id as a number - confirmed live that
// `token` is the bearer token without its "Bearer " prefix and `email` is the
// login email.
function jsonLoginFields(context) {
  return {
    ...context.loginFields,
    token_id: Number(context.loginFields.token_id),
    email: context.loginFields.login_user_email,
    token: context.authorization.replace(/^Bearer\s+/i, ""),
  };
}

// Report APIs return money both as numbers (303) and strings ("303.00").
// Rounds to 2 decimals; "+ 0" turns -0 (e.g. 0 / -1) into a plain 0.
function toAmount(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : Math.round(n * 100) / 100 + 0;
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

  // This store's {id, name, city, state} entry, from the same locations list
  // the Location Report page loads for its store picker. Looked up once per
  // store and kept on the context.
  ensureLocation(context) {
    if (context.location) return cy.wrap(context.location, { log: false });
    return cy
      .request({
        method: "POST",
        timeout: REQUEST_TIMEOUT,
        url: `${REPORTS_API}/location-sales/locations`,
        qs: { merchant_id: context.merchantId },
        headers: { Authorization: context.authorization },
        body: { merchant_id: context.merchantId, ...jsonLoginFields(context) },
      })
      .then((res) => {
        const locations = Cypress._.get(res.body, "data.locations") || [];
        const location = Cypress._.find(locations, { id: context.merchantId });
        // Says what the API actually returned, so a miss can be diagnosed.
        const returned = `HTTP ${res.status}, status "${res.body && res.body.status}", source "${Cypress._.get(res.body, "data.source")}", ids [${locations.map((l) => l.id).join(", ")}]`;
        expect(location, `location entry for store ${context.merchantId} (API returned ${returned})`).to.exist;
        context.location = location;
        return location;
      });
  }

  fetch(reportName, context, range) {
    const definition = REPORT_DEFINITIONS[reportName];
    const before = definition.needsLocation ? this.ensureLocation(context) : cy.wrap(null, { log: false });

    return before
      .then(() => {
        const args = { context, range };
        const url = `${REPORTS_API}/${definition.endpoint}`;

        if (definition.format === "json") {
          return cy.request({
            method: "POST",
            timeout: REQUEST_TIMEOUT,
            url,
            qs: definition.query(args),
            headers: { Authorization: context.authorization },
            body: { merchant_id: context.merchantId, ...jsonLoginFields(context), ...definition.fields(args) },
          });
        }

        const { boundary, body } = buildMultipart({
          merchant_id: context.merchantId,
          outlet_ids: context.merchantId,
          start_date: range.startDate,
          end_date: range.endDate,
          ...definition.fields(args),
          ...context.loginFields,
        });
        return cy.request({
          method: "POST",
          timeout: REQUEST_TIMEOUT,
          url,
          headers: {
            Authorization: context.authorization,
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
          },
          body,
        });
      })
      .then((res) => {
        expect(definition.ok(res.body), `${reportName} API status`).to.equal(true);
        if (definition.reportedRange) {
          expect(definition.reportedRange(res.body), `${reportName} API's own reported date range`).to.deep.equal({
            startDate: range.startDate,
            endDate: range.endDate,
          });
        }
        if (definition.reportedLocations) {
          expect(definition.reportedLocations(res.body), `${reportName} API's own reported stores`).to.deep.equal([
            context.merchantId,
          ]);
        }
        return res.body;
      });
  }

  // Fetches each named report once for this range; yields { reportName: body }.
  fetchAll(context, range, reportNames) {
    const bodies = {};
    Cypress._.uniq(reportNames).forEach((name) => {
      this.fetch(name, context, range).then((body) => {
        bodies[name] = body;
      });
    });
    return cy.then(() => bodies);
  }

  // Evaluates each mapping's group of values (which must all be equal)
  // against one fetch of every report they need. Returns one row per mapping
  // instead of asserting, so a run reports every mismatch at once rather than
  // stopping at the first. On a mismatch, the values that differ from the
  // most common amount are flagged, which points at the odd report out.
  reconcile(context, range, mappings) {
    const reportNames = mappings.flatMap((m) => m.values.map((v) => v.report));

    return this.fetchAll(context, range, reportNames).then((bodies) =>
      mappings.map((mapping) => {
        const values = mapping.values.map((v) => {
          const raw = v.compute ? v.compute(bodies[v.report]) : Cypress._.get(bodies[v.report], v.path);
          return { label: v.label, raw, amount: toAmount(raw) };
        });

        const amounts = values.map((v) => v.amount);
        // Compared in whole cents so float noise can't matter. A mapping's
        // optional `tolerance` (in dollars) lets values that far apart count
        // as a match - the row still says so, so the gap stays visible.
        const allPresent = amounts.every((a) => a !== null);
        const spreadCents = allPresent ? Math.round((Math.max(...amounts) - Math.min(...amounts)) * 100) : null;
        const match = allPresent && spreadCents <= Math.round((mapping.tolerance || 0) * 100);
        const withinTolerance = match && spreadCents > 0;

        if (!match) {
          const counts = Cypress._.countBy(amounts.filter((a) => a !== null));
          const mostCommon = Number(Cypress._.maxBy(Object.keys(counts), (k) => counts[k]));
          values.forEach((v) => {
            v.differs = v.amount === null || v.amount !== mostCommon;
          });
        }

        return {
          kind: "group",
          range,
          label: mapping.label,
          format: mapping.format,
          values,
          match,
          withinTolerance,
          tolerance: mapping.tolerance,
        };
      })
    );
  }

  // Fetches the reports the formula checks need, then evaluates them.
  checkFormulas(context, range, checks) {
    return this.fetchAll(context, range, checks.map((c) => c.report)).then((bodies) =>
      this.evaluateFormulas(bodies, range, checks)
    );
  }

  // Evaluates each formula check (see formulaChecks.js) against responses
  // already in hand ({ reportName: body }): computes the expected value from
  // the report's own inputs and compares it with the value the report shows,
  // both at 2 decimals. Returns one row per check.
  evaluateFormulas(bodies, range, checks) {
    return checks.map((check) => {
      const body = bodies[check.report];
      const inputs = Cypress._.map(check.inputs, (input, name) => {
        const raw = Cypress._.get(body, input.path);
        return { name, label: input.label, format: input.format, raw, amount: toAmount(raw) };
      });

      const missingInput = inputs.some((i) => i.amount === null);
      const expected = missingInput
        ? null
        : toAmount(check.compute(Cypress._.fromPairs(inputs.map((i) => [i.name, i.amount]))));
      const actualRaw = Cypress._.get(body, check.actual.path);
      const actual = toAmount(actualRaw);
      const match = expected !== null && actual !== null && expected === actual;

      return {
        kind: "formula",
        range,
        label: check.label,
        format: check.format,
        inputs,
        display: check.display,
        expected,
        actual: { label: check.actual.label, raw: actualRaw, amount: actual },
        match,
      };
    });
  }

  // Runs `trigger` (a page load or click on the dashboard page) and yields
  // the response of the dashboard call it caused that isWanted(requestFields,
  // responseBody) accepts - so a test can drive the page's own Day/Week/
  // Month/Previous controls and check exactly the data each view loaded.
  //
  // Each trigger gets its own fresh intercept alias, registered right before
  // it: confirmed live that with one shared alias, calls left over from
  // earlier steps (a click can fire more than one) piled up and got picked
  // up instead of the new one. A few non-matching calls are still skipped,
  // since one action can fire more than one call.
  dashboardViewAfter(trigger, isWanted, describe) {
    dashboardCallCounter += 1;
    const alias = `dashboardView${dashboardCallCounter}`;
    cy.intercept("POST", `${REPORTS_API}/dashboard`).as(alias);
    trigger();
    return this.waitForMatchingCall(alias, isWanted, describe, 5);
  }

  waitForMatchingCall(alias, isWanted, describe, attemptsLeft) {
    return cy.wait(`@${alias}`, { timeout: 30000 }).then(({ request, response }) => {
      const fields = parseMultipart(request.body, request.headers["content-type"]);
      if (isWanted(fields, response.body)) return response.body;
      if (attemptsLeft > 1) return this.waitForMatchingCall(alias, isWanted, describe, attemptsLeft - 1);
      throw new Error(`No dashboard call for ${describe} (last one was activeType "${fields.activeType}", ${fields.start_date} to ${fields.end_date}).`);
    });
  }
}

module.exports = new ReportsApi();
