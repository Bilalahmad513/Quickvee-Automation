const loginPage = require("../pages/LoginPage");
const storeDirectoryPage = require("../pages/StoreDirectoryPage");
const tenderWisePaymentsPage = require("../pages/TenderWisePaymentsPage");
const salesSummaryPage = require("../pages/SalesSummaryPage");
const { TENDERS } = require("../pages/TenderWisePaymentsPage");
const { buildHtml, injectLogStyles, logRow, formatLine, assertNoMismatches } = require("../reports/reconciliationReport");

// Tender wise payments (user, 20 Nov 2026) - a stand-alone spec, not part of
// any suite (npm run test:tender-wise-payments). Maps the Tender Wise
// Payments report onto the Overall Sales Summary's Payment Method Breakdown.
// Only reads data; a mismatch is reported, never "fixed" - it's for the devs.
//
//   Tender Wise Payments                      Overall Sales Summary
//   Summary card  Cash / Credit / Debit Gross =  Cash / Credit / Debit Amount
//   Summary card  Cash / Credit / Debit Net   =  Cash / Credit / Debit Net
//   Table Gross ($) Cash / Credit / Debit     =  Amount
//   Table Net ($)   Cash / Credit / Debit     =  Net
//
// Plus each report's own sums (summary card = GRAND TOTAL = the rows added
// up; Net = Gross - returns; Sales Summary Net = Amount - Refunded), Tender
// returns = Sales Summary Refunded, each page against its API call, and both
// pages asking for the same dates (and stores).
//
// Two kinds of test, for every date filter:
// - one store: the store the session is in (tenderStore / tenderMerchantId,
//   Alcosta smoke shop - PRA0351CA on live) on both pages.
// - all stores (user, 20 Nov 2026: "multiple locations"): All Stores on both
//   pages (every store on that store's account), and each store's row in the
//   Tender table against the Sales Summary with only that store selected.
//
// Live since 25 Nov 2026 (the report was deployed there; before that it ran
// on the test server). To run it on another server, set tenderSiteUrl in
// cypress.env.json (or --env), e.g. https://admin-panel-test.quickvee.us.
const SITE = (Cypress.env("tenderSiteUrl") || "https://quickvee.com").replace(/\/$/, "");
const STORE = Cypress.env("tenderStore") || "Alcosta smoke shop";
// The store is opened by name; its merchant id makes sure it's that store
// and not a similarly named one.
const MERCHANT_ID = Cypress.env("tenderMerchantId") || "PRA0351CA";
Cypress.config("baseUrl", SITE);

// Every date filter (user, 20 Nov 2026). The preset is clicked on the Tender
// Wise Payments page and the dates it then shows are the range. The Sales
// Summary clicks its own preset of the same name and must show the same
// dates; where it has no such preset ("Last 30 Days"), those dates are
// picked in its calendars instead. Ranges that include today can differ a
// little if a sale comes in between reading the two pages.
const PRESETS = ["Today", "Yesterday", "Last 7 Days", "Last 14 Days", "Last 30 Days", "Month to Date", "Year to Date"];

// Matched on the path only: the reports API host differs per server
// (test server: reports-migrations-api.quickvee.us, confirmed live).
const TENDER_API = /\/api\/reports\/tender_wise_payments_fact/;
const SUMMARY_API = /\/api\/reports\/sales_report_api_fact/;

// API field prefix of each tender.
const API_KEY = { Cash: "cash", "Credit Card": "credit_card", "Debit Card": "debit_card" };

const toAmount = (v) => (v === undefined || v === null || v === "" || Number.isNaN(Number(v)) ? null : Math.round(Number(v) * 100) / 100 + 0);
const num = (v) => Number(v || 0);
const idsOf = (value) => String(value || "").split(",").filter(Boolean).sort();

function parseFields(request) {
  if (typeof request.body === "object") return request.body;
  const boundary = (request.headers["content-type"] || "").split("boundary=")[1];
  const fields = {};
  String(request.body)
    .split(`--${boundary}`)
    .forEach((part) => {
      const m = part.match(/name="([^"]+)"\r?\n\r?\n([\s\S]*?)\r?\n$/);
      if (m) fields[m[1]] = m[2];
    });
  return fields;
}

