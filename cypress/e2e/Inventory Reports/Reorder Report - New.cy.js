const reorderPage = require("../../pages/ReorderReportNewPage");
const { enterQaStore } = require("../../support/qaStoreEntry");
const { injectLogStyles } = require("../../reports/reconciliationReport");
const { buildQaReorderHtml, formatCheckLine, statusText } = require("../../reports/qaReorderReportHtml");

// QA Testing - Reorder Report - New, on quickvee-qa.com, store VEON01
// (HAM683004NC). READ ONLY: nothing is created, edited, deleted or
// exported - the suite only opens the report, changes its filters, reads
// the screen and replays the report's own read requests.
//
// Login: super admin from cypress.env.json (qaStoreName / qaUsername /
// qaPassword). The cache is cleared first (cookies, local / session storage).
// The store is searched in Inactive Stores, then Live Stores, and opened by
// the eye icon of the row whose Merchant ID is HAM683004NC.
//
// What is checked (each check Pass / Fail / Info, written to
// cypress/e2e/reports/QA Testing - Reorder Report.html):
//   - the right store and page; the request each filter sends;
//   - every row of every date range (all rows fetched, not just the 12 the
//     table shows): row formulas against the column help texts, totals,
//     duplicates, data integrity;
//   - the table (rows and Total row) against the data;
//   - lazy loading, search (normal, case, spaces, special characters,
//     wildcards, injection text), Measure and Report Type filters, rapid
//     filter switching, an invalid custom date range, labels and help texts.
const STORE = { name: "VEON01", searchName: "Veon01", id: "HAM683004NC" };
const REPORT_FILE = "cypress/e2e/reports/QA Testing - Reorder Report.html";
const RANGES = ["Today", "Yesterday", "Last 7 Days", "Last 30 Days"];

