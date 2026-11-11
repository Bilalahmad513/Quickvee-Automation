const reorderPage = require("../../pages/ReorderReportNewPage");
const { enterQaStore } = require("../../support/qaStoreEntry");
const { injectLogStyles } = require("../../reports/reconciliationReport");
const { buildQaReorderHtml, formatCheckLine, statusText } = require("../../reports/qaReorderReportHtml");

// QA Testing 02 - Reorder Report - New (quickvee-qa.com, VEON01 /
// HAM683004NC). READ ONLY: the suite opens the report, changes its filters,
// reads the screen and replays the report's own read requests - nothing is
// created, edited, deleted or exported.
//
// Focus:
//   1. The Total row - on screen (every row loaded by scrolling, added up
//      column by column, struck-through rows looked for) and in the data
//      (all rows of every date range x measure added up against the totals
//      call), with the rows that explain any difference.
//   2. Filters - the data each one returns is what it says: date ranges
//      (per product, additive across custom ranges, start/closing stock
//      carried over), Measure, Report Type groups, Search, Outlet - in the
//      data and on screen.
// Report: cypress/e2e/reports/reorderreport.html
const STORE = { name: "VEON01", searchName: "Veon01", id: "HAM683004NC" };
const REPORT_FILE = "cypress/e2e/reports/reorderreport.html";
const RANGES = ["Today", "Yesterday", "Last 7 Days", "Last 30 Days"];
const MEASURES = ["All inventory", "On-hand-inventory", "Low inventory", "Out of stock"];
const MEASURE_RULES = {
  "All inventory": { test: () => true, text: "every product" },
  "On-hand-inventory": { test: (r) => n0(r.current_inventory) > 0, text: "current inventory > 0" },
  "Low inventory": { test: (r) => n0(r.current_inventory) <= n0(r.reorder_point), text: "current inventory ≤ reorder point" },
  "Out of stock": { test: (r) => n0(r.current_inventory) <= 0, text: "current inventory ≤ 0" },
};
// Totals the rows should add up to.
const SUM_KEYS = ["items_sold", "closing_inventory", "current_inventory", "inbound_inventory", "net_sale", "gross_profit", "sale_count", "cost_goods_sold", "inventory_cost", "return_count", "discount_value", "retail_value"];
// Total row column -> totals key.
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

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysAgo = (n, now = new Date()) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - n);
function rangeDates(label) {
  const r = { Today: [0, 0], Yesterday: [1, 1], "Last 7 Days": [6, 0], "Last 30 Days": [29, 0] }[label];
  return { start: ymd(daysAgo(r[0])), end: ymd(daysAgo(r[1])), from: r[0], to: r[1], days: r[0] - r[1] + 1 };
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
const close = (a, b, tol = 0.011) => a !== null && b !== null && a !== undefined && b !== undefined && Math.abs(a - b) <= tol;
const lower = (s) => String(s ?? "").toLowerCase();
const keyOf = (r) => `${r.product_id}|${r.variant || ""}`;
const label = (r) => `${r.name} (#${r.product_id})`;
const sumOf = (rows, k) => round2(rows.reduce((t, r) => t + n0(r[k]), 0));
const escapeHtml = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// The rows (with sales) whose items sold, net sale and COGS add up exactly
// to `diff` - the rows a total leaves out. null when none do.
function explainDiff(rows, diff) {
  const cand = rows.filter((r) => n0(r.items_sold) || n0(r.net_sale) || n0(r.cost_goods_sold)).slice(0, 20);
  const n = cand.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    let a = 0;
    let b = 0;
    let c = 0;
    for (let i = 0; i < n; i++)
      if (mask & (1 << i)) {
        a += n0(cand[i].items_sold);
        b += n0(cand[i].net_sale);
        c += n0(cand[i].cost_goods_sold);
      }
    if (Math.abs(a - diff.items_sold) < 0.001 && Math.abs(b - diff.net_sale) < 0.011 && Math.abs(c - diff.cost_goods_sold) < 0.011) return cand.filter((_, i) => mask & (1 << i));
  }
  return null;
}

