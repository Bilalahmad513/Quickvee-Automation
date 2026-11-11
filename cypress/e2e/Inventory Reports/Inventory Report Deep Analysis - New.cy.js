const page = require("../../pages/ReorderReportNewPage");
const { PAGE_URL } = require("../../pages/ReorderReportNewPage");
const { enterQaStore } = require("../../support/qaStoreEntry");
const { n0, round2, sumOf, close, MEASURES, MEASURE_RULES, SUM_KEYS, label, explainDiff } = require("../../support/reorderMath");
const { buildRecorderInventoryHtml } = require("../../reports/recorderInventoryReport");

// QA Checks - Inventory Report Deep Analysis - NEW (?type=new). Deep, READ-ONLY
// QA of the NEW Recorder/Reorder Inventory report on quickvee-qa.com for VEON01
// (HAM683004NC). The new version is fact-table backed:
//   POST reports-api-qa.quickvee.us/api/reports/inventory/reorder_list  -> { reorder_array, total_records }
//   POST reports-api-qa.quickvee.us/api/reports/inventory/reorder_totals -> { totals, total_records }
// (the OLD version used PHP InventoryReportPk/* with per-metric totals).
// No data is created/edited/deleted/exported. Writes recorder-inventory-NEW-qa-*.html
// so it does not overwrite the old-version report.
const STORE = { name: "VEON01", searchName: "Veon01", id: "HAM683004NC" };

const stamp = () => {
  const d = new Date();
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
};