// Runs `trigger`, then yields { fields, body } of the first `pathRe` call
// that `isWanted(fields)` accepts. The pages also call their API on opening
// and on a preset click (confirmed live), so other calls are skipped.
let aliasCounter = 0;
function callAfter(pathRe, trigger, isWanted, describe) {
  aliasCounter += 1;
  const alias = `tenderCall${aliasCounter}`;
  cy.intercept({ method: "POST", url: pathRe }).as(alias);
  return trigger().then((wanted) => {
    const waitFor = (attemptsLeft) =>
      cy.wait(`@${alias}`, { timeout: 60000 }).then(({ request, response }) => {
        const fields = parseFields(request);
        if (isWanted(fields, wanted)) return { fields, body: response.body };
        if (attemptsLeft > 1) return waitFor(attemptsLeft - 1);
        throw new Error(`No ${describe} call (last one sent ${fields.start_date} - ${fields.end_date}, stores ${fields.outlet_ids}).`);
      });
    return waitFor(8);
  });
}

// Reads `read` until `isSettled(value)` or it's out of tries - the page
// redraws a moment after its API answers.
function readSettled(read, isSettled, attemptsLeft = 10) {
  return read().then((value) => {
    if (isSettled(value) || attemptsLeft <= 1) return value;
    return cy.wait(1500, { log: false }).then(() => readSettled(read, isSettled, attemptsLeft - 1));
  });
}

// A report row: `pairs` ([label, value]) must all be equal, in cents. On a
// mismatch the values that differ from the most common one are flagged.
function makeRow(store, range, label, pairs, format = "money") {
  const values = pairs.map(([l, v]) => ({ label: l, raw: v, amount: toAmount(v) }));
  const amounts = values.map((v) => v.amount);
  const match = amounts.every((a) => a !== null) && new Set(amounts.map((a) => Math.round(a * 100))).size === 1;
  if (!match) {
    const counts = Cypress._.countBy(amounts.filter((a) => a !== null));
    const mostCommon = Number(Cypress._.maxBy(Object.keys(counts), (k) => counts[k]));
    values.forEach((v) => (v.differs = v.amount === null || v.amount !== mostCommon));
  }
  const row = { kind: "group", store, range, label, format, values, match };
  row.line = `[${store}] ${formatLine(row)}`;
  return row;
}

// --- Reading the two pages ---------------------------------------------------

const sameDates = (fields, dates) => fields.start_date === dates.startDate && fields.end_date === dates.endDate;

// Tender Wise Payments for `preset` - one store, or all stores. Yields
// { api, fields, range, cards, rows, total }.
function readTender(preset, allStores) {
  const t = {};
  tenderWisePaymentsPage.visit();
  callAfter(
    TENDER_API,
    () => {
      tenderWisePaymentsPage.selectPreset(preset);
      if (allStores) tenderWisePaymentsPage.selectAllStoresAndSearch();
      else tenderWisePaymentsPage.search();
      return tenderWisePaymentsPage.shownDates();
    },
    (fields, dates) => sameDates(fields, dates) && (allStores ? idsOf(fields.outlet_ids).length > 1 : idsOf(fields.outlet_ids).length === 1),
    `Tender Wise Payments ${preset}${allStores ? ", All Stores" : ""}`
  ).then((call) => {
    expect(call.body.status, "Tender Wise Payments API status").to.equal(true);
    t.api = call.body;
    t.fields = call.fields;
    t.range = { label: preset, startDate: call.fields.start_date, endDate: call.fields.end_date };
  });
  cy.then(() =>
    readSettled(
      () => tenderWisePaymentsPage.summaryCards(),
      (cards) => toAmount(cards.Cash.gross) === toAmount(t.api.summary.cash_gross)
    )
  ).then((cards) => (t.cards = cards));
  tenderWisePaymentsPage.tableRows().then((r) => (t.rows = r));
  tenderWisePaymentsPage.grandTotal().then((g) => (t.total = g));
  return cy.then(() => t);
}

