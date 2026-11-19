const itemSoldReportPage = require("../pages/ItemSoldReportPage");
const categorySoldReportPage = require("../pages/CategorySoldReportPage");
const salesSummaryPage = require("../pages/SalesSummaryPage");
const reportsApi = require("../reports/ReportsApi");
const { getDateRanges } = require("../reports/reconciliationConfig");
const { buildHtml, injectLogStyles, logRow, formatLine, assertNoMismatches } = require("../reports/reconciliationReport");

// Only for Rock N Roll (user, 18 Nov 2026) - a stand-alone spec, not part of
// all-tests / report-tests / data-tests. Maps the Item Sold Report onto the
// Category Sold Report, and both onto the Overall Sales Summary, for the
// Rock N Roll account (AZI650741TX) and every store on it. Only reads data;
// a mismatch is reported, never "fixed" - it's for the devs.
//
//   Item Sold                  Category Sold            Sales Summary
//   Sold                    =  Sold Qty
//   Subtotal                =  Subtotal              =  Gross Sales
//   Discounts               =  Discounts             =  Discounts + Loyalty Points Redeemed
//   Refunds                 =  Refunds               =  Refunds + Store Credit Refunds
//   Subtotal w/ Discounts   =  Subtotal w/ Discounts =  Net Sales
//   Total                   =  Total
//   Cost                    =  Cost                  (=  its API's total_cost)
//   Profit                  =  Profit                (=  its API's profit)
//   Margin                  =  Margin                =  Profit Margin
//
// Confirmed live (Rock N Roll, all stores, this year): the Item Sold and
// Category Sold "Discounts" are discount + loyalty + coupon, while the Sales
// Summary shows loyalty on its own card ("Loyalty Points Redeemed") and
// store-credit refunds on theirs ("Store Credit Refunds") - so those cards
// are added back before comparing.
//
// Tests:
// 1. UI, all stores, Today / Yesterday / This month / This year: each page
//    shows what its own API sent, and the three pages' figures map.
// 2. API, all stores, every date range: the mapping above, each report's
//    own sums (Subtotal - Discounts - Refunds = Subtotal w/ Discounts, ...),
//    and - for ranges that are over - every row added up = the Total row.
// 3. API, each store on its own (rockNRollStoreRanges): the mapping above;
//    in rockNRollCategoryRange (yesterday) row by row and category by
//    category (Item Sold rows by category = Category Sold rows); and every
//    store added up = all stores.
//
// A range that includes today keeps changing while sales come in (seen
// live: this year's Subtotal went up $10.99 in a minute), so its figures
// are read back to back and read once more if they don't match. Tests 2
// and 3 run "this month" and "this year" up to yesterday (apiDateRanges).

const ACCOUNT = Cypress.env("rockNRollStore") || "AZI650741TX";
const API = "https://reports-api.quickvee.us/api/reports/";
const ITEMS_API = API + "items_sales_report_api";
const CATEGORIES_API = API + "category_sales_report_api_fact";
const SUMMARY_API = API + "sales_report_api_fact";

const PER_STORE_RANGES = (() => {
  const configured = Cypress.env("rockNRollStoreRanges");
  if (Array.isArray(configured) && configured.length) return configured;
  if (typeof configured === "string" && configured.trim()) return configured.split(",").map((s) => s.trim());
  return ["yesterday", "last month", "this year"];
})();

// The range each store is checked row by row and category by category in
// (a range that's over - one with today keeps changing). A day keeps it to
// a page or two per store.
const CATEGORY_RANGE = Cypress.env("rockNRollCategoryRange") || "yesterday";

// Sales Summary preset for each range checked on the UI.
const UI_PRESETS = [
  { label: "today", salesSummary: "Today" },
  { label: "yesterday", salesSummary: "Yesterday" },
  { label: "this month", salesSummary: "Month to Date" },
  { label: "this year", salesSummary: "Year to Date" },
];

const ITEM_PAGE_SIZE = 500;
const CATEGORY_PAGE_SIZE = 100;
const MAX_PAGES = 100;
// Rows listed per range for categories that don't match; the rest are counted.
const MAX_CATEGORY_ROWS = 60;

// With several stores selected, the Sales Summary splits a refund between
// "Refunds" and "Store Credit Refunds" a little differently than each store
// alone does (seen live, Oct 2026: 113 stores $0.83, two stores $0.14; the
// two cards together always match). Round-off, per the user (19 Nov 2026):
// up to $0.99 is accepted however many stores are combined - never more.
// Such rows still say "MATCH (within ±$0.99)", so the gap stays visible.
const SALES_SUMMARY_REFUND_TOLERANCE = { refund: 0.99, storeCreditRefund: 0.99 };

const SALES_SUMMARY_CARDS = [
  "Gross Sales",
  "Discounts",
  "Loyalty Points Redeemed",
  "Refunds",
  "Store Credit Refunds",
  "Net Sales",
  "Profit Margin",
];