// Table header -> API field and how the cell is shown.
const COLUMNS = {
  "Closing Inventory": ["closing_inventory", "num"],
  "Items Sold per Day": ["items_sold_per_day", "num"],
  "Items Sold": ["items_sold", "num"],
  "Inbound Inventory": ["inbound_inventory", "num"],
  "Average Cost": ["avg_cost", "num"],
  "Net sale": ["net_sale", "num"],
  "Gross profit": ["gross_profit", "num"],
  "Margin (%)": ["margin", "num"],
  "Customer count": ["customer_count", "num"],
  "Sale count": ["sale_count", "num"],
  "Avg. items per sale": ["avg_items_per_sale", "num"],
  "Discounted (%)": ["sale_discounted", "num"],
  "Avg. sale value": ["avg_sale_value", "num"],
  "Cost of goods sold": ["cost_goods_sold", "num"],
  "Retail value (excl. tax)": ["retail_value", "num"],
  "Current inventory": ["current_inventory", "num"],
  "Start date inventory": ["start_date_inventory", "num"],
  "Reorder point": ["reorder_point", "num"],
  "Restock amount": ["restock_amount", "num"],
  "Return count": ["return_count", "num"],
  "Returns (%)": ["returns_percentage", "num"],
  "Inventory cost": ["inventory_cost", "num"],
  "Sell-through rate": ["sell_through_rate", "num"],
  "Discount value": ["discount_value", "num"],
  Created: ["created", "text"],
  "First sale": ["first_sale", "text"],
  "Last sale": ["last_sale", "text"],
  "Last received": ["last_received", "text"],
};
// Total row header -> totals field.
const TOTAL_COLUMNS = {
  "Closing Inventory": "closing_inventory",
  "Items Sold": "items_sold",
  "Inbound Inventory": "inbound_inventory",
  "Net sale": "net_sale",
  "Gross profit": "gross_profit",
  "Customer count": "customer_count",
  "Sale count": "sale_count",
  "Cost of goods sold": "cost_goods_sold",
  "Retail value (excl. tax)": "retail_value",
  "Current inventory": "current_inventory",
  "Return count": "return_count",
  "Inventory cost": "inventory_cost",
  "Discount value": "discount_value",
};
// Totals the rows should add up to (customer_count is unique customers -
// not additive, checked as Info).
const ADDITIVE_TOTALS = ["items_sold", "closing_inventory", "current_inventory", "inbound_inventory", "net_sale", "gross_profit", "sale_count", "cost_goods_sold", "inventory_cost", "return_count", "discount_value", "retail_value"];

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const mdy = (d) => `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
function rangeDates(label, now = new Date()) {
  const daysAgo = (n) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - n);
  const r = { Today: [0, 0], Yesterday: [1, 1], "Last 7 Days": [6, 0], "Last 30 Days": [29, 0] }[label];
  return { start: ymd(daysAgo(r[0])), end: ymd(daysAgo(r[1])), startMdy: mdy(daysAgo(r[0])), endMdy: mdy(daysAgo(r[1])), days: r[0] - r[1] + 1, endsToday: r[1] === 0 };
}

const num = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[$,%\s]/g, "");
  if (s === "" || s === "-" || s === "—") return null;
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
};
const n0 = (v) => num(v) ?? 0;
const round2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
const close = (a, b, tol = 0.011) => a !== null && b !== null && Math.abs(a - b) <= tol;
const lower = (s) => String(s ?? "").toLowerCase();
const keyOf = (r) => `${r.product_id}|${r.variant || ""}`;
const label = (r) => `${r.name}${r.variant && !String(r.name).includes(r.variant) ? ` / ${r.variant}` : ""} (#${r.product_id})`;

describe("QA Testing - Reorder Report - New", { baseUrl: "https://quickvee-qa.com", retries: 0, testIsolation: false, defaultCommandTimeout: 30000 }, () => {
  const checks = [];
  const calls = [];
  const data = {}; // range -> { call, totalsCall, rows, totals, dates }
  const runInfo = { superadminLogin: [], uncaught: [], alerts: [] };
  let entry = null;

  // Keeps one check and logs it.
  function check(area, name, fields) {
    const c = { area, name, ...fields };
    checks.push(c);
    Cypress.log({ name: c.status.toLowerCase(), displayName: statusText(c.status), message: `**${area}** · ${name}${c.status === "Fail" ? ` (${c.severity})` : ""}` });
    cy.task("log", formatCheckLine(c), { log: false });
  }

  // A formula over many rows: Pass when every applicable row matches.
  function formula(area, name, rows, { applies = () => true, expected, actual, tol = 0.011, severity = "Medium", how, fields = [], failIsInfo = false }) {
    const applicable = rows.filter(applies);
    const failing = applicable.filter((r) => !close(round2(expected(r)), num(actual(r)), tol));
    return check(area, name, {
      how,
      expected: `${applicable.length} of ${applicable.length} rows match`,
      actual: `${applicable.length - failing.length} of ${applicable.length} rows match`,
      status: failing.length ? (failIsInfo ? "Info" : "Fail") : "Pass",
      severity,
      details: failing.length ? `${failing.length} row(s) differ.` : applicable.length ? "" : "No applicable rows in this range.",
      examples: failing.slice(0, 15).map((r) => ({ product: label(r), ...Cypress._.pick(r, fields), "expected (rule)": round2(expected(r)), "report shows": actual(r) })),
    });
  }

  before(() => {
    injectLogStyles();
    Cypress.on("uncaught:exception", (err) => {
      runInfo.uncaught.push(String(err && err.message).slice(0, 300));
      return false;
    });
    Cypress.on("window:alert", (t) => runInfo.alerts.push(t));
    cy.intercept({ method: "POST", url: /\/Dashboard\/login_via_superadmin/ }, (req) => {
      const { parseMultipart } = require("../../support/multipart");
      const f = parseMultipart(req.body, req.headers["content-type"]);
      runInfo.superadminLogin.push({ merchant_id: f.merchant_id, sendsPassword: Boolean(f.password) });
    });
    // Clear cache, log in, open VEON01 by its merchant id.
    enterQaStore(STORE.searchName, STORE.id).then((found) => (entry = found));
  });

  // Intercepts are cleared before every test - record the report's calls
  // again each time (into the same list).
  beforeEach(() => {
    reorderPage.recordCalls(calls);
  });

  after(() => {
    if (runInfo.uncaught.length)
      checks.push({ area: "Stability", name: "No uncaught JavaScript errors on the page", expected: 0, actual: runInfo.uncaught.length, status: "Fail", severity: "Medium", examples: runInfo.uncaught.slice(0, 10).map((m) => ({ error: m })) });
    else checks.push({ area: "Stability", name: "No uncaught JavaScript errors on the page", expected: 0, actual: 0, status: "Pass" });
    const info = {
      Store: `${STORE.name} (${STORE.id})`,
      Environment: "https://quickvee-qa.com (QA)",
      Page: `https://quickvee-qa.com${reorderPage.PAGE_URL}`,
      "Store found in": entry ? `${entry.list} Stores (search "${entry.term}")` : "not found",
      "Date ranges tested": RANGES.join(", "),
      Operation: "Read only - nothing created, edited, deleted or exported",
      Generated: new Date().toLocaleString(),
    };
    cy.writeFile(REPORT_FILE, buildQaReorderHtml({ info, checks }));
    cy.task("log", `HTML report written to ${Cypress.config("projectRoot")}/${REPORT_FILE}`);
    const failed = checks.filter((c) => c.status === "Fail");
    cy.task("log", `QA Reorder Report: ${checks.length} checks, ${checks.filter((c) => c.status === "Pass").length} pass, ${failed.length} fail, ${checks.filter((c) => c.status === "Info").length} info`);
  });

  it("opens VEON01 (HAM683004NC) and the Reorder Report - New", () => {
    const area = "Store and page";
    cy.then(() => {
      check(area, "Store found by Merchant ID (Inactive Stores searched first, then Live Stores)", {
        expected: STORE.id,
        actual: entry ? `${STORE.id} in ${entry.list} Stores` : "not found",
        status: entry ? "Pass" : "Fail",
        severity: "High",
        details: entry && entry.notes.length ? `Searches before it was found: ${entry.notes.join("; ")}` : "",
      });
      const flaky = entry && entry.notes.some((n) => n.startsWith(`${entry.list} Stores`));
      check(area, "Store directory search finds the store on the first try", {
        how: `Searching ${entry ? entry.list : ""} Stores for "${STORE.searchName}" should list ${STORE.name} straight away.`,
        expected: "found on first search",
        actual: flaky ? `needed ${entry.notes.filter((n) => n.startsWith(`${entry.list} Stores`)).length + 1} searches` : "found on first search",
        status: flaky ? "Fail" : "Pass",
        severity: "Medium",
        details: flaky ? "Seen during this run: the same search returned other stores / \"No Data Found\" before it returned the store. Earlier exploration also saw \"Veon01\" match VEON015 first (a first-result click opens the wrong store)." : "",
      });
      const sw = runInfo.superadminLogin.find((l) => l.merchant_id === STORE.id);
      check(area, "Opening a store does not resend the super admin password", {
        how: "login_via_superadmin is sent when the eye icon opens a store.",
        expected: "no password field",
        actual: sw ? (sw.sendsPassword ? "password sent in the request body" : "no password field") : "call not seen",
        status: sw ? (sw.sendsPassword ? "Fail" : "Pass") : "Info",
        severity: "High",
        details: sw && sw.sendsPassword ? "The super admin password travels in the multipart body of every store switch (HTTPS, but it is stored in the front end and resent each time)." : "",
      });
    });

    const from = calls.length;
    reorderPage.visit();
    reorderPage.waitForCall(calls, from, "list", () => true, "page open").then((call) => {
      check(area, "Report asks for the selected store", { expected: STORE.id, actual: call.fields.merchant_id, status: call.fields.merchant_id === STORE.id ? "Pass" : "Fail", severity: "Critical" });
      check(area, "Report request answered", { expected: "HTTP 200, status true", actual: `HTTP ${call.status}, status ${call.body && call.body.status}`, status: call.status === 200 && call.body && call.body.status ? "Pass" : "Fail", severity: "Critical" });
    });
    cy.get(".qv-app-header__store-name, .qv-app-header", { timeout: 30000 }).first().then(($h) => {
      const shown = Cypress.$(".qv-app-header").text();
      check(area, "Header shows the store", { expected: STORE.name, actual: shown.includes(STORE.name) ? STORE.name : shown.replace(/\s+/g, " ").slice(0, 80), status: shown.includes(STORE.name) ? "Pass" : "Fail", severity: "High" });
    });
    cy.contains(".MuiSelect-select", /Reorder Report - New/).then(($s) =>
      check(area, "Report selector shows \"Reorder Report - New\"", { expected: "Reorder Report - New", actual: $s.text().trim(), status: "Pass" })
    );
    reorderPage.selectOptions("Reorder Report - New").then((options) =>
      check(area, "Report selector options", { expected: "list of inventory reports", actual: options.join(", "), status: "Info", details: "\"Reorder Report\" and \"Reorder Report - New\" are both offered - two versions of the same report side by side." })
    );
  });

  it("shows every column (column picker) and checks labels and help texts", () => {
    const area = "Columns and labels";
    reorderPage.readColumnPicker().then((lines) => {
      const helpText = lines.join(" | ");
      const typo = /solid items/i.test(helpText);
      check(area, "Help text spelling (Sell-Through Rate)", { expected: "\"Percentage of sold items...\"", actual: typo ? "\"Percentage of solid items out of all items available to be sold\"" : "no typo", status: typo ? "Fail" : "Pass", severity: "Low" });
    });
    reorderPage.showAllColumns();
    reorderPage.readTable().then((t) => {
      const headers = t.headers.filter(Boolean);
      const missing = Object.keys(COLUMNS).filter((h) => !headers.includes(h));
      check(area, "Every column can be shown", { expected: `${Object.keys(COLUMNS).length + 1} columns`, actual: `${headers.length} columns`, status: missing.length ? "Fail" : "Pass", severity: "Medium", details: missing.length ? `Missing: ${missing.join(", ")}` : headers.join(", ") });
      const label1 = headers.includes("Discounted (%)");
      check(area, "Column name matches the column picker", { how: "Picker: \"Discount (%)\"", expected: "Discount (%)", actual: label1 ? "Discounted (%)" : "Discount (%)", status: label1 ? "Fail" : "Pass", severity: "Low" });
      const titleCase = headers.filter((h) => /^[A-Z][a-z]+ [A-Z]/.test(h));
      const sentenceCase = headers.filter((h) => /^[A-Z][a-z.]+ [a-z]/.test(h));
      check(area, "Column names use one capitalisation style", {
        expected: "one style",
        actual: `${titleCase.length} Title Case, ${sentenceCase.length} Sentence case`,
        status: titleCase.length && sentenceCase.length ? "Fail" : "Pass",
        severity: "Low",
        details: `Title Case: ${titleCase.join(", ")} · Sentence case: ${sentenceCase.join(", ")}`,
      });
    });
  });

  RANGES.forEach((range) => {
    it(`${range}: request, every row, formulas, totals and the table`, () => {
      const area = range;
      const dates = rangeDates(range);
      // From the first call: the page opens on Today, so clicking Today
      // again may send nothing new - the latest call for the range is used.
      const from = 0;
      reorderPage.quickDate(range).click();
      reorderPage
        .waitForCall(calls, from, "list", (f) => f.start_date === dates.start && f.end_date === dates.end && String(f.page) === "1" && !f.search_by, `${range} page 1`)
        .then((call) => {
          data[range] = { call, dates };
          check(area, "Dates sent", { expected: `${dates.start} to ${dates.end}`, actual: `${call.fields.start_date} to ${call.fields.end_date}`, status: "Pass" });
          check(area, "Store sent", { expected: STORE.id, actual: `merchant_id ${call.fields.merchant_id}, outlet_ids ${call.fields.outlet_ids ?? "(none)"}`, status: call.fields.merchant_id === STORE.id ? "Pass" : "Fail", severity: "Critical" });
          return reorderPage.waitForCall(calls, from, "totals", (f) => f.start_date === dates.start && f.end_date === dates.end && !f.search_by, `${range} totals`);
        })
        .then((totalsCall) => {
          data[range].totals = (totalsCall.body && totalsCall.body.totals) || {};
          data[range].totalsRecords = Number(totalsCall.body && totalsCall.body.total_records);
          return reorderPage.fetchAllRows(data[range].call, {}, 100);
        })
        .then(({ rows, total, pages }) => {
          const d = data[range];
          d.rows = rows;
          d.total = total;
          cy.task("log", `[${range}] ${rows.length} rows fetched in ${pages} pages (total_records ${total})`, { log: false });

          // Integrity.
          check(area, "All rows fetched = total_records", { expected: total, actual: rows.length, status: rows.length === total ? "Pass" : "Fail", severity: "High" });
          check(area, "List and totals agree on the row count", { expected: total, actual: d.totalsRecords, status: total === d.totalsRecords ? "Pass" : "Fail", severity: "Medium" });
          const dupes = Object.entries(Cypress._.groupBy(rows, keyOf)).filter(([, g]) => g.length > 1);
          check(area, "Each product / variant listed once", {
            expected: 0,
            actual: dupes.length,
            status: dupes.length ? "Fail" : "Pass",
            severity: "High",
            examples: dupes.slice(0, 10).map(([k, g]) => ({ "product_id|variant": k, times: g.length, names: g.map((r) => r.name).join(" / ") })),
          });
          const foreign = rows.filter((r) => r.merchant_id && r.merchant_id !== STORE.id);
          check(area, "Every row belongs to the store", { expected: 0, actual: foreign.length, status: foreign.length ? "Fail" : "Pass", severity: "Critical", examples: foreign.slice(0, 10).map((r) => ({ product: label(r), merchant_id: r.merchant_id })) });
          const blank = rows.filter((r) => !String(r.name || "").trim());
          check(area, "Every row has a product name", { expected: 0, actual: blank.length, status: blank.length ? "Fail" : "Pass", severity: "Medium", examples: blank.slice(0, 10).map((r) => ({ product_id: r.product_id, variant: r.variant })) });
          const negative = rows.filter((r) => n0(r.closing_inventory) < 0);
          check(area, "Products with negative closing inventory", {
            expected: "0 (or allowed by settings)",
            actual: negative.length,
            status: "Info",
            details: "Negative stock is shown as-is; Days Cover shows 0.00 for them and Retail value 0.",
            examples: negative.slice(0, 15).map((r) => ({ product: label(r), closing_inventory: r.closing_inventory, current_inventory: r.current_inventory })),
          });

          // Row formulas.
          const D = dates.days;
          formula(area, "Items Sold per Day = Items Sold ÷ days in range", rows, { expected: (r) => n0(r.items_sold) / D, actual: (r) => r.items_sold_per_day, severity: "High", how: `${D} day(s) in ${range}`, fields: ["items_sold"] });
          formula(area, "Gross profit = Net sale − Cost of goods sold", rows, { expected: (r) => n0(r.net_sale) - n0(r.cost_goods_sold), actual: (r) => r.gross_profit, severity: "High", fields: ["net_sale", "cost_goods_sold"] });
          formula(area, "Avg. sale value = Net sale ÷ Sale count", rows, { applies: (r) => n0(r.sale_count) > 0, expected: (r) => n0(r.net_sale) / n0(r.sale_count), actual: (r) => r.avg_sale_value, fields: ["net_sale", "sale_count"] });
          formula(area, "Avg. items per sale = Items sold ÷ Sale count", rows, { applies: (r) => n0(r.sale_count) > 0, expected: (r) => n0(r.items_sold) / n0(r.sale_count), actual: (r) => r.avg_items_per_sale, fields: ["items_sold", "sale_count"] });
          formula(area, "Discount (%) = Discount value ÷ total sale value before discount × 100", rows, {
            applies: (r) => n0(r.total_sales_value) > 0,
            expected: (r) => (n0(r.discount_value) / n0(r.total_sales_value)) * 100,
            actual: (r) => r.sale_discounted,
            how: "Help text: \"Average discount given on total sale value (excl. tax)\". The report divides by Net sale (after discount) instead, which overstates the discount.",
            fields: ["discount_value", "total_sales_value", "net_sale"],
          });
          formula(area, "Margin (%) = Gross profit ÷ Net sale × 100", rows, {
            applies: (r) => n0(r.net_sale) > 0,
            expected: (r) => (n0(r.gross_profit) / n0(r.net_sale)) * 100,
            actual: (r) => r.margin,
            how: "Help text: \"Percentage of revenue that you keep as gross profit\". The report shows the product's price-vs-cost margin instead, unrelated to the period's sales.",
            fields: ["gross_profit", "net_sale", "p_price", "avg_cost"],
          });
          formula(area, "Inventory cost = Closing inventory × Average cost", rows, {
            applies: (r) => n0(r.avg_cost) !== 0 || n0(r.inventory_cost) !== 0,
            expected: (r) => n0(r.closing_inventory) * n0(r.avg_cost),
            actual: (r) => r.inventory_cost,
            severity: "High",
            how: "Help text: \"Total value of inventory on hand using average cost\".",
            fields: ["closing_inventory", "avg_cost", "cost_goods_sold"],
          });
          const cogsCopies = rows.filter((r) => n0(r.inventory_cost) !== 0 && close(n0(r.inventory_cost), n0(r.cost_goods_sold)));
          check(area, "Inventory cost is a copy of Cost of goods sold", {
            expected: 0,
            actual: cogsCopies.length,
            status: cogsCopies.length ? "Fail" : "Pass",
            severity: "High",
            details: cogsCopies.length ? "Inventory cost equals COGS in these rows - it reports the cost of what was sold, not the value of stock on hand." : "",
            examples: cogsCopies.slice(0, 10).map((r) => ({ product: label(r), closing_inventory: r.closing_inventory, avg_cost: r.avg_cost, cost_goods_sold: r.cost_goods_sold, inventory_cost: r.inventory_cost })),
          });
          formula(area, "Retail value = Closing inventory (on hand) × Price", rows, {
            applies: (r) => n0(r.closing_inventory) > 0,
            expected: (r) => n0(r.closing_inventory) * n0(r.p_price),
            actual: (r) => r.retail_value,
            how: "Help text: \"Total value of inventory on hand using retail price\".",
            fields: ["closing_inventory", "start_date_inventory", "total_available_items", "p_price"],
          });
          formula(area, "Sell-through rate = Items sold ÷ (Start inventory + Received) × 100", rows, {
            applies: (r) => n0(r.start_date_inventory) + n0(r.received_qty) > 0,
            expected: (r) => (n0(r.items_sold) / (n0(r.start_date_inventory) + n0(r.received_qty))) * 100,
            actual: (r) => r.sell_through_rate,
            fields: ["items_sold", "start_date_inventory", "received_qty", "total_available_items"],
          });
          const strZero = rows.filter((r) => n0(r.items_sold) > 0 && n0(r.sell_through_rate) === 0);
          check(area, "Sell-through rate is not 0% for products that sold", {
            expected: 0,
            actual: strZero.length,
            status: strZero.length ? "Fail" : "Pass",
            severity: "Medium",
            details: strZero.length ? "Items were sold but the rate shows 0% (start inventory 0 or negative - the division is skipped)." : "",
            examples: strZero.slice(0, 10).map((r) => ({ product: label(r), items_sold: r.items_sold, start_date_inventory: r.start_date_inventory, total_available_items: r.total_available_items, sell_through_rate: r.sell_through_rate })),
          });
          formula(area, "Returns (%) = Return count ÷ Items sold × 100", rows, { applies: (r) => n0(r.items_sold) > 0, expected: (r) => (n0(r.return_count) / n0(r.items_sold)) * 100, actual: (r) => r.returns_percentage, severity: "Low", fields: ["return_count", "items_sold"] });
          formula(area, "Reorder point = the product's reorder level", rows, { expected: (r) => n0(r.p_reorder_level), actual: (r) => r.reorder_point, fields: ["p_reorder_level"] });
          formula(area, "Restock amount = the product's reorder quantity", rows, {
            expected: (r) => n0(r.p_reorder_qty),
            actual: (r) => r.restock_amount,
            how: "Help text: \"Default quantity ordered when added to a purchase order\" - that is the product's Reorder quantity.",
            fields: ["p_reorder_qty", "reorder_qty"],
          });
          if (dates.endsToday)
            formula(area, "Closing inventory = Current inventory (range ends today)", rows, { expected: (r) => n0(r.current_inventory), actual: (r) => r.closing_inventory, severity: "High", fields: ["current_inventory"] });
          formula(area, "Stock movement: Closing = Start − Sold + Received + Returns", rows, {
            expected: (r) => n0(r.start_date_inventory) - n0(r.items_sold) + n0(r.received_qty) + n0(r.total_returned_qty),
            actual: (r) => r.closing_inventory,
            failIsInfo: true,
            how: "Rows that differ had other stock changes (manual adjustments, stocktakes) in the range - shown for review, not as a failure.",
            fields: ["start_date_inventory", "items_sold", "received_qty", "total_returned_qty"],
          });
          const custOver = rows.filter((r) => n0(r.customer_count) > n0(r.sale_count));
          check(area, "Customer count ≤ Sale count", { expected: 0, actual: custOver.length, status: custOver.length ? "Fail" : "Pass", severity: "Low", examples: custOver.slice(0, 10).map((r) => ({ product: label(r), customer_count: r.customer_count, sale_count: r.sale_count })) });
          const badDates = rows.filter((r) => (r.firstSale && r.created_on && r.firstSale < r.created_on) || (r.firstSale && r.lastSale && r.lastSale < r.firstSale));
          check(area, "Dates in order: Created ≤ First sale ≤ Last sale", { expected: 0, actual: badDates.length, status: badDates.length ? "Fail" : "Pass", severity: "Low", examples: badDates.slice(0, 10).map((r) => ({ product: label(r), created: r.created_on, first_sale: r.firstSale, last_sale: r.lastSale })) });
          const apiDaysCover = rows.filter((r) => n0(r.items_sold) > 0 && n0(r.closing_inventory) > 0 && n0(r.days_cover) === 0);
          check(area, "API days_cover is filled for products that sold", { expected: 0, actual: apiDaysCover.length, status: apiDaysCover.length ? "Info" : "Pass", details: apiDaysCover.length ? "The API sends days_cover 0; the page works Days Cover out itself." : "" });

          // Totals.
          ADDITIVE_TOTALS.forEach((key) => {
            const sum = round2(rows.reduce((t, r) => t + n0(r[key]), 0));
            const shown = num(d.totals[key]);
            check(area, `Total ${key} = sum of all ${rows.length} rows`, { expected: sum, actual: shown, status: close(sum, shown, 0.05) ? "Pass" : "Fail", severity: "High" });
          });
          cy.writeFile(`cypress/reports-output/qa-reorder-${range.replace(/\s+/g, "-")}.json`, { dates, totals: d.totals, rows }, { log: false });
          // Which rows the totals actually add up: tried against items_sold
          // and closing_inventory.
          const sumOf = (list, k) => round2(list.reduce((t, r) => t + n0(r[k]), 0));
          const candidates = {
            "all rows": rows,
            "rows with closing inventory ≥ 0": rows.filter((r) => n0(r.closing_inventory) >= 0),
            "rows with closing inventory > 0": rows.filter((r) => n0(r.closing_inventory) > 0),
            "one row per product id (variants after the first left out)": Cypress._.uniqBy(rows, "product_id"),
            "products without variants only": rows.filter((r) => !r.variant),
          };
          const keys = ["items_sold", "closing_inventory", "net_sale"];
          const totalsDiffer = keys.some((k) => !close(sumOf(rows, k), num(d.totals[k]), 0.05));
          if (totalsDiffer) {
            const explains = Object.entries(candidates).filter(([, list]) => keys.every((k) => close(sumOf(list, k), num(d.totals[k]), 0.05))).map(([name]) => name);
            check(area, "Why the totals differ from the rows", {
              expected: keys.map((k) => `${k} ${d.totals[k]}`).join(", "),
              actual: Object.entries(candidates).map(([name, list]) => `${name}: ${keys.map((k) => sumOf(list, k)).join(" / ")}`).join(" · "),
              status: "Info",
              details: explains.length ? `The totals equal the sum of: ${explains.join("; ")} - the totals leave the other rows out while the table lists them.` : "No simple rule explains the difference - the totals come from a different calculation than the rows.",
            });
          }
          const custSum = rows.reduce((t, r) => t + n0(r.customer_count), 0);
          check(area, "Total customer_count (unique customers)", { expected: `≤ ${custSum} (sum of rows)`, actual: num(d.totals.customer_count), status: n0(d.totals.customer_count) <= custSum ? "Pass" : "Fail", severity: "Low" });
        });

      // The table against the data: the rows on screen are page 1 of the
      // page's own call; the Total row against the totals.
      cy.then(() => cy.wait(1500, { log: false }));
      reorderPage.readTable().then((t) => {
        const d = data[range];
        // The table loads more pages as it is scrolled (12 rows a page), so
        // its rows are compared with all rows, in the same order.
        const pageRows = d.rows;
        d.screen = t;
        const sameName = (shown, row) => row && lower(shown).replace(/ ~ /g, " - ") === lower(row.name);
        const misplaced = t.rows.filter((cells, i) => !sameName(cells[0], pageRows[i]));
        check(area, "Table rows are the report's rows, in order (loaded pages)", {
          expected: `${t.rows.length} rows in the report's order (at least ${Math.min(12, d.total)})`,
          actual: `${t.rows.length - misplaced.length} of ${t.rows.length} in order`,
          status: !misplaced.length && t.rows.length >= Math.min(12, d.total) && t.rows.length <= d.total ? "Pass" : "Fail",
          severity: "High",
          details: misplaced.length ? "Rows shown out of order, repeated or missing between loaded pages." : "",
          examples: misplaced.slice(0, 10).map((cells) => ({ row: t.rows.indexOf(cells) + 1, shown: cells[0], expected: pageRows[t.rows.indexOf(cells)] && pageRows[t.rows.indexOf(cells)].name })),
        });
        const idx = (h) => t.headers.indexOf(h);
        const diffs = [];
        t.rows.forEach((cells, i) => {
          const api = pageRows[i];
          if (!api) return diffs.push({ row: i + 1, column: "(row)", screen: cells[0], data: "no data row" });
          Object.entries(COLUMNS).forEach(([header, [key, kind]]) => {
            const c = idx(header);
            if (c < 0) return;
            const s = cells[c];
            const ok = kind === "text" ? (String(s).replace(/^-$/, "") === String(api[key] ?? "")) : close(num(s) ?? 0, round2(n0(api[key])), 0.011);
            if (!ok) diffs.push({ row: i + 1, product: api.name, column: header, screen: s, data: api[key] });
          });
        });
        check(area, `Table cells = data (${t.rows.length} rows × ${Object.keys(COLUMNS).length + 1} columns)`, {
          expected: 0,
          actual: diffs.length,
          status: diffs.length ? "Fail" : "Pass",
          severity: "High",
          details: diffs.length ? "Cells whose value differs from the row data." : "",
          examples: diffs.slice(0, 20),
        });
        const renamed = t.rows.map((cells, i) => ({ shown: cells[idx("Product Name")], saved: pageRows[i] && pageRows[i].name })).filter((x) => x.saved !== undefined && x.shown !== x.saved);
        check(area, "Product names shown exactly as saved", {
          expected: 0,
          actual: renamed.length,
          status: renamed.length ? "Fail" : "Pass",
          severity: "Low",
          details: renamed.length ? "The table changes the saved name (letter case, and \" - \" before a variant shown as \" ~ \") - names don't match the product list or receipts." : "",
          examples: renamed.slice(0, 10),
        });
        // Days Cover - worked out on the page from the rounded Items Sold per Day.
        const dc = idx("Days Cover");
        const dcRows = t.rows
          .map((cells, i) => ({ cells, api: pageRows[i] }))
          .filter(({ api }) => api && n0(api.items_sold) > 0 && n0(api.closing_inventory) > 0);
        const dcBad = dcRows.filter(({ cells, api }) => {
          const exact = n0(api.closing_inventory) / (n0(api.items_sold) / d.dates.days);
          return Math.abs(num(cells[dc]) - exact) > Math.max(0.5, exact * 0.01);
        });
        check(area, "Days Cover = Closing inventory ÷ (Items sold ÷ days) - rows on screen that sold", {
          how: "The page divides by the ROUNDED Items Sold per Day (e.g. 92 ÷ 0.07 = 1314.29 instead of 92 ÷ 0.0667 = 1380).",
          expected: `${dcRows.length} of ${dcRows.length} within 1%`,
          actual: `${dcRows.length - dcBad.length} of ${dcRows.length} within 1%`,
          status: dcBad.length ? "Fail" : dcRows.length ? "Pass" : "Info",
          severity: "Medium",
          details: dcRows.length ? "" : "No product on the first page sold in this range.",
          examples: dcBad.slice(0, 10).map(({ cells, api }) => ({ product: api.name, closing: api.closing_inventory, items_sold: api.items_sold, days: d.dates.days, "exact days cover": round2(n0(api.closing_inventory) / (n0(api.items_sold) / d.dates.days)), "shown": cells[dc] })),
        });
        const noSale = t.rows.map((cells, i) => ({ cells, api: pageRows[i] })).filter(({ api }) => api && n0(api.items_sold) === 0);
        if (noSale.length)
          check(area, "Days Cover for products with no sales", { expected: "\"∞\" / \"—\" (no sales)", actual: Cypress._.uniq(noSale.map(({ cells }) => cells[dc])).join(", "), status: "Info", details: "A 9999.00 placeholder reads like a real number of days." });

        // Total row.
        if (!t.total) {
          check(area, "Total row shown", { expected: "Total row", actual: "none", status: t.rows.length ? "Fail" : "Info", severity: "Medium" });
        } else {
          const totalDiffs = [];
          Object.entries(TOTAL_COLUMNS).forEach(([header, key]) => {
            const c = idx(header);
            if (c < 0) return;
            const s = t.total[c];
            if (s === "" || s === undefined) return totalDiffs.push({ column: header, screen: "(blank)", totals: d.totals[key] });
            if (!close(num(s), round2(n0(d.totals[key])), 0.05)) totalDiffs.push({ column: header, screen: s, totals: d.totals[key] });
          });
          const blankTotals = totalDiffs.filter((x) => x.screen === "(blank)");
          const wrongTotals = totalDiffs.filter((x) => x.screen !== "(blank)");
          check(area, "Total row = totals of all rows", { expected: 0, actual: wrongTotals.length, status: wrongTotals.length ? "Fail" : "Pass", severity: "High", examples: wrongTotals });
          check(area, "Total row filled for every summable column", {
            expected: Object.keys(TOTAL_COLUMNS).length,
            actual: Object.keys(TOTAL_COLUMNS).length - blankTotals.length,
            status: blankTotals.length ? "Fail" : "Pass",
            severity: "Low",
            details: blankTotals.length ? `Blank: ${blankTotals.map((x) => x.column).join(", ")}` : "",
          });
        }
      });
    });
  });

  it("cross-range checks (Today ⊂ Last 7 ⊂ Last 30, Average cost, closing stock)", () => {
    const area = "Across date ranges";
    cy.then(() => {
      const t = (r, k) => n0(data[r] && data[r].totals[k]);
      const ok1 = t("Today", "items_sold") <= t("Last 7 Days", "items_sold") && t("Yesterday", "items_sold") <= t("Last 7 Days", "items_sold") && t("Last 7 Days", "items_sold") <= t("Last 30 Days", "items_sold");
      check(area, "Items sold grows with the range (Today, Yesterday ≤ Last 7 ≤ Last 30)", { expected: "non-decreasing", actual: RANGES.map((r) => `${r} ${t(r, "items_sold")}`).join(", "), status: ok1 ? "Pass" : "Fail", severity: "High" });
      const ok2 = t("Today", "net_sale") <= t("Last 7 Days", "net_sale") + 0.05 && t("Last 7 Days", "net_sale") <= t("Last 30 Days", "net_sale") + 0.05;
      check(area, "Net sale grows with the range", { expected: "non-decreasing", actual: RANGES.map((r) => `${r} ${t(r, "net_sale")}`).join(", "), status: ok2 ? "Pass" : "Fail", severity: "High" });
      const sum2 = round2(t("Today", "items_sold") + t("Yesterday", "items_sold"));
      check(area, "Last 7 Days items sold ≥ Today + Yesterday", { expected: `≥ ${sum2}`, actual: t("Last 7 Days", "items_sold"), status: t("Last 7 Days", "items_sold") >= sum2 ? "Pass" : "Fail", severity: "Medium" });

      const by = (r) => Cypress._.keyBy((data[r] && data[r].rows) || [], keyOf);
      const today = by("Today");
      const last30 = by("Last 30 Days");
      const costDiff = Object.keys(last30).filter((k) => today[k] && !close(n0(today[k].avg_cost), n0(last30[k].avg_cost), 0.011));
      check(area, "Average cost of a product is the same whatever the date range", {
        how: "Help text: \"Average supplier price of a single item\" - a product property, not a sales figure.",
        expected: 0,
        actual: costDiff.length,
        status: costDiff.length ? "Fail" : "Pass",
        severity: "Medium",
        details: costDiff.length ? "Average cost changes with the date range (it shows $0.00 when the product did not sell in the range)." : "",
        examples: costDiff.slice(0, 15).map((k) => ({ product: label(last30[k]), "avg cost (Today)": today[k].avg_cost, "avg cost (Last 30 Days)": last30[k].avg_cost, "items sold (Today)": today[k].items_sold, "items sold (Last 30)": last30[k].items_sold })),
      });
      const marginDiff = Object.keys(last30).filter((k) => today[k] && !close(n0(today[k].margin), n0(last30[k].margin), 0.011));
      check(area, "Margin (%) changes with the date range", { expected: "changes with the period's sales", actual: marginDiff.length ? `${marginDiff.length} products differ` : "identical in every range", status: marginDiff.length ? "Pass" : "Fail", severity: "Medium", details: marginDiff.length ? "" : "Margin (%) is the same for every range - it is the product's price/cost margin, not the period's gross profit margin." });
      const closingDiff = Object.keys(last30).filter((k) => today[k] && n0(today[k].closing_inventory) !== n0(last30[k].closing_inventory));
      check(area, "Closing inventory is the same for ranges ending today (Today vs Last 30 Days)", { expected: 0, actual: closingDiff.length, status: closingDiff.length ? "Fail" : "Pass", severity: "High", examples: closingDiff.slice(0, 10).map((k) => ({ product: label(last30[k]), today: today[k].closing_inventory, last30: last30[k].closing_inventory })) });
      const count = Cypress._.uniq(RANGES.map((r) => data[r] && data[r].total));
      check(area, "Same product count in every range (All inventory)", { expected: 1, actual: `${count.length} different counts: ${RANGES.map((r) => `${r} ${data[r] && data[r].total}`).join(", ")}`, status: count.length === 1 ? "Pass" : "Info" });
    });
  });

  it("lazy loading: every row can be reached in the table (Last 30 Days)", () => {
    const area = "Loading all rows";
    const from = calls.length;
    reorderPage.scrollToLoadAll(data["Last 30 Days"].total).then((seen) => {
      const extra = calls.slice(from).filter((c) => c.kind === "list").map((c) => c.fields.page);
      check(area, "Scrolling the table loads the remaining rows", {
        expected: data["Last 30 Days"].total,
        actual: seen,
        status: seen >= data["Last 30 Days"].total ? "Pass" : "Fail",
        severity: "High",
        details: `${seen} of ${data["Last 30 Days"].total} rows reachable on screen. Pages requested while scrolling: ${extra.length ? extra.join(", ") : "none"}. There is no pager, so the other rows cannot be seen.`,
      });
    });
  });

  it("search by product (normal, case, spaces, special characters, wildcards, injection text)", () => {
    const area = "Search";
    const all = data["Last 30 Days"].rows;
    const matching = (term) => all.filter((r) => lower(r.name).includes(lower(term.trim())));
    const cases = [
      { term: "Almonds 001", why: "exact name" },
      { term: "almond", why: "part of a name, lower case" },
      { term: "ALMOND", why: "upper case - same result as lower case", same: "almond" },
      { term: "  almond  ", why: "spaces around - same result as without", same: "almond" },
      { term: "sneakers", why: "a word in many product names" },
      { term: "!@#$%^&*()_+", why: "special characters in a real product name" },
      { term: "%", why: "SQL wildcard - must not return every product" },
      { term: "_", why: "SQL single-character wildcard - must not return every product" },
      { term: "' OR '1'='1", why: "SQL injection text - must not error or return everything" },
      { term: "<script>alert(1)</script>", why: "HTML/script text - must not run" },
      { term: "zzqvnotexist123", why: "no such product - \"No Data Found\"" },
    ];
    const results = {};
    cases.forEach((c) => {
      const from = calls.length;
      reorderPage.search(c.term);
      reorderPage
        .waitForCall(calls, from, "list", (f) => (f.search_by === c.term || f.search_by === c.term.trim()) && String(page1(f)) === "1", `search "${c.term}"`)
        .then((call) => {
          const body = call.body || {};
          const rows = body.reorder_array || [];
          const total = Number(body.total_records || 0);
          results[c.term] = total;
          const expected = matching(c.term).length;
          const offTopic = rows.filter((r) => !lower(r.name).includes(lower(c.term.trim())));
          const ok = call.status === 200 && body.status !== false && (c.same ? true : total === expected) && offTopic.length === 0;
          cy.wait(1500, { log: false });
          reorderPage.readTable().then((t) => {
            const screenOk = total === 0 ? t.rows.length === 0 : t.rows.length === Math.min(12, total);
            const sameOk = c.same ? total === results[c.same] : true;
            const pass = ok && screenOk && sameOk && runInfo.alerts.length === 0;
            check(area, `"${c.term}" - ${c.why}`, {
              expected: c.same ? `${results[c.same]} results (same as "${c.same}")` : `${expected} results (products whose name contains it)`,
              actual: `${total} results; HTTP ${call.status}; search_by sent "${call.fields.search_by}"; ${t.rows.length} rows on screen${t.noData ? ", \"No Data Found\"" : ""}`,
              status: pass ? "Pass" : "Fail",
              severity: /wildcard|injection/.test(c.why) ? "High" : "Medium",
              details: [
                offTopic.length ? `${offTopic.length} result(s) do not contain the search text` : "",
                !sameOk ? `Expected the same count as "${c.same}" (${results[c.same]})` : "",
                !screenOk ? "The table does not show the results" : "",
                runInfo.alerts.length ? `A browser alert ran: ${runInfo.alerts.join(", ")}` : "",
              ].filter(Boolean).join(". "),
              examples: offTopic.slice(0, 8).map((r) => ({ product: label(r) })),
            });
          });
        });
    });
    // Back to no search.
    reorderPage.search("");
    cy.wait(3000, { log: false });
  });

  it("Measure filter: On-hand / Low / Out of stock rows follow their rule (Last 30 Days)", () => {
    const area = "Measure filter";
    const base = data["Last 30 Days"].call;
    const counts = {};
    const rules = {
      "On-hand-inventory": { test: (r) => n0(r.current_inventory) > 0, text: "current inventory > 0" },
      "Out of stock": { test: (r) => n0(r.current_inventory) <= 0, text: "current inventory ≤ 0" },
      "Low inventory": { test: (r) => n0(r.current_inventory) <= n0(r.reorder_point), text: "current inventory ≤ reorder point" },
      "All inventory": { test: () => true, text: "every product" },
    };
    Object.entries(rules).forEach(([measure, rule]) => {
      reorderPage.fetchAllRows(base, { measure_type: measure }, 100).then(({ rows, total }) => {
        counts[measure] = total;
        const breaking = rows.filter((r) => !rule.test(r));
        check(area, `${measure}: every row has ${rule.text}`, {
          expected: `${rows.length} of ${rows.length}`,
          actual: `${rows.length - breaking.length} of ${rows.length}`,
          status: breaking.length ? "Fail" : "Pass",
          severity: "High",
          examples: breaking.slice(0, 10).map((r) => ({ product: label(r), current_inventory: r.current_inventory, closing_inventory: r.closing_inventory, reorder_point: r.reorder_point })),
        });
      });
    });
    cy.then(() => {
      const all = data["Last 30 Days"].rows;
      const expectedOnHand = all.filter(rules["On-hand-inventory"].test).length;
      const expectedOut = all.filter(rules["Out of stock"].test).length;
      const expectedLow = all.filter((r) => n0(r.reorder_point) > 0 && rules["Low inventory"].test(r)).length;
      check(area, "On-hand count = products with stock in All inventory", { expected: expectedOnHand, actual: counts["On-hand-inventory"], status: counts["On-hand-inventory"] === expectedOnHand ? "Pass" : "Fail", severity: "High" });
      check(area, "Out of stock count = products with no stock in All inventory", { expected: expectedOut, actual: counts["Out of stock"], status: counts["Out of stock"] === expectedOut ? "Pass" : "Fail", severity: "High" });
      check(area, "On-hand + Out of stock = All inventory", { expected: counts["All inventory"], actual: (counts["On-hand-inventory"] || 0) + (counts["Out of stock"] || 0), status: (counts["On-hand-inventory"] || 0) + (counts["Out of stock"] || 0) === counts["All inventory"] ? "Pass" : "Fail", severity: "High" });
      check(area, "Low inventory count", { expected: `${expectedLow} (stock ≤ reorder point, reorder point set)`, actual: counts["Low inventory"], status: counts["Low inventory"] === expectedLow ? "Pass" : "Info", details: "Products without a reorder point are not counted as low." });
    });
    // The Measure select on screen.
    const from = calls.length;
    reorderPage.pickSelect("All inventory", "Out of stock");
    reorderPage.waitForCall(calls, from, "list", (f) => f.measure_type === "Out of stock" && String(f.page) === "1", "Out of stock on screen").then((call) => {
      check(area, "Measure select sends the chosen measure", { expected: "Out of stock", actual: call.fields.measure_type, status: "Pass" });
    });
    const back = calls.length;
    reorderPage.pickSelect("Out of stock", "All inventory");
    reorderPage.waitForCall(calls, back, "list", (f) => f.measure_type === "All inventory" && String(f.page) === "1", "back to All inventory");
  });

  it("Report Type filter: Brand / Vendor / Category add up to the Product totals (Last 30 Days)", () => {
    const area = "Report Type filter";
    const base = data["Last 30 Days"];
    ["Brand", "Vendor", "Category"].forEach((type) => {
      reorderPage.fetchAllRows(base.call, { report_type: type }, 100).then(({ rows, total }) => {
        ["items_sold", "net_sale", "closing_inventory"].forEach((key) => {
          const sum = round2(rows.reduce((t, r) => t + n0(r[key]), 0));
          const productSum = round2(base.rows.reduce((t, r) => t + n0(r[key]), 0));
          check(area, `${type}: ${key} adds up to the Product total`, { expected: productSum, actual: `${sum} (${total} ${type.toLowerCase()} rows)`, status: close(sum, productSum, 0.05) ? "Pass" : "Fail", severity: "High" });
        });
        const blankGroup = rows.filter((r) => !String(r.name ?? "").trim());
        check(area, `${type}: every group has a name (products without one grouped as "No ${type}" or similar)`, { expected: 0, actual: blankGroup.length, status: blankGroup.length ? "Fail" : "Pass", severity: "Low" });
      });
    });
    const from = calls.length;
    reorderPage.pickSelect("Product", "Category");
    reorderPage.waitForCall(calls, from, "list", (f) => f.report_type === "Category" && String(f.page) === "1", "Category on screen").then((call) => {
      cy.wait(4000, { log: false });
      cy.screenshot("qa-reorder-category-view", { capture: "viewport" });
      reorderPage.readTable().then((t) => {
        const rows = (call.body && call.body.reorder_array) || [];
        const groups = Number(call.body.total_records || 0);
        const full = Math.min(12, groups);
        check(area, "Category view: page 1 is a full page of category rows", {
          how: "Page size 12.",
          expected: `${full} rows (of ${groups} groups)`,
          actual: `API page 1: ${rows.length} rows; table: ${t.rows.length} rows; first: ${t.rows[0] ? t.rows[0][0] : "—"}`,
          status: t.rows.length === full && rows.length === full ? "Pass" : "Fail",
          severity: "Medium",
          details: rows.length < full ? `The API answers page 1 with ${rows.length} rows although ${groups} groups exist - groups are lost between pages.` : "",
        });
      });
    });
    const back = calls.length;
    reorderPage.pickSelect("Category", "Product");
    reorderPage.waitForCall(calls, back, "list", (f) => f.report_type === "Product" && String(f.page) === "1", "back to Product");
  });

  it("rapid date switching ends on the last range clicked", () => {
    const area = "Rapid filter changes";
    const last = rangeDates("Last 30 Days");
    ["Today", "Last 7 Days", "Yesterday", "Last 30 Days"].forEach((r) => reorderPage.quickDate(r).click());
    cy.wait(12000, { log: false });
    reorderPage.readTable().then((t) => {
      const idx = t.headers.indexOf("Items Sold");
      const shown = t.total ? num(t.total[idx]) : null;
      const expected = round2(n0(data["Last 30 Days"].totals.items_sold));
      const active = Cypress.$("button.qv-date-filter__quick.is-active").text().trim();
      const inputs = Cypress.$("input.qv-date-filter__input").toArray().map((i) => i.value);
      const pass = active === "Last 30 Days" && close(shown, expected, 0.05) && inputs[0] === last.startMdy && inputs[1] === last.endMdy;
      check(area, "Table, total and dates show Last 30 Days after 4 quick clicks", {
        expected: `Last 30 Days, items sold ${expected}, ${last.startMdy} - ${last.endMdy}`,
        actual: `${active || "(none)"}, items sold ${shown}, ${inputs.join(" - ")}`,
        status: pass ? "Pass" : "Fail",
        severity: "High",
        details: pass ? "" : "A slower answer for an earlier click replaced the last one (responses are not cancelled).",
      });
    });
  });

  it("custom date range: end date before start date", () => {
    const area = "Custom dates";
    const from = calls.length;
    const today = rangeDates("Today");
    const monthAgo = rangeDates("Last 30 Days");
    cy.get("input.qv-date-filter__input").then(($inputs) => {
      const readOnly = $inputs.toArray().some((i) => i.readOnly);
      if (readOnly) {
        check(area, "Start after End is rejected", { expected: "validation message, no request", actual: "date inputs are read-only (picker only) - not testable by typing", status: "Info" });
        return;
      }
      cy.wrap($inputs[0]).clear().type(`${today.startMdy}{enter}`);
      cy.wrap($inputs[1]).clear().type(`${monthAgo.startMdy}{enter}`);
      cy.wait(6000, { log: false });
      cy.then(() => {
        const sent = calls.slice(from).filter((c) => c.kind === "list" && c.fields.start_date > c.fields.end_date);
        const message = /(end date|start date).*(before|after|greater|less)|invalid date/i.test(Cypress.$("main").text());
        check(area, "Start after End is rejected", {
          expected: "validation message, no request",
          actual: sent.length ? `request sent with ${sent[0].fields.start_date} > ${sent[0].fields.end_date} (HTTP ${sent[0].status}, ${Number(sent[0].body && sent[0].body.total_records)} rows)` : message ? "validation shown" : "no request, no message",
          status: sent.length ? "Fail" : message ? "Pass" : "Info",
          severity: "Medium",
        });
      });
    });
    reorderPage.quickDate("Last 30 Days").click();
    cy.wait(4000, { log: false });
  });

  it("summary", () => {
    cy.then(() => {
      const failed = checks.filter((c) => c.status === "Fail");
      cy.task("log", `\n${failed.length} bug(s) found:\n${failed.map(formatCheckLine).join("\n")}`, { log: false });
      Cypress.log({ name: "summary", message: `${checks.length} checks · ${checks.filter((c) => c.status === "Pass").length} pass · ${failed.length} fail · ${checks.filter((c) => c.status === "Info").length} info - see ${REPORT_FILE}` });
    });
  });
});

// The page number a list call asked for.
function page1(fields) {
  return fields.page ?? "1";
}