// The Sales Summary's Payment Method Breakdown for `range` (by `preset`, or
// its calendars), with `stores` selected: "current" (as the page opens),
// "all", or a store's name. `storeId`: the store id the call must be for (one
// store) - the page also calls for the store it opened with when a preset
// is clicked (confirmed live), which must not be taken for it.
// Yields { api, fields, usedPreset, noData, cards }.
// "No Data Found." (no sales in the range): nothing to read, so it counts as
// $0.00 everywhere.
function readSalesSummary(preset, range, stores, storeId) {
  const s = {};
  salesSummaryPage.visit();
  salesSummaryPage.hasPreset(preset).then((has) => {
    s.usedPreset = has;
    callAfter(
      SUMMARY_API,
      () => {
        if (has) salesSummaryPage.selectPreset(preset);
        else salesSummaryPage.selectDates(range);
        if (stores === "all") salesSummaryPage.selectAllStoresAndSearch();
        else if (stores === "current") salesSummaryPage.search();
        else salesSummaryPage.selectOnlyStoreAndSearch(stores);
        return salesSummaryPage.shownDates();
      },
      (fields, dates) =>
        sameDates(fields, dates) &&
        (stores === "all" ? idsOf(fields.outlet_ids).length > 1 : fields.outlet_ids === storeId),
      `Overall Sales Summary ${preset}, ${stores}`
    ).then((call) => {
      s.api = call.body;
      s.fields = call.fields;
    });
  });
  cy.then(() =>
    readSettled(
      () => salesSummaryPage.paymentBreakdown(TENDERS),
      // Right after a new Search the page can still show the previous
      // result - e.g. "No Data Found." for the Today it opened on (confirmed
      // live) - so "No Data Found." only counts once the API really sent no
      // payments, and cards only once they show the API's Cash amount.
      (cards) => {
        const byTender = (s.api.result || {}).sales_by_tender_type;
        const apiEmpty = !byTender || TENDERS.every((tender) => num((byTender[API_KEY[tender]] || {}).collected) === 0 && num((byTender[API_KEY[tender]] || {}).refunds) === 0);
        if (cards === null) return apiEmpty;
        return Boolean(cards.Cash) && toAmount(cards.Cash.amount) === toAmount(((byTender || {}).cash || {}).collected || 0);
      }
    )
  ).then((cards) => {
    s.noData = cards === null;
    s.cards = cards || Object.fromEntries(TENDERS.map((tender) => [tender, { amount: 0, refunded: 0, net: 0 }]));
    if (s.noData) Cypress.log({ name: "warning", displayName: "NOTE", message: `Sales Summary (${stores}) shows "No Data Found." for ${preset} - counted as $0.00` });
  });
  return cy.then(() => s);
}

// --- Checks --------------------------------------------------------------------

// Both pages asked for the same dates: the Sales Summary's, as days after the
// Tender page's - 0 when they're the same.
function dateRows(record, preset, t, s) {
  const daysAfter = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
  const how = s.usedPreset ? `"${preset}"` : "calendar";
  record(`Same dates · start: Tender ${t.range.startDate}, Sales Summary (${how}) ${s.fields.start_date}`, [
    ["Tender Wise Payments", 0],
    ["Sales Summary, days later", daysAfter(t.range.startDate, s.fields.start_date)],
  ], "count");
  record(`Same dates · end: Tender ${t.range.endDate}, Sales Summary (${how}) ${s.fields.end_date}`, [
    ["Tender Wise Payments", 0],
    ["Sales Summary, days later", daysAfter(t.range.endDate, s.fields.end_date)],
  ], "count");
}