const idsOf = (value) => (value || "").split(",").filter(Boolean);
const toAmount = (v) => (v === undefined || v === null || v === "" || Number.isNaN(Number(v)) ? null : Math.round(Number(v) * 100) / 100 + 0);
const cents = (v) => Math.round(Number(v) * 100);
const num = (v) => Number(v || 0);
const marginOf = (profit, net) => (net === 0 ? 0 : (profit / net) * 100);

// --- Calling the report APIs ------------------------------------------------

function multipart(fields) {
  const boundary = "----CypressBoundary" + Date.now() + Cypress._.random(0, 99999);
  const body =
    Object.entries(fields)
      .map(([key, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`)
      .join("") + `--${boundary}--\r\n`;
  return { boundary, body };
}

// Sends a report call the page made (`template`: { url, fields,
// authorization }) again with `overrides`. Tried up to 3 times if the API
// errors. A range with no sales can come back as "No data found".
function post(template, overrides, attemptsLeft = 3) {
  const { boundary, body } = multipart({ ...template.fields, ...overrides });
  return cy
    .request({
      method: "POST",
      url: template.url,
      timeout: 120000,
      failOnStatusCode: false,
      log: false,
      headers: { Authorization: template.authorization, "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body,
    })
    .then((res) => {
      const ok = res.status === 200 && res.body && (res.body.status === true || /no data/i.test(res.body.message || ""));
      if (ok) return res.body;
      if (attemptsLeft > 1) return cy.wait(3000, { log: false }).then(() => post(template, overrides, attemptsLeft - 1));
      throw new Error(`${template.url} answered HTTP ${res.status}: ${JSON.stringify(res.body).slice(0, 300)}`);
    });
}

// Every row of a paged report, page by page. Yields { rows, body } - `body`
// is page 1's: the Item Sold API sends its column_totals on page 1 only
// (confirmed live - later pages have none).
function fetchAllRows(template, overrides, rowsKey, pageSize, page = 1, rows = [], first = null) {
  return post(template, { ...overrides, page: String(page), page_size: String(pageSize) }).then((body) => {
    const all = rows.concat(body[rowsKey] || []);
    const firstBody = first || body;
    if (body.has_more === true && page < MAX_PAGES) return fetchAllRows(template, overrides, rowsKey, pageSize, page + 1, all, firstBody);
    return { rows: all, body: firstBody };
  });
}

// Both reports' every row for `storeIds` and `range`.
function fetchEveryRow(t, storeIds, range) {
  const where = { outlet_ids: storeIds.join(","), start_date: range.startDate, end_date: range.endDate };
  const out = {};
  fetchAllRows(t.items, where, "item_sale_data", ITEM_PAGE_SIZE).then((r) => (out.items = r));
  fetchAllRows(t.categories, { ...where, sort_field: "category_name", sort_order: "asc" }, "category_sale_data", CATEGORY_PAGE_SIZE).then(
    (r) => (out.categories = r)
  );
  return cy.then(() => out);
}

// Opens each page, selects All Stores, and keeps the call it then made (for
// sending again with other stores/dates). Yields { items, categories,
// summary, storeIds } and records whether the three pages' All Stores
// are the same stores.
function captureTemplates(record) {
  const t = {};
  const keep = (name, url) => (call) => {
    t[name] = { url, fields: call.fields, authorization: call.authorization };
  };
  const allStores = (fields) => idsOf(fields.outlet_ids).length > 1;

  itemSoldReportPage.visit().then((available) => expect(available, "Item Sold Report available").to.equal(true));
  reportsApi
    .callAfter(ITEMS_API, () => itemSoldReportPage.selectAllStores(), (f) => allStores(f) && !f.search_by && !f.cat_name, "Item Sold Report, All Stores", 10)
    .then(keep("items", ITEMS_API));

  categorySoldReportPage.visit();
  reportsApi
    .callAfter(CATEGORIES_API, () => categorySoldReportPage.selectAllStores(), (f) => allStores(f) && !f.search_by, "Category Sold Report, All Stores", 10)
    .then(keep("categories", CATEGORIES_API));

  salesSummaryPage.visit();
  reportsApi
    .callAfter(SUMMARY_API, () => salesSummaryPage.selectAllStoresAndSearch(), allStores, "Overall Sales Summary, All Stores", 10)
    .then(keep("summary", SUMMARY_API));

  return cy.then(() => {
    const lists = {
      "Item Sold": idsOf(t.items.fields.outlet_ids).sort(),
      "Category Sold": idsOf(t.categories.fields.outlet_ids).sort(),
      "Sales Summary": idsOf(t.summary.fields.outlet_ids).sort(),
    };
    const union = Cypress._.union(...Object.values(lists)).sort();
    Object.entries(lists).forEach(([page, list]) => {
      const missing = union.filter((id) => !list.includes(id));
      record(`${page} "All Stores" leaves out${missing.length ? `: ${missing.join(", ")}` : ""}`, "count", [
        [`${page} stores missing`, missing.length],
        ["Expected", 0],
      ]);
    });
    t.storeIds = union;
    return t;
  });
}

// --- Reading each report's figures -----------------------------------------

function itemTotals(body) {
  const t = body.column_totals || {};
  return {
    qty: num(t.total_qty),
    subtotal: num(t.total_price),
    discounts: num(t.discount_amt) + num(t.loyalty_amt) + num(t.coupon_amt),
    refunds: num(t.refund_amount),
    net: num(t.net_sale),
    total: num(t.net_sale) + num(t.default_tax_amount) + num(t.other_taxes_amount),
    cost: num(t.cost),
    profit: num(t.profit),
    margin: num(t.margin),
    rows: num(body.total_items),
  };
}

function categoryTotals(body) {
  return {
    qty: num(body.total_qty),
    subtotal: num(body.total_subtotal),
    discounts: num(body.total_discounts),
    refunds: num(body.total_refunds),
    net: num(body.total_subtotal_with_discounts),
    total: num(body.total_amount),
    cost: num(body.total_cost),
    profit: num(body.total_profit),
    margin: num(body.total_margin),
    rows: num(body.total_categories),
  };
}

function summaryTotals(body) {
  const r = body.result || {};
  const g = typeof r.gross_sales === "string" ? JSON.parse(r.gross_sales) : r.gross_sales || {};
  return {
    gross: num(g.subtotal),
    discount: num(g.discount),
    loyalty: num(g.loyalty_points_redeemed),
    refund: num(g.refund),
    storeCreditRefund: num(g.store_credit_refund),
    net: num(g.net_sales),
    cost: num(r.total_cost),
    profit: num(r.profit),
    margin: num(r.profit_margin),
  };
}

// The three reports' totals for `storeIds` and `range`, read back to back.
function fetchTotals(t, storeIds, range) {
  const where = { outlet_ids: storeIds.join(","), start_date: range.startDate, end_date: range.endDate };
  const out = {};
  post(t.items, { ...where, page: "1", page_size: "1" }).then((b) => (out.item = itemTotals(b)));
  post(t.categories, { ...where, page: "1", page_size: "1" }).then((b) => (out.cat = categoryTotals(b)));
  post(t.summary, where).then((b) => (out.ss = summaryTotals(b)));
  return cy.then(() => out);
}

// --- Comparisons -------------------------------------------------------------

// A report row: `pairs` ([label, value]) must all be equal (in cents, or
// within `tolerance`). On a mismatch the values that differ from the most
// common one are flagged.
function makeRow(store, range, label, format, pairs, tolerance = 0) {
  const values = pairs.map(([l, v]) => ({ label: l, raw: v, amount: toAmount(v) }));
  const amounts = values.map((v) => v.amount);
  const present = amounts.every((a) => a !== null);
  const spread = present ? Math.round((Math.max(...amounts) - Math.min(...amounts)) * 100) : null;
  const match = present && spread <= Math.round(tolerance * 100);
  if (!match) {
    const counts = Cypress._.countBy(amounts.filter((a) => a !== null));
    const mostCommon = Number(Cypress._.maxBy(Object.keys(counts), (k) => counts[k]));
    values.forEach((v) => (v.differs = v.amount === null || v.amount !== mostCommon));
  }
  const row = { kind: "group", store, range, label, format, values, match, withinTolerance: match && spread > 0, tolerance };
  row.line = `[${store}] ${formatLine(row)}`;
  return row;
}

// The mapping between the three reports, plus each report's own sums.
function totalsRows(store, range, { item, cat, ss }) {
  const row = (label, format, pairs, tolerance) => makeRow(store, range, label, format, pairs, tolerance);
  return [
    row("Sold Qty", "count", [
      ["Item Sold · Sold", item.qty],
      ["Category Sold · Sold Qty", cat.qty],
    ]),
    row("Subtotal = Gross Sales", "money", [
      ["Item Sold · Subtotal", item.subtotal],
      ["Category Sold · Subtotal", cat.subtotal],
      ["Sales Summary · Gross Sales", ss.gross],
    ]),
    row("Discounts", "money", [
      ["Item Sold · Discounts", item.discounts],
      ["Category Sold · Discounts", cat.discounts],
      ["Sales Summary · Discounts + Loyalty Points Redeemed", ss.discount + ss.loyalty],
    ]),
    row("Refunds", "money", [
      ["Item Sold · Refunds", item.refunds],
      ["Category Sold · Refunds", cat.refunds],
      ["Sales Summary · Refunds + Store Credit Refunds", ss.refund + ss.storeCreditRefund],
    ]),
    row("Subtotal w/ Discounts = Net Sales", "money", [
      ["Item Sold · Subtotal w/ Discounts", item.net],
      ["Category Sold · Subtotal w/ Discounts", cat.net],
      ["Sales Summary · Net Sales", ss.net],
    ]),
    row("Total", "money", [
      ["Item Sold · Total", item.total],
      ["Category Sold · Total", cat.total],
    ]),
    row("Cost", "money", [
      ["Item Sold · Cost", item.cost],
      ["Category Sold · Cost", cat.cost],
      ["Sales Summary · cost (its API)", ss.cost],
    ]),
    row("Profit", "money", [
      ["Item Sold · Profit", item.profit],
      ["Category Sold · Profit", cat.profit],
      ["Sales Summary · profit (its API)", ss.profit],
    ]),
    row("Margin = Profit Margin", "percent", [
      ["Item Sold · Margin", item.margin],
      ["Category Sold · Margin", cat.margin],
      ["Sales Summary · Profit Margin", ss.margin],
    ]),
    ...formulaRows(store, range, "Item Sold", item),
    ...formulaRows(store, range, "Category Sold", cat),
    row("Sales Summary's own sum: Gross Sales - Discounts - Loyalty - Refunds - Store Credit Refunds = Net Sales", "money", [
      ["Worked out", ss.gross - ss.discount - ss.loyalty - ss.refund - ss.storeCreditRefund],
      ["Net Sales shown", ss.net],
    ]),
    row("Sales Summary's own sum: profit / Net Sales = Profit Margin", "percent", [
      ["Worked out", marginOf(ss.profit, ss.net)],
      ["Profit Margin shown", ss.margin],
    ], 0.01),
  ];
}

function formulaRows(store, range, report, r) {
  return [
    makeRow(store, range, `${report}'s own sum: Subtotal - Discounts - Refunds = Subtotal w/ Discounts`, "money", [
      ["Worked out", r.subtotal - r.discounts - r.refunds],
      ["Subtotal w/ Discounts shown", r.net],
    ]),
    makeRow(store, range, `${report}'s own sum: Subtotal w/ Discounts - Cost = Profit`, "money", [
      ["Worked out", r.net - r.cost],
      ["Profit shown", r.profit],
    ]),
    makeRow(store, range, `${report}'s own sum: Profit / Subtotal w/ Discounts = Margin`, "percent", [
      ["Worked out", marginOf(r.profit, r.net)],
      ["Margin shown", r.margin],
    ], 0.01),
  ];
}

