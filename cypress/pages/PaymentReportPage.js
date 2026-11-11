const { parseMultipart, buildMultipart } = require("../support/multipart");

// Reporting > Payment Report ("payment-report-new"). Confirmed against the
// real code (quickvee-admin-panel PaymentReport*):
//   - Order Source custom dropdown (.custom-dropdown-header) with options
//     "In-Store" (order_env=3) / "Online" (order_env=2);
//   - date filter reuses button.qv-date-filter__quick ("Today" ...), active
//     one has .is-active;
//   - table (CommonTable) columns: Name, Sales Count, Sales Amount, Return
//     Count, Return Amount, Net Tendered, with a "Total" footer row.
// Data: POST {BASE}Sale_summary_api/payment_report (multipart: start_date,
// end_date, order_env, merchant_id, token_id, login_type) -> { status,
// result: { <tender>: { collected, transactions, refunds,
// collected_transaction, refund_transaction } } }.
// The "-new" page is fact-table backed (reports-migrations-api .../api/
// reports/payment_report_fact), not the legacy PHP Sale_summary_api. Same
// result shape: result[<tender>] = { collected, transactions, refunds,
// collected_transaction, refund_transaction }, plus a server-side `totals`
// (incl. net_tendered) that the panel ignores and recomputes client-side.
const REPORT_URL = /\/api\/reports\/payment_report_fact/;
const ORDER_ENV = { "In-Store": "3", Online: "2" };

const text = (el) => (el ? el.innerText || el.textContent || "" : "").replace(/\s+/g, " ").trim();
const parseBody = (b) => (typeof b === "string" ? Cypress._.attempt(JSON.parse, b) : b);

class PaymentReportPage {
  // Keeps every answered payment_report call in `calls`:
  // { fields, url, headers, status, body }. Register before visit().
  recordCalls(calls) {
    cy.intercept({ method: "POST", url: REPORT_URL }, (req) => {
      const fields = parseMultipart(req.body, req.headers["content-type"]) || {};
      const entry = { fields, url: req.url, headers: { ...req.headers }, at: Date.now() };
      req.on("after:response", (res) => {
        entry.status = res.statusCode;
        entry.body = parseBody(res.body);
        calls.push(entry);
      });
    });
  }

  visit(reportPath) {
    cy.visit(reportPath);
    // Let the report mount and fire its first payment_report call, then dump
    // the real DOM once so selectors can be adjusted without guessing.
    cy.wait(6000, { log: false });
    return cy.then(() => {
      const heads = Cypress.$("h1,h2,.heading").toArray().map(text).filter(Boolean).slice(0, 8);
      const ths = Cypress.$("th,thead td").toArray().map(text).filter(Boolean).slice(0, 14);
      const btns = Cypress.$("button").toArray().map(text).filter(Boolean).slice(0, 40);
      const srcEls = Cypress.$("*")
        .toArray()
        .filter((e) => e.children.length === 0 && /^(In-Store|Online)$/i.test((e.textContent || "").trim()))
        .map((e) => `${e.tagName}.${(e.className || "").toString().split(" ")[0]}`)
        .slice(0, 6);
      const selects = Cypress.$("select,[role='combobox'],[role='button'],.MuiSelect-select,.custom-dropdown-header").toArray().map((e) => `${e.tagName}.${(e.className || "").toString().split(" ")[0]}`).slice(0, 10);
      cy.task("log", `[report DOM] path=${reportPath} headings=${JSON.stringify(heads)} ths=${JSON.stringify(ths)}`, { log: false });
      cy.task("log", `[report DOM] source-els=${JSON.stringify(srcEls)} selects=${JSON.stringify(selects)} buttons=${JSON.stringify(btns)}`, { log: false });
    });
  }

  // Order Source is a MUI Select (.MuiSelect-select); pick "In-Store"/"Online".
  selectSource(label) {
    cy.get(".MuiSelect-select", { timeout: 20000 }).first().click();
    cy.contains('[role="listbox"] [role="option"], [role="option"]', new RegExp(`^\\s*${label}\\s*$`), { timeout: 10000 }).click();
    return cy.wrap(label, { log: false });
  }

  // Click the "Today" quick button if not already active, then "Search".
  pickToday() {
    cy.contains("button.qv-date-filter__quick", /^\s*Today\s*$/, { timeout: 20000 }).then(($b) => {
      if (!$b.hasClass("is-active")) cy.wrap($b).click();
    });
    return cy.contains("button", /^\s*Search\s*$/, { timeout: 10000 }).click();
  }

  // The latest answered payment_report call after calls[from] with order_env.
  waitForCall(calls, from, orderEnv, describe) {
    return cy
      .wrap(calls, { log: false, timeout: 60000 })
      .should((list) => {
        expect(list.slice(from).some((c) => String(c.fields.order_env) === String(orderEnv) && c.status), `payment_report for ${describe}`).to.equal(true);
      })
      .then((list) => Cypress._.findLast(list.slice(from), (c) => String(c.fields.order_env) === String(orderEnv) && c.status));
  }

  // { headers, rows: [{cells}], total } from the on-screen table.
  readTable() {
    return cy.get("body").then(() => {
      const $th = Cypress.$("th,td").filter((_, el) => text(el) === "Net Tendered").first();
      if (!$th.length) return { headers: [], rows: [], total: null, noData: /No Data/i.test(Cypress.$("main,body").text()) };
      const $table = $th.closest("table");
      const headers = $table.find("thead th, thead td").toArray().map(text);
      const bodyRows = $table.find("tbody tr").toArray().map((tr) => Cypress.$(tr).children("td,th").toArray().map(text));
      const footRows = $table.find("tfoot tr").toArray().map((tr) => Cypress.$(tr).children("td,th").toArray().map(text));
      // The "Total" row may be the last tbody row (CommonTable renders the
      // footer inside the body in some variants) or in tfoot.
      const all = [...bodyRows, ...footRows];
      const totalIdx = all.findIndex((c) => /^total$/i.test((c[0] || "").trim()));
      const toObj = (cells) => ({ name: cells[0], salesCount: cells[1], salesAmount: cells[2], returnCount: cells[3], returnAmount: cells[4], netTendered: cells[5] });
      return {
        headers,
        rows: all.filter((c, i) => i !== totalIdx && c.length >= 6 && !/^no data/i.test((c[0] || ""))).map(toObj),
        total: totalIdx >= 0 ? toObj(all[totalIdx]) : null,
        noData: /No Data/i.test(Cypress.$("main,body").text()),
      };
    });
  }

  // Read-only replay of the page's own request with `overrides` (order_env,
  // start_date, end_date). Yields { status, result }.
  replay(call, overrides = {}) {
    const fields = { ...call.fields, ...overrides };
    const multipart = buildMultipart(fields);
    const headers = { "Content-Type": `multipart/form-data; boundary=${multipart.boundary}` };
    if (call.headers.authorization) headers.Authorization = call.headers.authorization;
    return cy
      .request({ method: "POST", url: call.url, headers, body: multipart.body, timeout: 120000, failOnStatusCode: false, log: false })
      .then((res) => {
        const body = parseBody(res.body) || {};
        return { status: res.status, result: body.result || {}, totals: body.totals || null, body };
      });
  }
}

module.exports = new PaymentReportPage();
module.exports.ORDER_ENV = ORDER_ENV;