// The mapping and both reports' own sums, for the whole selection.
function totalRows(record, t, s) {
  const byTender = (s.api.result || {}).sales_by_tender_type || {};
  const apiValue = (key, field) => {
    const value = (byTender[key] || {})[field];
    return value === undefined && s.noData ? 0 : value;
  };
  const total = t.total || { gross: {}, net: {} };
  TENDERS.forEach((tender) => {
    const key = API_KEY[tender];
    const ss = s.cards[tender] || {};
    const sumOf = (side) => t.rows.reduce((sum, r) => sum + num(r[side][tender]), 0);

    // The mapping asked for.
    record(`${tender} · Summary Gross = Sales Summary Amount`, [
      ["Tender Summary · Gross", t.cards[tender].gross],
      ["Sales Summary · Amount", ss.amount],
    ]);
    record(`${tender} · Summary Net = Sales Summary Net`, [
      ["Tender Summary · Net", t.cards[tender].net],
      ["Sales Summary · Net", ss.net],
    ]);
    record(`${tender} · Gross ($) = Sales Summary Amount`, [
      ["Tender table · Gross ($) GRAND TOTAL", t.total ? total.gross[tender] : 0],
      ["Sales Summary · Amount", ss.amount],
    ]);
    record(`${tender} · Net ($) = Sales Summary Net`, [
      ["Tender table · Net ($) GRAND TOTAL", t.total ? total.net[tender] : 0],
      ["Sales Summary · Net", ss.net],
    ]);

    // Each report's own sums.
    record(`${tender} · Tender Summary Gross = GRAND TOTAL = rows added up`, [
      ["Summary card", t.cards[tender].gross],
      ["GRAND TOTAL", t.total ? total.gross[tender] : 0],
      [`${t.rows.length} row(s) added up`, sumOf("gross")],
    ]);
    record(`${tender} · Tender Summary Net = GRAND TOTAL = rows added up`, [
      ["Summary card", t.cards[tender].net],
      ["GRAND TOTAL", t.total ? total.net[tender] : 0],
      [`${t.rows.length} row(s) added up`, sumOf("net")],
    ]);
    record(`${tender} · Tender Net = Gross - returns`, [
      ["Gross - returns (its API)", num(t.api.summary[`${key}_gross`]) - num(t.api.summary[`${key}_returns`])],
      ["Net shown", t.cards[tender].net],
    ]);
    record(`${tender} · Sales Summary Net = Amount - Refunded`, [
      ["Amount - Refunded", num(ss.amount) - num(ss.refunded)],
      ["Net shown", ss.net],
    ]);
    record(`${tender} · Tender returns = Sales Summary Refunded`, [
      ["Tender returns (its API)", t.api.summary[`${key}_returns`]],
      ["Sales Summary · Refunded", ss.refunded],
    ]);

    // Each page shows what its API sent.
    record(`${tender} · Tender page shows its API (Gross)`, [
      ["Page Gross", t.cards[tender].gross],
      ["API gross", t.api.summary[`${key}_gross`]],
    ]);
    record(`${tender} · Tender page shows its API (Net)`, [
      ["Page Net", t.cards[tender].net],
      ["API net", t.api.summary[`${key}_net`]],
    ]);
    record(`${tender} · Sales Summary page shows its API (Amount)`, [
      ["Page Amount", ss.amount],
      ["API collected", apiValue(key, "collected")],
    ]);
    record(`${tender} · Sales Summary page shows its API (Refunded)`, [
      ["Page Refunded", ss.refunded],
      ["API refunds", apiValue(key, "refunds")],
    ]);
  });
}

// -----------------------------------------------------------------------------