// Totals for a range, read once more if a range that includes today
// doesn't match (sales coming in between the calls).
function checkTotals(t, storeIds, store, range) {
  return fetchTotals(t, storeIds, range).then((first) => {
    const rows = totalsRows(store, range, first);
    if (!range.isCurrentPeriod || rows.every((r) => r.match)) return { rows, totals: first };
    return cy
      .wait(2000, { log: false })
      .then(() => fetchTotals(t, storeIds, range))
      .then((second) => ({ rows: totalsRows(store, range, second), totals: second }));
  });
}

// Item Sold rows added up per category, against the Category Sold rows -
// matched on the category name, any case. An item is counted under its
// rollup category (what the Category Sold Report groups by), or its own.
const CATEGORY_FIELDS = [
  ["qty", "Sold Qty", "count"],
  ["subtotal", "Subtotal", "money"],
  ["discounts", "Discounts", "money"],
  ["refunds", "Refunds", "money"],
  ["net", "Subtotal w/ Discounts", "money"],
  ["total", "Total", "money"],
  ["cost", "Cost", "money"],
  ["profit", "Profit", "money"],
];
const categoryKey = (name) => String(name || "(no category)").trim().toUpperCase();

function itemRowFigures(i) {
  return {
    qty: num(i.total_qty),
    subtotal: num(i.total_price),
    discounts: num(i.discount_amt) + num(i.loyalty_amt) + num(i.coupon_amt),
    refunds: num(i.refund_amount),
    net: num(i.discount_price),
    total: num(i.discount_price) + num(i.default_tax_amount) + num(i.other_taxes_amount),
    cost: num(i.cost),
    profit: num(i.profit),
  };
}