describe("QA Checks - Inventory Report Deep Analysis - New (quickvee-qa.com)", { baseUrl: "https://quickvee-qa.com", retries: 0, testIsolation: false, defaultCommandTimeout: 15000 }, () => {
  const calls = [];
  const cases = [];
  const bugs = [];
  const uncaught = [];
  let listCall = null;
  let totalsCall = null;
  let allRows = [];
  let totalRecords = 0;

  const header = {
    "Run date/time": new Date().toString(),
    Environment: "quickvee-qa.com (QA)",
    Store: `${STORE.name} (search "${STORE.searchName}")`,
    "Merchant ID": STORE.id,
    "Report URL": `https://quickvee-qa.com${PAGE_URL}`,
    Version: "NEW (?type=new) — reports-api reorder_list / reorder_totals",
    Mode: "Read-only",
  };
  const kase = (name, checks, expected, actual, status) => cases.push({ name, checks, expected: String(expected), actual: String(actual), status });
  const log = (m) => cy.task("log", m, { log: false });

  before(() => {
    Cypress.on("uncaught:exception", (err) => {
      uncaught.push(String(err && err.message).split("\n")[0]);
      return false;
    });
    page.recordCalls(calls);
    enterQaStore(STORE.searchName, STORE.id);
    page.visit();
    cy.wrap(calls, { timeout: 60000 })
      .should((l) => expect(l.some((c) => c.kind === "list" && c.status), "a reorder_list call fired").to.equal(true))
      .then((l) => {
        listCall = Cypress._.findLast(l, (c) => c.kind === "list" && c.status);
        totalsCall = Cypress._.findLast(l, (c) => c.kind === "totals" && c.status);
      });
    cy.then(() => {
      if (listCall) {
        page.fetchAllRows(listCall, {}, 100).then(({ rows, total }) => {
          allRows = rows;
          totalRecords = Number(total || 0);
          header["Products (All inventory, default date)"] = `${rows.length} rows (total_records ${totalRecords})`;
        });
      }
    });
  });

  after(() => {
    const ts = stamp();
    const html = buildRecorderInventoryHtml({ header, cases, bugs, title: "Recorder Inventory (NEW ?type=new) — QA Deep Analysis (VEON01)" });
    cy.writeFile(`cypress/reports/recorder-inventory-new-qa-${ts}.html`, html);
    cy.writeFile("cypress/reports/recorder-inventory-new-qa-latest.html", html);
    cy.log(`REPORT: cypress/reports/recorder-inventory-new-qa-${ts}.html (and recorder-inventory-new-qa-latest.html)`);
    log(`Inventory Report Deep Analysis - New: ${cases.filter((c) => c.status === "Pass").length}/${cases.length} pass, ${bugs.length} bugs. Report at cypress/reports/recorder-inventory-new-qa-${ts}.html`);
  });

  it("1. Page loads, correct store active, right endpoint, no errors", () => {
    cy.url().should("include", "recorder-inventory");
    cy.url().should("include", "type=new");
    kase("Page loads (new version, ?type=new)", "report renders with ?type=new kept", "loads on ?type=new", "loaded", "Pass");
    const ok = !!listCall;
    kase("New endpoint responds", "reorder_list (reports-api) returns a response", "HTTP 200", ok ? `HTTP ${listCall.status}` : "no call", ok && listCall.status === 200 ? "Pass" : "Fail");
    if (ok) kase("New version uses the fact-table endpoint", "list URL is /api/reports/inventory/reorder_list", "…/reorder_list", /reorder_list/.test(listCall.url) ? "reorder_list (reports-api)" : listCall.url, /reorder_list/.test(listCall.url) ? "Pass" : "Fail");
    if (!ok) bugs.push({ severity: "High", area: "Reorder New", title: "No reorder_list call on load", steps: ["Open the report with ?type=new for VEON01", "Watch the network log"], actual: "No …/reorder_list request seen", expected: "The new report should call reorder_list on load" });
    const mid = listCall && listCall.fields.merchant_id;
    kase("Correct store is active", "reorder_list carries VEON01's merchant_id", STORE.id, mid || "—", mid === STORE.id ? "Pass" : "Fail");
    if (mid && mid !== STORE.id) bugs.push({ severity: "High", area: "Reorder New", title: "Report requested a different store", steps: ["Enter VEON01", "Open reorder report (?type=new)", "Inspect reorder_list merchant_id"], actual: `merchant_id ${mid}`, expected: `merchant_id ${STORE.id}` });
    kase("No uncaught JS errors on load", "window uncaught:exception count", "0", String(uncaught.length), uncaught.length === 0 ? "Pass" : "Fail");
    if (uncaught.length) bugs.push({ severity: "Medium", area: "Reorder New", title: "Uncaught JS error on the new report page", steps: ["Open the report with ?type=new for VEON01"], actual: uncaught.slice(0, 3).join(" | "), expected: "No uncaught JS errors" });
  });

  it("2. Default state and on-screen table", () => {
    const f = (listCall && listCall.fields) || {};
    kase("Default filters", "first load uses Product / All inventory", "report_type=Product, measure_type=All inventory", `report_type=${f.report_type}, measure_type=${f.measure_type}`, f.report_type === "Product" && /all inventory/i.test(f.measure_type || "") ? "Pass" : "Info");
    page.readTable().then((t) => {
      if (!allRows.length) {
        kase("Table renders rows or clean empty state", "table body vs No Data Found", "rows or 'No Data Found'", t.noData ? "No Data Found (0 products)" : `${t.rows.length} rows`, t.noData || t.rows.length ? "Pass" : "Fail");
        return;
      }
      kase("Table shows products", "on-screen rows > 0 when data exists", ">0 rows", `${t.rows.length} rows on screen`, t.rows.length > 0 ? "Pass" : "Fail");
      kase("Total row is present", "tfoot Total row rendered", "Total row", t.total ? "present" : "missing", t.total ? "Pass" : "Fail");
    });
  });

  it("3. Column data types (numbers are numbers, no NaN/blank)", () => {
    if (!allRows.length) {
      kase("Numeric columns hold numbers", "parse each numeric column", "numeric", "cannot verify — 0 products", "Skip");
      return;
    }
    const bad = [];
    allRows.forEach((r) => SUM_KEYS.forEach((k) => {
      if (r[k] !== undefined && r[k] !== null && r[k] !== "" && Number.isNaN(Number(String(r[k]).replace(/[$,%\s]/g, "")))) bad.push(`${r.name}.${k}="${r[k]}"`);
    }));
    kase("Numeric columns hold numbers (no NaN/blank)", "parse each numeric column across all rows", "all numeric", bad.length ? `${bad.length} non-numeric: ${bad.slice(0, 5).join(", ")}` : "all numeric", bad.length ? "Fail" : "Pass");
    if (bad.length) bugs.push({ severity: "Medium", area: "Reorder New", title: "A numeric column has a non-numeric / blank value", steps: ["Open reorder report (?type=new)", "Read the numeric columns"], actual: bad.slice(0, 8).join("; "), expected: "Numeric columns contain numbers" });
  });

  it("4. Totals (reorder_totals) equal the sum of all rows", () => {
    if (!totalsCall || !allRows.length) {
      kase("Summary totals = sum of rows", "reorder_totals vs summed rows", "equal", totalsCall ? "cannot verify — 0 products" : "no reorder_totals call seen", "Skip");
      return;
    }
    page.fetchTotals(totalsCall, {}).then((res) => {
      const totals = (res.body && res.body.totals) || {};
      SUM_KEYS.forEach((k) => {
        if (totals[k] === null || totals[k] === undefined) return;
        const rowSum = sumOf(allRows, k);
        const totalVal = n0(totals[k]);
        const ok = close(rowSum, totalVal, 0.011);
        kase(`Total: ${k} = sum of rows`, `reorder_totals.${k} vs sum of ${allRows.length} rows`, rowSum, totalVal, ok ? "Pass" : "Fail");
        if (!ok) {
          const diff = { items_sold: sumOf(allRows, "items_sold") - n0(totals.items_sold), net_sale: sumOf(allRows, "net_sale") - n0(totals.net_sale), cost_goods_sold: sumOf(allRows, "cost_goods_sold") - n0(totals.cost_goods_sold) };
          const culprits = k === "items_sold" || k === "net_sale" || k === "cost_goods_sold" ? explainDiff(allRows, diff) : null;
          bugs.push({ severity: "High", area: "Reorder New - totals", title: `Total "${k}" does not equal the sum of the rows`, steps: ["Open reorder report (?type=new) for VEON01", `Add the "${k}" column across all ${allRows.length} rows`, "Compare with the Total row"], actual: `Total ${totalVal}, rows add to ${rowSum} (diff ${round2(totalVal - rowSum)})` + (culprits ? `. Rows excluded from the total: ${culprits.map(label).slice(0, 5).join(", ")}` : ""), expected: `Total "${k}" should equal the sum of the rows (${rowSum})` });
        }
      });
    });
  });

  it("5. Pagination: total_records matches, no duplicate rows", () => {
    if (!allRows.length) {
      kase("No duplicate / missing rows across pages", "unique product id across pages", "all unique", "cannot verify — 0 products", "Skip");
      return;
    }
    const ids = allRows.map((r) => `${r.product_id}|${r.variant || ""}`);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    kase("No duplicate rows across pages", "unique product_id|variant across all pages", "0 duplicates", `${dupes.length} dup in ${allRows.length} rows`, dupes.length ? "Fail" : "Pass");
    if (dupes.length) bugs.push({ severity: "High", area: "Reorder New - pagination", title: "A product repeats across pages", steps: ["Open reorder report (?type=new) for a store with >1 page", "Page through all rows"], actual: `${dupes.length} repeated, e.g. ${dupes.slice(0, 3).join(", ")}`, expected: "Each product appears once" });
    const ok = totalRecords === 0 || Math.abs(totalRecords - allRows.length) <= 0;
    kase("total_records matches rows returned", "total_records vs rows fetched across pages", totalRecords, allRows.length, ok ? "Pass" : "Fail");
    if (!ok) bugs.push({ severity: "Medium", area: "Reorder New - pagination", title: "total_records does not match the number of rows", steps: ["Open reorder report (?type=new)", "Count all rows across pages vs the reported total_records"], actual: `total_records ${totalRecords}, rows ${allRows.length}`, expected: "They should match" });
  });

  it("6. Measure filters return only matching rows", () => {
    if (!listCall) {
      kase("Measure filters narrow correctly", "each measure returns only matching rows", "matching only", "cannot verify", "Skip");
      return;
    }
    MEASURES.filter((m) => m !== "All inventory").forEach((measure) => {
      page.fetchAllRows(listCall, { measure_type: measure }, 100).then(({ rows }) => {
        if (!rows.length) {
          kase(`Measure "${measure}" narrows correctly`, "returned rows satisfy the rule", "only matching", "0 rows returned", "Skip");
          return;
        }
        const rule = MEASURE_RULES[measure];
        const offenders = rows.filter((r) => !rule.test(r)).slice(0, 10);
        kase(`Measure "${measure}" narrows correctly`, `every row is "${rule.text}"`, "0 non-matching", `${offenders.length} non-matching of ${rows.length}`, offenders.length ? "Fail" : "Pass");
        if (offenders.length) bugs.push({ severity: "High", area: "Reorder New - filter", title: `Measure "${measure}" returns non-matching rows`, steps: ["Open reorder report (?type=new)", `Set Measure to "${measure}"`, "Check each row against the rule"], actual: `${offenders.length} break "${rule.text}", e.g. ${offenders.map((r) => `${r.name} cur=${n0(r.current_inventory)} reorder=${n0(r.reorder_point)}`).slice(0, 3).join("; ")}`, expected: `Only "${rule.text}" rows should show` });
      });
    });
  });

  it("7. Reorder rule: Low inventory ≤ reorder point", () => {
    if (!listCall) {
      kase("Reorder rule (Low ≤ reorder point)", "Low rows are at/below reorder point", "all at/below", "cannot verify", "Skip");
      return;
    }
    page.fetchAllRows(listCall, { measure_type: "Low inventory" }, 100).then(({ rows }) => {
      if (!rows.length) {
        kase("Reorder rule (Low ≤ reorder point)", "Low rows at/below reorder point", "all at/below", "0 low rows", "Skip");
        return;
      }
      const offenders = rows.filter((r) => !(n0(r.current_inventory) <= n0(r.reorder_point))).slice(0, 10);
      kase("Reorder rule: Low inventory ≤ reorder point", "current_inventory ≤ reorder_point for all Low rows", "0 violations", `${offenders.length} of ${rows.length} violate`, offenders.length ? "Fail" : "Pass");
      if (offenders.length) bugs.push({ severity: "High", area: "Reorder New - reorder rule", title: "Low-inventory list includes products above their reorder point", steps: ["Open reorder report (?type=new)", "Set Measure to Low inventory", "Compare current vs reorder point"], actual: offenders.map((r) => `${r.name}: cur ${n0(r.current_inventory)} > reorder ${n0(r.reorder_point)}`).slice(0, 3).join("; "), expected: "Only products at/below reorder point should appear" });
    });
  });

  it("8. Empty-state and wildcard search", () => {
    page.readTable().then((t) => {
      if (allRows.length === 0) {
        kase("Empty / no-data state renders (no crash)", "shows 'No Data Found' when empty", "'No Data Found'", t.noData ? "'No Data Found' shown" : "no rows, no empty state", t.noData ? "Pass" : "Fail");
      } else {
        kase("Empty / no-data state", "only applies when store has no products", "n/a (store has data)", `${allRows.length} products`, "Info");
      }
    });
    if (listCall && allRows.length) {
      page.fetchAllRows(listCall, { search_by: "%" }, 100).then(({ rows }) => {
        const leaks = rows.length >= allRows.length;
        kase("Search ignores SQL wildcards", "search '%' must not return the whole catalogue", "matching only / fewer than all", `'%' returned ${rows.length} of ${allRows.length}`, leaks ? "Fail" : "Pass");
        if (leaks) bugs.push({ severity: "Medium", area: "Reorder New - search", title: "Search treats '%' as a SQL wildcard (returns everything)", steps: ["Open reorder report (?type=new)", "Type % in Search and search"], actual: `'%' returned ${rows.length} rows (whole catalogue)`, expected: "A literal '%' should match product names, not act as a wildcard" });
      });
    } else {
      kase("Search ignores SQL wildcards", "search '%' must not return everything", "matching only", "cannot verify — 0 products", "Skip");
    }
  });
});