describe("QA Testing 02 - Reorder Report", { baseUrl: "https://quickvee-qa.com", retries: 0, testIsolation: false, defaultCommandTimeout: 30000 }, () => {
  const checks = [];
  const calls = [];
  const data = {}; // range -> { call, totalsCall, rows, totals, total }
  const combos = []; // totals breakdown rows for the report
  const runInfo = { uncaught: [] };
  let entry = null;

  function check(area, name, fields) {
    const c = { area, name, ...fields };
    checks.push(c);
    Cypress.log({ name: c.status.toLowerCase(), displayName: statusText(c.status), message: `**${area}** · ${name}${c.status === "Fail" ? ` (${c.severity})` : ""}` });
    cy.task("log", formatCheckLine(c), { log: false });
  }

  // Rows from a replay of the range's list call, with `overrides`.
  const fetchRows = (range, overrides) => reorderPage.fetchAllRows(data[range].call, overrides, 100);
  const fetchTotals = (range, overrides) =>
    reorderPage.fetchTotals(data[range].totalsCall, overrides).then((res) => ({ totals: (res.body && res.body.totals) || {}, total: Number(res.body && res.body.total_records), status: res.status }));

  // Totals of one filter combination against its rows; records the
  // breakdown and the rows that explain a difference.
  function compareTotals(area, comboName, rows, totals, totalRecords) {
    const diffs = {};
    const lines = SUM_KEYS.map((k) => {
      const sum = sumOf(rows, k);
      const api = num(totals[k]);
      diffs[k] = round2(sum - n0(api));
      return { key: k, sum, api, ok: close(sum, api, 0.05) };
    });
    const bad = lines.filter((l) => !l.ok);
    let explained = null;
    if (bad.some((l) => ["items_sold", "net_sale", "cost_goods_sold"].includes(l.key)) && diffs.items_sold >= 0) explained = explainDiff(rows, diffs);
    combos.push({ comboName, rows: rows.length, totalRecords, lines, explained });
    check(area, `${comboName}: totals = sum of the ${rows.length} rows`, {
      expected: "every total = its rows added up",
      actual: bad.length ? `${bad.length} of ${lines.length} totals differ: ${bad.map((l) => `${l.key} rows ${l.sum} vs total ${l.api}`).join("; ")}` : `all ${lines.length} totals match`,
      status: bad.length ? "Fail" : "Pass",
      severity: "High",
      details: explained
        ? `The totals leave out exactly these rows (their items sold, net sale and COGS make up the whole difference): ${explained.map((r) => `${r.name} (sold ${r.items_sold}, net ${r.net_sale})`).join(", ")}. The table still lists them.`
        : bad.length
        ? "No set of rows explains the difference - the totals are worked out differently from the rows."
        : "",
    });
    check(area, `${comboName}: row count (list = totals call)`, { expected: rows.length, actual: totalRecords, status: rows.length === totalRecords ? "Pass" : "Fail", severity: "Medium" });
  }

  // Rows on screen whose text is struck through.
  function struckRows() {
    return Cypress.$("tbody tr")
      .toArray()
      .filter((tr) => [tr, ...tr.querySelectorAll("*")].some((e) => /line-through/.test(getComputedStyle(e).textDecorationLine) || /^(S|DEL|STRIKE)$/.test(e.tagName)))
      .map((tr) => (tr.children[0] ? tr.children[0].innerText.trim() : ""));
  }

  // Loads every row on screen (scrolling), adds every summable column up
  // and checks the Total row - the screen only.
  function screenTotals(area, what, expectedRows) {
    reorderPage.scrollToLoadAll(expectedRows, 80).then((seen) => {
      check(area, `${what}: every row loaded on screen`, { expected: expectedRows, actual: seen, status: seen >= expectedRows ? "Pass" : "Fail", severity: "High" });
    });
    return reorderPage.readTable().then((t) => {
      const idx = (h) => t.headers.indexOf(h);
      const struck = struckRows();
      const sums = {};
      const struckSums = {};
      Object.keys(TOTAL_COLUMNS).forEach((h) => {
        const c = idx(h);
        if (c < 0) return;
        sums[h] = round2(t.rows.reduce((s, cells) => s + n0(cells[c]), 0));
        struckSums[h] = round2(t.rows.filter((cells) => struck.includes(cells[0])).reduce((s, cells) => s + n0(cells[c]), 0));
      });
      const diffs = [];
      Object.keys(sums).forEach((h) => {
        if (h === "Customer count") return;
        const shown = t.total ? num(t.total[idx(h)]) : null;
        if (!close(sums[h], shown, 0.05)) diffs.push({ column: h, "rows on screen added up": sums[h], "Total row": t.total ? t.total[idx(h)] : "(no Total row)", "struck-through rows": struckSums[h] });
      });
      if (!t.rows.length && !t.total) {
        check(area, `${what}: Total row`, { expected: "rows and a Total row", actual: `no rows${t.noData ? ", \"No Data Found\"" : ""}, no Total row`, status: "Info" });
        return cy.wrap(t, { log: false });
      }
      check(area, `${what}: Total row = the ${t.rows.length} rows on screen added up`, {
        how: "Screen only: every loaded row's cell added up per column, against the Total row.",
        expected: `${Object.keys(sums).length - 1} columns match`,
        actual: `${Object.keys(sums).length - 1 - diffs.length} match, ${diffs.length} differ`,
        status: diffs.length ? "Fail" : "Pass",
        severity: "High",
        details: diffs.length && struck.length ? "Check whether the struck-through rows are in or out of the Total (their column sums are shown)." : "",
        examples: diffs,
      });
      check(area, `${what}: struck-through (deleted) rows`, {
        expected: "listed, and counted in the Total the same way as the row data",
        actual: struck.length ? `${struck.length}: ${struck.slice(0, 15).join(", ")}` : "none on screen",
        status: "Info",
      });
      return cy.wrap(t, { log: false });
    });
  }

  before(() => {
    injectLogStyles();
    Cypress.on("uncaught:exception", (err) => {
      runInfo.uncaught.push(String(err && err.message).slice(0, 300));
      return false;
    });
    enterQaStore(STORE.searchName, STORE.id).then((found) => (entry = found));
  });

  beforeEach(() => {
    reorderPage.recordCalls(calls);
  });

  after(() => {
    checks.push(
      runInfo.uncaught.length
        ? { area: "Stability", name: "No uncaught JavaScript errors", expected: 0, actual: runInfo.uncaught.length, status: "Fail", severity: "Medium", examples: runInfo.uncaught.slice(0, 10).map((m) => ({ error: m })) }
        : { area: "Stability", name: "No uncaught JavaScript errors", expected: 0, actual: 0, status: "Pass" }
    );
    const breakdown = combos.length
      ? `<h2>Totals breakdown (every filter combination checked)</h2>
  <table><thead><tr><th>Filters</th><th>Rows</th>${SUM_KEYS.map((k) => `<th>${k}</th>`).join("")}</tr></thead><tbody>
  ${combos
    .map(
      (c) => `<tr class="${c.lines.every((l) => l.ok) ? "pass" : "fail"}"><td><b>${escapeHtml(c.comboName)}</b>${
        c.explained ? `<div class="note">Left out of the totals: ${escapeHtml(c.explained.map((r) => r.name).join(", "))}</div>` : ""
      }</td><td>${c.rows}</td>${c.lines.map((l) => `<td${l.ok ? "" : ' style="background:#fee2e2;color:#991b1b;font-weight:600"'}>rows ${l.sum.toLocaleString("en-US")}<br>total ${l.api === null ? "—" : l.api.toLocaleString("en-US")}</td>`).join("")}</tr>`
    )
    .join("")}
  </tbody></table>`
      : "";
    const info = {
      Store: `${STORE.name} (${STORE.id})`,
      Environment: "https://quickvee-qa.com (QA)",
      Page: `https://quickvee-qa.com${reorderPage.PAGE_URL}`,
      "Store found in": entry ? `${entry.list} Stores (search "${entry.term}")` : "not found",
      "Filters tested": `Date: ${RANGES.join(", ")} + custom ranges · Measure: ${MEASURES.join(", ")} · Report Type: Product, Brand, Vendor, Category · Search · Outlet`,
      Operation: "Read only - nothing created, edited, deleted or exported",
      Generated: new Date().toLocaleString(),
    };
    cy.writeFile(REPORT_FILE, buildQaReorderHtml({ info, checks, title: "QA Testing 02 - Reorder Report", extraHtml: breakdown }));
    cy.task("log", `HTML report written to ${Cypress.config("projectRoot")}/${REPORT_FILE}`);
    cy.task("log", `QA Testing 02: ${checks.length} checks, ${checks.filter((c) => c.status === "Pass").length} pass, ${checks.filter((c) => c.status === "Fail").length} fail, ${checks.filter((c) => c.status === "Info").length} info`);
  });

  it("opens VEON01 (HAM683004NC) and the report, every column shown", () => {
    const area = "Store and page";
    cy.then(() =>
      check(area, "Store opened by its Merchant ID (Inactive, then Live Stores)", {
        expected: STORE.id,
        actual: entry ? `${STORE.id} in ${entry.list} Stores` : "not found",
        status: entry ? "Pass" : "Fail",
        severity: "Critical",
        details: entry && entry.notes.length ? `Searches before it was found: ${entry.notes.join("; ")}` : "",
      })
    );
    const from = calls.length;
    reorderPage.visit();
    reorderPage.waitForCall(calls, from, "list", () => true, "page open").then((call) => {
      check(area, "Report asks for VEON01", { expected: STORE.id, actual: call.fields.merchant_id, status: call.fields.merchant_id === STORE.id ? "Pass" : "Fail", severity: "Critical" });
      const total = Number(call.body && call.body.total_records);
      check(area, "Report lists the store's products", {
        expected: "the store's products (485 listed by this report earlier on 2026-11-04)",
        actual: `${total} products (HTTP ${call.status}, status ${call.body && call.body.status})`,
        status: total > 0 ? "Pass" : "Fail",
        severity: "High",
        details: total > 0 ? "" : "The report answers successfully but with no rows for every date range and filter. Earlier today the same request returned 485 products for VEON01. Either the store's products were removed on QA, or the report stopped returning them - check VEON01's Products page to tell which. Every calculation below runs on an empty result.",
      });
    });
    reorderPage.showAllColumns();
    // Outlet: the text next to its "Outlet" label.
    cy.get("body").then(($body) => {
      const labelEl = $body.find("label, p, span, div").toArray().find((e) => e.children.length === 0 && e.textContent.trim() === "Outlet");
      const box = labelEl ? labelEl.parentElement : null;
      const shown = box ? box.innerText.replace(/^\s*Outlet\s*/, "").replace(/\s+/g, " ").trim() : "";
      check(area, "Outlet shows the store", { expected: STORE.name, actual: shown || "(not found)", status: lower(shown).includes(lower(STORE.name)) ? "Pass" : "Fail", severity: "Medium" });
    });
  });

  RANGES.forEach((range) => {
    it(`${range}: rows and totals (data), Total row (screen)`, () => {
      const area = `Totals - ${range}`;
      const dates = rangeDates(range);
      reorderPage.quickDate(range).click();
      reorderPage
        .waitForCall(calls, 0, "list", (f) => f.start_date === dates.start && f.end_date === dates.end && String(f.page) === "1" && !f.search_by && f.measure_type === "All inventory" && f.report_type === "Product", `${range} list`)
        .then((call) => {
          data[range] = { call, dates };
          return reorderPage.waitForCall(calls, 0, "totals", (f) => f.start_date === dates.start && f.end_date === dates.end && !f.search_by && f.measure_type === "All inventory" && f.report_type === "Product", `${range} totals`);
        })
        .then((totalsCall) => {
          data[range].totalsCall = totalsCall;
          data[range].totals = (totalsCall.body && totalsCall.body.totals) || {};
          return fetchRows(range, {});
        })
        .then(({ rows, total }) => {
          data[range].rows = rows;
          data[range].total = total;
          check(area, "All rows fetched", { expected: total, actual: rows.length, status: rows.length === total ? "Pass" : "Fail", severity: "High" });
          compareTotals(area, `${range} · All inventory · Product`, rows, data[range].totals, Number(data[range].totalsCall.body.total_records));
          const custSum = sumOf(rows, "customer_count");
          check(area, "Customer count total ≤ customers of all rows", { expected: `≤ ${custSum}`, actual: num(data[range].totals.customer_count), status: n0(data[range].totals.customer_count) <= custSum ? "Pass" : "Fail", severity: "Low" });
          // Gross profit total = net sale total - COGS total.
          const t = data[range].totals;
          check(area, "Total gross profit = total net sale − total COGS", { expected: round2(n0(t.net_sale) - n0(t.cost_goods_sold)), actual: num(t.gross_profit), status: close(round2(n0(t.net_sale) - n0(t.cost_goods_sold)), num(t.gross_profit), 0.05) ? "Pass" : "Fail", severity: "High" });
        });
      // Total row on screen vs the totals call.
      cy.wait(1500, { log: false });
      reorderPage.readTable().then((t) => {
        const totals = data[range].totals;
        const idx = (h) => t.headers.indexOf(h);
        const diffs = Object.entries(TOTAL_COLUMNS)
          .filter(([h]) => idx(h) >= 0)
          .filter(([h, k]) => !t.total || !close(num(t.total[idx(h)]), round2(n0(totals[k])), 0.05))
          .map(([h, k]) => ({ column: h, "Total row": t.total ? t.total[idx(h)] : "(none)", "totals call": totals[k] }));
        const allZero = Object.values(TOTAL_COLUMNS).every((k) => n0(totals[k]) === 0);
        if (!t.total && !t.rows.length && allZero) check(area, "Total row = totals call", { expected: "Total row", actual: "no rows and no Total row (totals all 0)", status: "Info" });
        else check(area, "Total row = totals call", { expected: 0, actual: diffs.length, status: diffs.length ? "Fail" : "Pass", severity: "High", examples: diffs });
        const blank = ["Items Sold per Day", "Days Cover", "Average Cost", "Margin (%)", "Avg. items per sale", "Discounted (%)", "Avg. sale value", "Returns (%)", "Sell-through rate", "Start date inventory", "Reorder point", "Restock amount"].filter((h) => idx(h) >= 0 && t.total && !String(t.total[idx(h)] || "").trim());
        check(area, "Total row: average / rate columns", { expected: "an overall average or rate (or a dash)", actual: blank.length ? `blank: ${blank.join(", ")}` : "filled", status: "Info" });
      });
      // The screen: every row loaded and added up (two ranges - it takes a while).
      if (range === "Today" || range === "Last 30 Days") cy.then(() => screenTotals(area, `${range} on screen`, data[range].total));
    });
  });

  it("totals for every date range × measure (data)", () => {
    const area = "Totals - every Measure";
    RANGES.forEach((range) => {
      MEASURES.filter((m) => m !== "All inventory").forEach((measure) => {
        fetchRows(range, { measure_type: measure }).then(({ rows }) => {
          fetchTotals(range, { measure_type: measure }).then(({ totals, total }) => compareTotals(area, `${range} · ${measure}`, rows, totals, total));
        });
      });
    });
  });

  it("date filters: each range returns that range's data", () => {
    const area = "Filter - Date";
    cy.then(() => {
      const by = (r) => Cypress._.keyBy(data[r].rows, keyOf);
      const [T, Y, W, M] = RANGES.map(by);
      const keys = Object.keys(M);
      const per = (name, test, fields) => {
        const bad = keys.filter((k) => T[k] && Y[k] && W[k] && !test(k));
        check(area, name, {
          expected: `${keys.length} of ${keys.length} products`,
          actual: `${keys.length - bad.length} of ${keys.length}`,
          status: bad.length ? "Fail" : "Pass",
          severity: "High",
          examples: bad.slice(0, 12).map((k) => ({ product: label(M[k]), ...fields(k) })),
        });
      };
      per("Items sold per product: Today ≤ Last 7 Days ≤ Last 30 Days, Yesterday ≤ Last 7", (k) => n0(T[k].items_sold) <= n0(W[k].items_sold) && n0(Y[k].items_sold) <= n0(W[k].items_sold) && n0(W[k].items_sold) <= n0(M[k].items_sold), (k) => ({ today: T[k].items_sold, yesterday: Y[k].items_sold, "last 7": W[k].items_sold, "last 30": M[k].items_sold }));
      per("Items sold per product: Last 7 Days ≥ Today + Yesterday", (k) => n0(W[k].items_sold) >= n0(T[k].items_sold) + n0(Y[k].items_sold), (k) => ({ today: T[k].items_sold, yesterday: Y[k].items_sold, "last 7": W[k].items_sold }));
      per("Net sale per product: Today ≤ Last 7 Days ≤ Last 30 Days", (k) => n0(T[k].net_sale) <= n0(W[k].net_sale) + 0.01 && n0(W[k].net_sale) <= n0(M[k].net_sale) + 0.01, (k) => ({ today: T[k].net_sale, "last 7": W[k].net_sale, "last 30": M[k].net_sale }));
      per("Closing stock of Yesterday = Start stock of Today", (k) => n0(Y[k].closing_inventory) === n0(T[k].start_date_inventory), (k) => ({ "yesterday closing": Y[k].closing_inventory, "today start": T[k].start_date_inventory }));
      per("Closing stock is the same for every range ending today", (k) => n0(T[k].closing_inventory) === n0(W[k].closing_inventory) && n0(W[k].closing_inventory) === n0(M[k].closing_inventory), (k) => ({ today: T[k].closing_inventory, "last 7": W[k].closing_inventory, "last 30": M[k].closing_inventory, current: M[k].current_inventory }));
      // Sales vs the first / last sale dates.
      RANGES.forEach((range) => {
        const { start, end } = data[range].dates;
        const rows = data[range].rows;
        const soldOutside = rows.filter((r) => n0(r.items_sold) > 0 && ((r.lastSale && r.lastSale < start) || (r.firstSale && r.firstSale > end)));
        check(area, `${range}: products with sales have a sale date in the range`, {
          expected: 0,
          actual: soldOutside.length,
          status: soldOutside.length ? "Fail" : "Pass",
          severity: "High",
          examples: soldOutside.slice(0, 10).map((r) => ({ product: label(r), items_sold: r.items_sold, first_sale: r.firstSale, last_sale: r.lastSale, range: `${start} to ${end}` })),
        });
        const missing = rows.filter((r) => r.lastSale && r.lastSale >= start && r.lastSale <= end && n0(r.items_sold) === 0 && n0(r.sale_count) === 0);
        check(area, `${range}: products last sold inside the range show sales`, {
          expected: 0,
          actual: missing.length,
          status: missing.length ? "Fail" : "Pass",
          severity: "High",
          details: missing.length ? "The product's last sale date is inside the range, yet the range shows no sale for it." : "",
          examples: missing.slice(0, 10).map((r) => ({ product: label(r), last_sale: r.lastSale, items_sold: r.items_sold, range: `${start} to ${end}` })),
        });
      });
    });
    // Custom ranges add up: [30 days ago .. yesterday] + Today = Last 30 Days;
    // [7 days ago .. 4 days ago] + [3 days ago .. today] = Last 7 Days.
    const additive = (name, partA, partB, whole) =>
      fetchRows("Last 30 Days", { start_date: partA[0], end_date: partA[1] }).then(({ rows: a }) =>
        fetchRows("Last 30 Days", { start_date: partB[0], end_date: partB[1] }).then(({ rows: b }) => {
          const A = Cypress._.keyBy(a, keyOf);
          const B = Cypress._.keyBy(b, keyOf);
          const W = data[whole].rows;
          const bad = W.filter((r) => !A[keyOf(r)] || !B[keyOf(r)] || n0(A[keyOf(r)].items_sold) + n0(B[keyOf(r)].items_sold) !== n0(r.items_sold) || !close(round2(n0(A[keyOf(r)].net_sale) + n0(B[keyOf(r)].net_sale)), n0(r.net_sale), 0.02));
          check(area, name, {
            how: `${partA.join(" to ")} + ${partB.join(" to ")} = ${whole}`,
            expected: `${W.length} of ${W.length} products add up (items sold and net sale)`,
            actual: `${W.length - bad.length} of ${W.length}`,
            status: bad.length ? "Fail" : "Pass",
            severity: "High",
            examples: bad.slice(0, 10).map((r) => ({ product: label(r), "part 1 sold": A[keyOf(r)] && A[keyOf(r)].items_sold, "part 2 sold": B[keyOf(r)] && B[keyOf(r)].items_sold, [`${whole} sold`]: r.items_sold, "part 1 net": A[keyOf(r)] && A[keyOf(r)].net_sale, "part 2 net": B[keyOf(r)] && B[keyOf(r)].net_sale, [`${whole} net`]: r.net_sale })),
          });
          return fetchTotals("Last 30 Days", { start_date: partA[0], end_date: partA[1] }).then(({ totals: ta }) =>
            fetchTotals("Last 30 Days", { start_date: partB[0], end_date: partB[1] }).then(({ totals: tb }) => {
              const tw = data[whole].totals;
              const sumItems = n0(ta.items_sold) + n0(tb.items_sold);
              check(area, `${name} - totals`, { expected: `items sold ${n0(tw.items_sold)}`, actual: `${n0(ta.items_sold)} + ${n0(tb.items_sold)} = ${sumItems}`, status: sumItems === n0(tw.items_sold) ? "Pass" : "Fail", severity: "High" });
            })
          );
        })
      );
    cy.then(() => additive("Custom ranges add up to Last 30 Days", [ymd(daysAgo(29)), ymd(daysAgo(1))], [ymd(daysAgo(0)), ymd(daysAgo(0))], "Last 30 Days"));
    cy.then(() => additive("Custom ranges add up to Last 7 Days", [ymd(daysAgo(6)), ymd(daysAgo(3))], [ymd(daysAgo(2)), ymd(daysAgo(0))], "Last 7 Days"));
    // Start stock of Last 7 Days = closing stock of the day before it.
    cy.then(() =>
      fetchRows("Last 30 Days", { start_date: ymd(daysAgo(7)), end_date: ymd(daysAgo(7)) }).then(({ rows }) => {
        const before = Cypress._.keyBy(rows, keyOf);
        const W = data["Last 7 Days"].rows;
        const bad = W.filter((r) => before[keyOf(r)] && n0(before[keyOf(r)].closing_inventory) !== n0(r.start_date_inventory));
        check(area, "Last 7 Days start stock = closing stock of the day before", {
          expected: `${W.length} of ${W.length}`,
          actual: `${W.length - bad.length} of ${W.length}`,
          status: bad.length ? "Fail" : "Pass",
          severity: "High",
          examples: bad.slice(0, 10).map((r) => ({ product: label(r), [`closing ${ymd(daysAgo(7))}`]: before[keyOf(r)].closing_inventory, "Last 7 start": r.start_date_inventory })),
        });
      })
    );
  });

  it("Measure filter: rows follow the rule, counts add up (data and screen)", () => {
    const area = "Filter - Measure";
    ["Today", "Last 30 Days"].forEach((range) => {
      const counts = {};
      MEASURES.forEach((measure) => {
        fetchRows(range, { measure_type: measure }).then(({ rows, total }) => {
          counts[measure] = total;
          const rule = MEASURE_RULES[measure];
          const breaking = rows.filter((r) => !rule.test(r));
          check(area, `${range} · ${measure}: every row has ${rule.text}`, {
            expected: `${rows.length} of ${rows.length}`,
            actual: `${rows.length - breaking.length} of ${rows.length}`,
            status: breaking.length ? "Fail" : "Pass",
            severity: "High",
            examples: breaking.slice(0, 10).map((r) => ({ product: label(r), current_inventory: r.current_inventory, closing_inventory: r.closing_inventory, reorder_point: r.reorder_point })),
          });
        });
      });
      cy.then(() => {
        const all = data[range].rows;
        const exp = (m) => all.filter(MEASURE_RULES[m].test).length;
        check(area, `${range}: On-hand count = products with stock`, { expected: exp("On-hand-inventory"), actual: counts["On-hand-inventory"], status: counts["On-hand-inventory"] === exp("On-hand-inventory") ? "Pass" : "Fail", severity: "High" });
        check(area, `${range}: Out of stock count = products without stock`, { expected: exp("Out of stock"), actual: counts["Out of stock"], status: counts["Out of stock"] === exp("Out of stock") ? "Pass" : "Fail", severity: "High" });
        check(area, `${range}: On-hand + Out of stock = All inventory`, { expected: counts["All inventory"], actual: n0(counts["On-hand-inventory"]) + n0(counts["Out of stock"]), status: n0(counts["On-hand-inventory"]) + n0(counts["Out of stock"]) === counts["All inventory"] ? "Pass" : "Fail", severity: "High" });
        const lowWithPoint = all.filter((r) => n0(r.reorder_point) > 0 && MEASURE_RULES["Low inventory"].test(r)).length;
        check(area, `${range}: Low inventory count`, { expected: `${exp("Low inventory")} (stock ≤ reorder point) / ${lowWithPoint} (only products with a reorder point)`, actual: counts["Low inventory"], status: [exp("Low inventory"), lowWithPoint].includes(counts["Low inventory"]) ? "Pass" : "Fail", severity: "Medium" });
      });
    });
    // On screen: Out of stock - rows shown follow the rule, Total row = its totals.
    reorderPage.quickDate("Last 30 Days").click();
    const from = calls.length;
    reorderPage.pickSelect("All inventory", "Out of stock");
    reorderPage.waitForCall(calls, from, "list", (f) => f.measure_type === "Out of stock" && String(f.page) === "1", "Out of stock on screen").then(() =>
      reorderPage.waitForCall(calls, from, "totals", (f) => f.measure_type === "Out of stock", "Out of stock totals")
    );
    cy.wait(2000, { log: false });
    reorderPage.readTable().then((t) => {
      const c = t.headers.indexOf("Current inventory");
      const bad = t.rows.filter((cells) => n0(cells[c]) > 0);
      check(area, "Screen · Out of stock: rows shown have no stock", { expected: `${t.rows.length} of ${t.rows.length}`, actual: `${t.rows.length - bad.length} of ${t.rows.length}`, status: bad.length ? "Fail" : "Pass", severity: "High", examples: bad.slice(0, 10).map((cells) => ({ product: cells[0], current: cells[c] })) });
    });
    const back = calls.length;
    reorderPage.pickSelect("Out of stock", "All inventory");
    reorderPage.waitForCall(calls, back, "list", (f) => f.measure_type === "All inventory" && String(f.page) === "1", "back to All inventory");
  });

  it("Report Type filter: each group = its products added up (data and screen)", () => {
    const area = "Filter - Report Type";
    const range = "Last 30 Days";
    const fields = { Brand: (r) => [r.brand || ""], Vendor: (r) => [r.vendor_name || r.vendor || ""], Category: (r) => String(r.category || "").split(",").map((s) => s.trim()) };
    ["Brand", "Vendor", "Category"].forEach((type) => {
      fetchRows(range, { report_type: type }).then(({ rows: groups, total }) => {
        fetchTotals(range, { report_type: type }).then(({ totals, total: tTotal }) => compareTotals(area, `${range} · ${type}`, groups, totals, tTotal));
        const products = data[range].rows;
        const expected = {};
        products.forEach((p) => fields[type](p).forEach((g) => (expected[lower(g)] = expected[lower(g)] || []).push(p)));
        const bad = [];
        groups.forEach((g) => {
          const members = expected[lower(g.name)] || expected[""] || [];
          ["items_sold", "net_sale", "closing_inventory", "current_inventory"].forEach((k) => {
            if (!close(sumOf(members, k), n0(g[k]), 0.05)) bad.push({ group: g.name || "(blank)", field: k, "group row": g[k], "its products added up": sumOf(members, k), products: members.length });
          });
        });
        check(area, `${type}: each group row = its products added up`, { expected: 0, actual: bad.length, status: bad.length ? "Fail" : "Pass", severity: "High", examples: bad.slice(0, 15) });
        check(area, `${type}: one row per ${type.toLowerCase()}`, { expected: Object.keys(expected).length, actual: total, status: total === Object.keys(expected).length ? "Pass" : "Fail", severity: "Medium", details: `${type} values in the product rows: ${Object.keys(expected).length}` });
        const prodItems = sumOf(products, "items_sold");
        const groupItems = sumOf(groups, "items_sold");
        const multi = products.filter((p) => fields[type](p).length > 1);
        check(area, `${type}: groups add up to the Product view (no double counting)`, {
          expected: `items sold ${prodItems}`,
          actual: `items sold ${groupItems}`,
          status: close(prodItems, groupItems, 0.01) ? "Pass" : "Fail",
          severity: "High",
          details: multi.length ? `${multi.length} product(s) have several ${type.toLowerCase()} values and are counted in each - e.g. ${multi.slice(0, 3).map((p) => `${p.name} (${p.category})`).join("; ")}.` : "",
        });
      });
    });
    // On screen: Brand view shows brand names.
    reorderPage.quickDate(range).click();
    const from = calls.length;
    reorderPage.pickSelect("Product", "Brand");
    reorderPage.waitForCall(calls, from, "list", (f) => f.report_type === "Brand" && String(f.page) === "1", "Brand on screen").then((call) => {
      cy.wait(2000, { log: false });
      reorderPage.readTable().then((t) => {
        const names = ((call.body && call.body.reorder_array) || []).map((r) => r.name || "");
        const shown = t.rows.map((cells) => cells[0]);
        check(area, "Screen · Brand view lists the brand groups", { expected: names.join(", "), actual: shown.join(", "), status: shown.length === names.length && shown.every((s, i) => lower(s) === lower(names[i])) ? "Pass" : "Fail", severity: "Medium" });
      });
    });
    const back = calls.length;
    reorderPage.pickSelect("Brand", "Product");
    reorderPage.waitForCall(calls, back, "list", (f) => f.report_type === "Product" && String(f.page) === "1", "back to Product");
  });

  it("Search filter: results, totals and combination with Measure (data and screen)", () => {
    const area = "Filter - Search";
    const range = "Last 30 Days";
    const all = () => data[range].rows;
    ["HASH", "almond", "Arados", "36/Black", "HONEY"].forEach((term) => {
      fetchRows(range, { search_by: term }).then(({ rows, total }) => {
        const expected = all().filter((r) => lower(r.name).includes(lower(term)));
        const off = rows.filter((r) => !lower(r.name).includes(lower(term)));
        check(area, `"${term}": results are the products whose name contains it`, {
          expected: expected.length,
          actual: `${total} (${off.length} without the text)`,
          status: total === expected.length && !off.length ? "Pass" : "Fail",
          severity: "Medium",
          examples: off.slice(0, 8).map((r) => ({ product: label(r), upc: r.upc })),
        });
        fetchTotals(range, { search_by: term }).then(({ totals, total: tTotal }) => compareTotals(area, `${range} · search "${term}"`, rows, totals, tTotal));
      });
    });
    fetchRows(range, { search_by: "HASH", measure_type: "Out of stock" }).then(({ rows }) => {
      const bad = rows.filter((r) => !lower(r.name).includes("hash") || n0(r.current_inventory) > 0);
      const expected = all().filter((r) => lower(r.name).includes("hash") && n0(r.current_inventory) <= 0).length;
      check(area, "\"HASH\" + Out of stock: both filters applied", { expected: `${expected} rows, all HASH and without stock`, actual: `${rows.length} rows, ${bad.length} breaking a filter`, status: rows.length === expected && !bad.length ? "Pass" : "Fail", severity: "High", examples: bad.slice(0, 8).map((r) => ({ product: label(r), current: r.current_inventory })) });
    });
    // On screen: search HASH - every row loaded, all contain HASH, Total row = rows added up.
    reorderPage.quickDate(range).click();
    const from = calls.length;
    reorderPage.search("HASH");
    reorderPage.waitForCall(calls, from, "list", (f) => f.search_by === "HASH" && String(f.page) === "1", "search HASH on screen").then((call) => {
      const total = Number(call.body && call.body.total_records);
      screenTotals(area, "Screen · search \"HASH\"", total).then((t) => {
        const bad = t.rows.filter((cells) => !lower(cells[0]).includes("hash"));
        check(area, "Screen · search \"HASH\": every row shown contains HASH", { expected: `${t.rows.length} of ${t.rows.length}`, actual: `${t.rows.length - bad.length} of ${t.rows.length}`, status: bad.length ? "Fail" : "Pass", severity: "High", examples: bad.slice(0, 8).map((cells) => ({ product: cells[0] })) });
      });
    });
    reorderPage.search("");
    cy.wait(3000, { log: false });
  });
});