function categoryRowFigures(c) {
  return {
    qty: num(c.total_qty),
    subtotal: num(c.subtotal),
    discounts: num(c.discounts),
    refunds: num(c.refunds),
    net: num(c.subtotal_with_discounts),
    total: num(c.total_amount),
    cost: num(c.cost),
    profit: num(c.profit),
  };
}

function addUp(list, figuresOf) {
  const sum = Object.fromEntries(CATEGORY_FIELDS.map(([k]) => [k, 0]));
  list.forEach((row) => {
    const f = figuresOf(row);
    CATEGORY_FIELDS.forEach(([k]) => (sum[k] += f[k]));
  });
  return sum;
}

// Every row was fetched, and the rows add up to each report's Total.
function rowSumRows(store, range, { items, categories }) {
  const rows = [];
  const row = (label, format, pairs) => rows.push(makeRow(store, range, label, format, pairs));
  const itemTotal = itemTotals(items.body);
  const categoryTotal = categoryTotals(categories.body);
  const itemSum = addUp(items.rows, itemRowFigures);
  const categorySum = addUp(categories.rows, categoryRowFigures);

  row("Item Sold rows fetched = its \"All N items\"", "count", [
    ["Rows fetched", items.rows.length],
    ['"All N items"', itemTotal.rows],
  ]);
  row("Category Sold rows fetched = its category count", "count", [
    ["Rows fetched", categories.rows.length],
    ["total_categories", categoryTotal.rows],
  ]);
  CATEGORY_FIELDS.forEach(([k, label, format]) => {
    row(`Item Sold rows added up = its Total row · ${label}`, format, [
      ["Rows added up", itemSum[k]],
      ["Total row", itemTotal[k]],
    ]);
    row(`Category Sold rows added up = its totals · ${label}`, format, [
      ["Rows added up", categorySum[k]],
      ["Totals", categoryTotal[k]],
    ]);
  });
  return rows;
}