describe("Tender wise payments", () => {
  const rowsByTest = {};

  before(() => {
    injectLogStyles();
  });

  beforeEach(function () {
    rowsByTest[this.currentTest.title] = [];
    // Its own session (keyed on the site too), so a session from another
    // server is never reused here.
    cy.session(["tenderWisePayments", SITE, STORE, MERCHANT_ID], () => {
      loginPage.login(Cypress.env("storeName"), Cypress.env("username"), Cypress.env("password"), { site: SITE });
      storeDirectoryPage.enterStore(STORE).then((merchantId) => {
        expect(merchantId, `merchant id of the "${STORE}" store that was opened`).to.equal(MERCHANT_ID);
      });
    });
  });

  after(() => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp =
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_` +
      `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const rows = Object.values(rowsByTest).flat();
    const file = `cypress/reports-output/tender-wise-payments-${stamp}.html`;
    cy.writeFile(file, buildHtml(rows, now.toLocaleString(), `Tender wise payments (${SITE})`));
    cy.writeFile(
      `cypress/reports-output/tender-wise-payments-${stamp}-mismatches.txt`,
      rows.filter((r) => !r.match).map((r) => r.line).join("\n") || "No mismatches."
    );
    cy.task("log", `HTML report written to ${file}`);
  });

  function recorder(title, getStore, getRange) {
    return (label, pairs, format) => {
      const row = makeRow(getStore(), getRange(), label, pairs, format);
      logRow(row);
      if (!row.match) cy.task("log", row.line, { log: false });
      rowsByTest[title].push(row);
    };
  }

  function finish(title) {
    cy.then(() => {
      const rows = rowsByTest[title];
      expect(rows, "checks run").to.not.be.empty;
      assertNoMismatches(rows.filter((r) => !r.match));
    });
  }

  // One store: the store the session is in, on both pages.
  PRESETS.forEach((preset) => {
    it(`Tender Wise Payments = Overall Sales Summary (${STORE}, ${preset})`, function () {
      const title = this.test.title;
      let t;
      let s;
      const record = recorder(title, () => `${STORE} (${t.fields.merchant_id})`, () => t.range);

      readTender(preset, false).then((tender) => {
        t = tender;
        expect(t.fields.outlet_ids, `Tender Wise Payments asked for ${STORE}`).to.equal(MERCHANT_ID);
      });
      cy.then(() => readSalesSummary(preset, t.range, "current", MERCHANT_ID)).then((summary) => (s = summary));
      cy.then(() => {
        dateRows(record, preset, t, s);
        totalRows(record, t, s);
      });
      finish(title);
    });
  });

  // All stores: All Stores on both pages, then each store's Tender row
  // against the Sales Summary with only that store.
  PRESETS.forEach((preset) => {
    it(`Tender Wise Payments = Overall Sales Summary (All stores, ${preset})`, function () {
      const title = this.test.title;
      let t;
      let s;
      let storeLabel = "All stores";
      const record = recorder(title, () => storeLabel, () => t.range);

      readTender(preset, true).then((tender) => {
        t = tender;
        storeLabel = `${t.api.org_name || "Account"} · All stores (${idsOf(t.fields.outlet_ids).length})`;
      });
      cy.then(() => readSalesSummary(preset, t.range, "all")).then((summary) => (s = summary));
      cy.then(() => {
        dateRows(record, preset, t, s);
        // Both pages' "All Stores" are the same stores.
        const tenderIds = idsOf(t.fields.outlet_ids);
        const summaryIds = idsOf(s.fields.outlet_ids);
        const onlyOne = [...tenderIds.filter((id) => !summaryIds.includes(id)), ...summaryIds.filter((id) => !tenderIds.includes(id))];
        record(`Same stores under All Stores${onlyOne.length ? ` - only on one page: ${onlyOne.join(", ")}` : ""}`, [
          ["Tender Wise Payments stores", tenderIds.length],
          ["Sales Summary stores", summaryIds.length],
          ["Stores on both", tenderIds.filter((id) => summaryIds.includes(id)).length],
        ], "count");
        record("Tender table has one row per store", [
          ["Rows", t.rows.length],
          ["Stores", tenderIds.length],
        ], "count");
        totalRows(record, t, s);
      });

      // Each store's row in the Tender table = the Sales Summary with only
      // that store selected.
      cy.then(() => {
        (t.api.rows || []).forEach((apiRow) => {
          const name = apiRow.store_name;
          readSalesSummary(preset, t.range, name, apiRow.merchant_id).then((one) => {
            const pageRow = t.rows.find((r) => r.store === name) || { gross: {}, net: {} };
            record(`${name} · Sales Summary asked for this store only`, [
              ["Stores sent", idsOf(one.fields.outlet_ids).length],
              ["Expected", 1],
              [`Is ${apiRow.merchant_id}`, one.fields.outlet_ids === apiRow.merchant_id ? 1 : 0],
            ], "count");
            TENDERS.forEach((tender) => {
              const key = API_KEY[tender];
              const ss = one.cards[tender] || {};
              record(`${name} · ${tender} · Tender row Gross ($) = Sales Summary Amount`, [
                ["Tender row Gross ($)", pageRow.gross[tender]],
                ["Tender API gross", apiRow[`${key}_gross`]],
                [`Sales Summary (${name}) · Amount`, ss.amount],
              ]);
              record(`${name} · ${tender} · Tender row Net ($) = Sales Summary Net`, [
                ["Tender row Net ($)", pageRow.net[tender]],
                ["Tender API net", apiRow[`${key}_net`]],
                [`Sales Summary (${name}) · Net`, ss.net],
              ]);
              record(`${name} · ${tender} · Tender returns = Sales Summary Refunded`, [
                ["Tender API returns", apiRow[`${key}_returns`]],
                [`Sales Summary (${name}) · Refunded`, ss.refunded],
              ]);
            });
          });
        });
      });
      finish(title);
    });
  });
});