// Category by category. Only for one store at a time: with several stores
// the Item Sold Report puts each UPC on one row under any one store's name
// and category (user rule, 5 Nov 2026 - see item-sold-filters.cy.js), so an
// item filed under different categories in different stores lands in just
// one of them - confirmed live, all stores Oct 2026: 46 of 130 categories
// off for that reason alone.
function perCategoryRows(store, range, { items: itemResult, categories: categoryResult }) {
  const rows = [];
  const row = (label, format, pairs) => rows.push(makeRow(store, range, label, format, pairs));
  const items = itemResult.rows;
  const categories = categoryResult.rows;
  const itemsByCategory = Cypress._.groupBy(items, (i) => categoryKey(i.rollup_category_name || i.category_name));
  const categoriesByKey = Cypress._.groupBy(categories, (c) => categoryKey(c.category_name));
  Object.entries(categoriesByKey)
    .filter(([, list]) => list.length > 1)
    .forEach(([key, list]) =>
      row(`Category Sold shows "${key}" on more than one row (${list.map((c) => c.category_name).join(" / ")})`, "count", [
        ["Rows", list.length],
        ["Expected", 1],
      ])
    );

  const keys = Cypress._.union(Object.keys(itemsByCategory), Object.keys(categoriesByKey)).sort();
  let matched = 0;
  let listed = 0;
  let notListed = 0;
  keys.forEach((key) => {
    const fromItems = itemsByCategory[key] ? addUp(itemsByCategory[key], itemRowFigures) : null;
    const fromCategories = categoriesByKey[key] ? addUp(categoriesByKey[key], categoryRowFigures) : null;
    const name = (categoriesByKey[key] || [])[0] ? categoriesByKey[key][0].category_name : itemsByCategory[key][0].rollup_category_name || itemsByCategory[key][0].category_name || key;
    const fieldRows = CATEGORY_FIELDS.map(([k, label, format]) =>
      makeRow(store, range, `Category "${name}" · ${label}`, format, [
        [`Item Sold (${fromItems ? itemsByCategory[key].length : 0} items added up)`, fromItems ? fromItems[k] : null],
        ["Category Sold row", fromCategories ? fromCategories[k] : null],
      ])
    );
    const bad = fieldRows.filter((r) => !r.match);
    if (!bad.length) {
      matched += 1;
      return;
    }
    bad.forEach((r) => {
      if (listed < MAX_CATEGORY_ROWS) {
        rows.push(r);
        listed += 1;
      } else notListed += 1;
    });
  });
  row(`Categories that match on every figure${notListed ? ` (${notListed} more differing figures not listed)` : ""}`, "count", [
    ["Matching", matched],
    ["Categories", keys.length],
  ]);
  return rows;
}

// Reads `read` until `isSettled(value)` or it's out of tries - the page
// redraws a moment after its API answers.
function readSettled(read, isSettled, attemptsLeft = 10) {
  return read().then((value) => {
    if (isSettled(value) || attemptsLeft <= 1) return value;
    return cy.wait(1500, { log: false }).then(() => readSettled(read, isSettled, attemptsLeft - 1));
  });
}

// The date ranges for the API tests (2 and 3): the usual ones, except "this
// month" and "this year" end yesterday instead of today (user, 19 Nov 2026) -
// so orders coming in during the run can't change them, and they're checked
// row by row like the other ranges that are over. On the 1st of the month /
// year there's no "yesterday" inside them, so they're left out that day. The
// UI test keeps the pages' own This month / This year (Year to Date) presets.
function apiDateRanges() {
  const ranges = getDateRanges();
  const yesterday = ranges.find((r) => r.label === "yesterday");
  if (!yesterday) return ranges; // a custom reportStartDate/reportEndDate range
  return ranges
    .map((r) =>
      r.label === "this month" || r.label === "this year" ? { ...r, endDate: yesterday.endDate, isCurrentPeriod: false } : r
    )
    .filter((r) => r.startDate <= r.endDate);
}

// "All stores (112)" - the store list itself is in the HTML report's first rows.
const allStoresLabel = (ids) => `Rock N Roll · All stores (${ids.length})`;

// -----------------------------------------------------------------------------

describe("only for rock n roll", () => {
  const rowsByTest = {};

  before(() => {
    injectLogStyles();
  });

  beforeEach(function () {
    rowsByTest[this.currentTest.title] = [];
    cy.loginAndEnterStore(Cypress.env("storeName"), Cypress.env("username"), Cypress.env("password"), ACCOUNT);
  });

  after(() => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp =
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_` +
      `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const rows = Object.values(rowsByTest).flat();
    const file = `cypress/reports-output/only-for-rock-n-roll-${stamp}.html`;
    cy.writeFile(file, buildHtml(rows, now.toLocaleString(), "Only for Rock N Roll - Item Sold / Category Sold / Sales Summary"));
    cy.writeFile(
      `cypress/reports-output/only-for-rock-n-roll-${stamp}-mismatches.txt`,
      rows.filter((r) => !r.match).map((r) => r.line).join("\n") || "No mismatches."
    );
    cy.task("log", `HTML report written to ${file}`);
  });

  // `quiet`: only mismatches go to the command log (the per-store test has
  // thousands of rows); everything still goes in the HTML report.
  function recordRows(title, rows, { quiet = false } = {}) {
    rows.forEach((row) => {
      if (!quiet || !row.match) logRow(row);
      if (!row.match) cy.task("log", row.line, { log: false });
      rowsByTest[title].push(row);
    });
  }

  function finish(title) {
    cy.then(() => {
      const rows = rowsByTest[title];
      expect(rows, "checks run").to.not.be.empty;
      assertNoMismatches(rows.filter((r) => !r.match));
    });
  }

  it("UI: Item Sold, Category Sold and Sales Summary pages map (all stores)", function () {
    const title = this.test.title;
    const ranges = getDateRanges();
    const presets = UI_PRESETS.map((p) => ({ ...p, range: ranges.find((r) => r.label === p.label) })).filter((p) => p.range);
    const ui = {};
    let storeIds = [];
    const store = () => allStoresLabel(storeIds);
    const record = (range, label, format, pairs, tolerance) =>
      recordRows(title, [makeRow(store(), range, label, format, pairs, tolerance)]);
    const sameDates = (f, range) => f.start_date === range.startDate && f.end_date === range.endDate;
    const allStores = (f) => idsOf(f.outlet_ids).length > 1;

    // Item Sold Report: Total row vs the call behind it.
    itemSoldReportPage.visit().then((available) => expect(available, "Item Sold Report available").to.equal(true));
    presets.forEach((p, index) => {
      reportsApi
        .callAfter(
          ITEMS_API,
          () => {
            if (index === 0) itemSoldReportPage.selectAllStores();
            itemSoldReportPage.selectDates(p.range);
          },
          (f) => sameDates(f, p.range) && allStores(f) && !f.search_by && !f.cat_name,
          `Item Sold Report, All Stores, ${p.label}`,
          10
        )
        .then((call) => {
          storeIds = idsOf(call.fields.outlet_ids);
          const api = itemTotals(call.body);
          ui[p.label] = { item: null };
          // No sales in the range: the Item Sold Report shows "No sale"
          // instead of a Total row - by design (user, 19 Nov 2026), while the
          // Category Sold Report shows its $0.00 row. So there's no Total row
          // to read; the range is skipped on this page (and in "Pages as
          // shown" below). Seen live: Today, run from Pakistan before Texas'
          // day had started.
          if (api.rows === 0) {
            Cypress.log({ name: "warning", displayName: "SKIPPED", message: `Item Sold page, ${p.label}: no sales ("No sale") - nothing to compare` });
            cy.task("log", `Item Sold page, ${p.label}: no sales - skipped`, { log: false });
            return;
          }
          return readSettled(
            () => itemSoldReportPage.totalRow(),
            (shown) => shown.items === api.rows && cents(shown.Subtotal) === cents(api.subtotal)
          ).then((shown) => {
            const page = {
              qty: shown.Sold,
              subtotal: shown.Subtotal,
              discounts: Math.abs(shown.Discounts),
              refunds: Math.abs(shown.Refunds),
              net: shown["Subtotal w/ Discounts"],
              total: shown.Total,
              cost: shown.Cost,
              profit: shown.Profit,
              margin: shown.Margin,
            };
            ui[p.label].item = page;
            [
              ["qty", "Sold", "count"],
              ["subtotal", "Subtotal", "money"],
              ["discounts", "Discounts", "money"],
              ["refunds", "Refunds", "money"],
              ["net", "Subtotal w/ Discounts", "money"],
              ["total", "Total", "money"],
              ["cost", "Cost", "money"],
              ["profit", "Profit", "money"],
              ["margin", "Margin", "percent"],
            ].forEach(([k, label, format]) =>
              record(p.range, `Item Sold page shows its API · ${label}`, format, [
                ["Page", page[k]],
                ["API", api[k]],
              ])
            );
            record(p.range, 'Item Sold page shows its API · "All N items"', "count", [
              ["Page", shown.items],
              ["API total_items", api.rows],
            ]);
          });
        });
    });

    // Category Sold Report: summary card vs the call behind it.
    categorySoldReportPage.visit();
    presets.forEach((p, index) => {
      reportsApi
        .callAfter(
          CATEGORIES_API,
          () => {
            if (index === 0) categorySoldReportPage.selectAllStores();
            categorySoldReportPage.selectDates(p.range);
          },
          (f) => sameDates(f, p.range) && allStores(f) && !f.search_by,
          `Category Sold Report, All Stores, ${p.label}`,
          10
        )
        .then((call) => {
          const api = categoryTotals(call.body);
          return readSettled(
            () => categorySoldReportPage.summary(),
            (shown) => cents(shown.Subtotal) === cents(api.subtotal)
          ).then((shown) => {
            const page = {
              subtotal: shown.Subtotal,
              discounts: Math.abs(shown.Discounts),
              refunds: Math.abs(shown.Refunds),
              net: shown["Subtotal w/ Discounts"],
              total: shown.Total,
              cost: shown.Cost,
              profit: shown.Profit,
              margin: shown.Margin,
            };
            ui[p.label].cat = { ...page, qty: api.qty };
            [
              ["subtotal", "Subtotal", "money"],
              ["discounts", "Discounts", "money"],
              ["refunds", "Refunds", "money"],
              ["net", "Subtotal w/ Discounts", "money"],
              ["total", "Total", "money"],
              ["cost", "Cost", "money"],
              ["profit", "Profit", "money"],
              ["margin", "Margin", "percent"],
            ].forEach(([k, label, format]) =>
              record(p.range, `Category Sold page shows its API · ${label}`, format, [
                ["Page", page[k]],
                ["API", api[k]],
              ])
            );
          });
        });
    });

    // Overall Sales Summary: cards vs the call behind them.
    salesSummaryPage.visit();
    salesSummaryPage.selectAllStoresAndSearch();
    presets.forEach((p) => {
      reportsApi
        .callAfter(
          SUMMARY_API,
          () => {
            salesSummaryPage.selectPreset(p.salesSummary);
            salesSummaryPage.search();
          },
          (f) => sameDates(f, p.range) && allStores(f),
          `Overall Sales Summary, All Stores, ${p.salesSummary}`,
          10
        )
        .then((call) => {
          const api = summaryTotals(call.body);
          return readSettled(
            () => salesSummaryPage.cardValues(SALES_SUMMARY_CARDS),
            (shown) => cents(shown["Gross Sales"]) === cents(api.gross)
          ).then((shown) => {
            ui[p.label].ss = shown;
            [
              ["Gross Sales", api.gross, "money"],
              ["Discounts", api.discount, "money"],
              ["Loyalty Points Redeemed", api.loyalty, "money"],
              ["Refunds", api.refund, "money"],
              ["Store Credit Refunds", api.storeCreditRefund, "money"],
              ["Net Sales", api.net, "money"],
              ["Profit Margin", api.margin, "percent"],
            ].forEach(([label, value, format]) =>
              record(p.range, `Sales Summary page shows its API · ${label}`, format, [
                ["Page", shown[label]],
                ["API", value],
              ])
            );
          });
        });
    });

    // The three pages against each other, as shown. Pages are read a few
    // minutes apart, so a range that includes today can differ only because
    // sales came in meanwhile - test 2 compares those back to back.
    cy.then(() => {
      presets.forEach((p) => {
        const { item, cat, ss } = ui[p.label];
        if (!item) return; // no sales in this range - see the Item Sold part above
        const when = p.range.isCurrentPeriod ? " (pages read minutes apart - see test 2)" : "";
        const rows = [
          ["Sold Qty", "count", [["Item Sold page · Sold", item.qty], ["Category Sold · Sold Qty (its API)", cat.qty]]],
          ["Subtotal = Gross Sales", "money", [["Item Sold page", item.subtotal], ["Category Sold page", cat.subtotal], ["Sales Summary page · Gross Sales", ss["Gross Sales"]]]],
          ["Discounts", "money", [["Item Sold page", item.discounts], ["Category Sold page", cat.discounts], ["Sales Summary page · Discounts + Loyalty Points Redeemed", ss.Discounts + ss["Loyalty Points Redeemed"]]]],
          ["Refunds", "money", [["Item Sold page", item.refunds], ["Category Sold page", cat.refunds], ["Sales Summary page · Refunds + Store Credit Refunds", ss.Refunds + ss["Store Credit Refunds"]]]],
          ["Subtotal w/ Discounts = Net Sales", "money", [["Item Sold page", item.net], ["Category Sold page", cat.net], ["Sales Summary page · Net Sales", ss["Net Sales"]]]],
          ["Total", "money", [["Item Sold page", item.total], ["Category Sold page", cat.total]]],
          ["Cost", "money", [["Item Sold page", item.cost], ["Category Sold page", cat.cost]]],
          ["Profit", "money", [["Item Sold page", item.profit], ["Category Sold page", cat.profit]]],
          ["Margin = Profit Margin", "percent", [["Item Sold page", item.margin], ["Category Sold page", cat.margin], ["Sales Summary page · Profit Margin", ss["Profit Margin"]]]],
        ];
        rows.forEach(([label, format, pairs]) => record(p.range, `Pages as shown · ${label}${when}`, format, pairs));
      });
    });

    finish(title);
  });

  it("API: Item Sold vs Category Sold vs Sales Summary, all stores, every date range", function () {
    const title = this.test.title;
    const record = (label, format, pairs) => recordRows(title, [makeRow("Rock N Roll", { label: "store list", startDate: "-", endDate: "-" }, label, format, pairs)]);

    captureTemplates(record).then((t) => {
      reportsApi.storesLabel(t.storeIds).then((label) => cy.task("log", label, { log: false }));
      const store = allStoresLabel(t.storeIds);

      apiDateRanges().forEach((range) => {
        checkTotals(t, t.storeIds, store, range).then(({ rows }) => {
          recordRows(title, rows);
          // Every row added up = the Total row - only for ranges that are
          // over: fetching every row takes minutes, and today's sales would
          // change the figures in between. (Category by category is in
          // test 3, one store at a time - see perCategoryRows.)
          if (range.isCurrentPeriod) return;
          fetchEveryRow(t, t.storeIds, range).then((every) => recordRows(title, rowSumRows(store, range, every)));
        });
      });
    });

    finish(title);
  });

  it("API: every Rock N Roll store on its own, and all stores added up", function () {
    const title = this.test.title;
    const record = (label, format, pairs) => recordRows(title, [makeRow("Rock N Roll", { label: "store list", startDate: "-", endDate: "-" }, label, format, pairs)]);
    const ranges = apiDateRanges().filter((r) => PER_STORE_RANGES.includes(r.label));
    const categoryRange = apiDateRanges().find((r) => r.label === CATEGORY_RANGE && !r.isCurrentPeriod);
    const sums = {};

    captureTemplates(record).then((t) => {
      reportsApi.storesLabel(t.storeIds).then(() => {
        const names = reportsApi.storeNames || {};
        // rockNRollStoreLimit (env): only the first N stores - for a quick try.
        const limit = Number(Cypress.env("rockNRollStoreLimit")) || 0;
        const storeIds = limit ? t.storeIds.slice(0, limit) : t.storeIds;
        storeIds.forEach((id, index) => {
          const store = `${names[id] || "?"} (${id})`;
          let checks = 0;
          let mismatches = 0;
          ranges.forEach((range) => {
            checkTotals(t, [id], store, range).then(({ rows, totals }) => {
              checks += rows.length;
              mismatches += rows.filter((r) => !r.match).length;
              recordRows(title, rows, { quiet: true });
              const sum = (sums[range.label] = sums[range.label] || { item: {}, cat: {}, ss: {} });
              ["item", "cat", "ss"].forEach((report) =>
                Object.entries(totals[report]).forEach(([k, v]) => (sum[report][k] = (sum[report][k] || 0) + v))
              );
            });
          });
          // Row by row and category by category, in this store alone.
          if (categoryRange) {
            fetchEveryRow(t, [id], categoryRange).then((every) => {
              const rows = [...rowSumRows(store, categoryRange, every), ...perCategoryRows(store, categoryRange, every)];
              checks += rows.length;
              mismatches += rows.filter((r) => !r.match).length;
              recordRows(title, rows, { quiet: true });
            });
          }
          cy.then(() => {
            Cypress.log({
              name: mismatches ? "mismatch" : "match",
              displayName: `${index + 1}/${storeIds.length}`,
              message: `${store}: ${checks} checks, ${mismatches} mismatch(es)`,
            });
            cy.task("log", `${index + 1}/${storeIds.length} ${store}: ${checks} checks, ${mismatches} mismatch(es)`, { log: false });
          });
        });

        // Every store added up = all stores together. Only for ranges that
        // are over - the per-store loop takes many minutes.
        ranges
          .filter((r) => !r.isCurrentPeriod && storeIds.length === t.storeIds.length)
          .forEach((range) => {
            fetchTotals(t, t.storeIds, range).then((all) => {
              const sum = sums[range.label];
              const store = allStoresLabel(t.storeIds);
              const rows = [
                ["item", "Item Sold", [["subtotal", "Subtotal"], ["discounts", "Discounts"], ["refunds", "Refunds"], ["net", "Subtotal w/ Discounts"], ["cost", "Cost"], ["profit", "Profit"], ["qty", "Sold"]]],
                ["cat", "Category Sold", [["subtotal", "Subtotal"], ["discounts", "Discounts"], ["refunds", "Refunds"], ["net", "Subtotal w/ Discounts"], ["cost", "Cost"], ["profit", "Profit"], ["qty", "Sold Qty"]]],
                ["ss", "Sales Summary", [["gross", "Gross Sales"], ["discount", "Discounts"], ["loyalty", "Loyalty Points Redeemed"], ["refund", "Refunds"], ["storeCreditRefund", "Store Credit Refunds"], ["net", "Net Sales"]]],
              ].flatMap(([report, name, fields]) =>
                fields.map(([k, label]) =>
                  makeRow(
                    store,
                    range,
                    `${name} · every store added up = All Stores · ${label}`,
                    k === "qty" ? "count" : "money",
                    [
                      [`${t.storeIds.length} stores added up`, sum[report][k]],
                      ["All Stores", all[report][k]],
                    ],
                    report === "ss" ? SALES_SUMMARY_REFUND_TOLERANCE[k] || 0 : 0
                  )
                )
              );
              recordRows(title, rows);
            });
          });
      });
    });

    finish(title);
  });
});
