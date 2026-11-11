const { parseMultipart, buildMultipart } = require("../support/multipart");

// Reporting > Inventory Report > "Recorder Inventory" (the BASE variant, no
// ?type=new): /merchants/store-reporting/inventory-report/recorder-inventory.
// Confirmed against the real code (quickvee-admin-panel ReorderInventoryMain +
// shared InventoryTable):
//   - Filters: Report Type (Product/Brand/Vendor/Category) and Measure
//     (On-hand-inventory / Low inventory / All inventory / Out of stock) are
//     MUI selects (.MuiSelect-select -> [role=option]); date quick buttons
//     button.qv-date-filter__quick (Today ...); search input (placeholder
//     "Search Product by Title" etc.) + a Search button.
//   - Table: shared InventoryTable (thead th left/right-sticky, tbody rows,
//     tfoot Total, NoDataFound "No Data Found", react-infinite-scroll).
//   - Column picker: th.right-sticky img[alt=plusIcon] -> *_check_all -> Apply.
// Data (PHP api-ci on QA): POST InventoryReportPk/Reorder_list (multipart:
//   merchant_id, token_id, login_type, page, limit=12 (6 for Category),
//   start_date, end_date, measure_type, report_type, search_by)
//   -> { status, reorder_array: [...], page }.
// Totals are SEPARATE per-metric calls: InventoryReportPk/items_sold_total,
//   /closing_inventory_total, /inbound_inventory_total, /<col>_total
//   -> { status, <metric>: "<value>" }.
const PAGE_URL = "/merchants/store-reporting/inventory-report/recorder-inventory";
const LIST_RE = /\/InventoryReportPk\/Reorder_list/i;
const TOTAL_RE = /\/InventoryReportPk\/[a-z_]+_total/i;

const text = (el) => (el ? el.innerText || el.textContent || "" : "").replace(/\s+/g, " ").trim();
const parseBody = (b) => (typeof b === "string" ? Cypress._.attempt(JSON.parse, b) : b);

class RecorderInventoryPage {
  // Records answered list / per-metric total calls into `calls`:
  // { kind:'list'|'total', metric, fields, url, headers, status, body }.
  recordCalls(calls) {
    cy.intercept({ method: "POST", url: /\/InventoryReportPk\// }, (req) => {
      const isList = LIST_RE.test(req.url);
      const isTotal = TOTAL_RE.test(req.url);
      if (!isList && !isTotal) return;
      const fields = parseMultipart(req.body, req.headers["content-type"]) || {};
      const metric = isTotal ? (req.url.match(/\/InventoryReportPk\/([a-z_]+_total)/i) || [])[1] : null;
      const entry = { kind: isList ? "list" : "total", metric, fields, url: req.url, headers: { ...req.headers }, at: Date.now() };
      req.on("after:response", (res) => {
        entry.status = res.statusCode;
        entry.body = parseBody(res.body);
        calls.push(entry);
      });
    });
  }

  visit() {
    cy.visit(PAGE_URL);
    // Either the table header, the Filter By panel, or the empty state.
    return cy.contains(/Filter By|Closing Inventory|No Data Found/i, { timeout: 60000 }).should("exist");
  }

  // Opens the MUI select currently showing `current` and picks `option`.
  pickSelect(current, option) {
    cy.contains(".MuiSelect-select", new RegExp(`^\\s*${Cypress._.escapeRegExp(current)}\\s*$`), { timeout: 30000 }).click();
    return cy.contains('[role="listbox"] [role="option"]', new RegExp(`^\\s*${Cypress._.escapeRegExp(option)}\\s*$`), { timeout: 15000 }).click();
  }

  quickDate(label) {
    return cy.contains("button.qv-date-filter__quick", new RegExp(`^\\s*${label}\\s*$`), { timeout: 30000 });
  }

  searchInput() {
    return cy.get('input[placeholder*="Search" i]', { timeout: 30000 }).first();
  }

  search(term) {
    this.searchInput().clear();
    if (term !== "") this.searchInput().type(term, { parseSpecialCharSequences: false });
    return cy.contains("button", /^\s*Search\s*$/).click();
  }

  // { headers, rows:[[cells]], total:[cells]|null, noData } as shown now.
  readTable() {
    return cy.get("body").then(() => {
      const $th = Cypress.$("th").filter((_, th) => /Closing Inventory/i.test(text(th))).first();
      if (!$th.length) {
        return { headers: [], rows: [], total: null, noData: /No Data Found/i.test(Cypress.$("main,body").text()) };
      }
      const $table = $th.closest("table");
      const headers = $table.find("thead th").toArray().map(text);
      const expand = (tr) => Cypress.$(tr).children("td,th").toArray().flatMap((td) => [text(td), ...Array(Math.max(0, (td.colSpan || 1) - 1)).fill("")]);
      const bodyRows = $table.find("tbody tr").toArray().map(expand);
      const footRows = $table.find("tfoot tr").toArray().map(expand);
      const all = [...bodyRows, ...footRows];
      const totalIdx = all.findIndex((c) => /^total$/i.test((c[0] || "").trim()));
      const rows = all.filter((c, i) => i !== totalIdx && c.length > 1 && !/^No Data Found\.?$/i.test(c.filter(Boolean).join(" ")));
      return { headers, rows, total: totalIdx >= 0 ? all[totalIdx] : null, noData: /No Data Found/i.test(Cypress.$("main,body").text()) };
    });
  }

  // Ticks every column-picker group and applies (reveals all columns).
  showAllColumns() {
    return cy.get("body").then(($b) => {
      if (!$b.find("th.right-sticky img[alt='plusIcon']").length) return;
      cy.get("th.right-sticky img[alt='plusIcon']", { timeout: 30000 }).first().click();
      cy.get('input[type="checkbox"][name$="check_all"]', { timeout: 15000 }).each(($c) => {
        if (!$c.prop("checked")) cy.wrap($c).check({ force: true });
      });
      cy.contains("button", /^\s*Apply\s*$/).click();
    });
  }

  // Scrolls the infinite-scroll list until no more rows load (or `max`).
  scrollToLoadAll(max = 40) {
    let best = 0;
    let stale = 0;
    const count = () => Cypress.$("tbody tr").toArray().filter((tr) => !/^total$/i.test(text(tr.children[0])) && tr.children.length > 1).length;
    const once = (i) =>
      cy.get("body", { log: false }).then(() => {
        const box = Cypress.$(".custom-table-hidescroll, .infinite-scroll-component, tbody").last()[0];
        if (box) box.scrollTop = box.scrollHeight;
        const last = Cypress.$("tbody tr").last()[0];
        if (last) last.scrollIntoView({ block: "end" });
        return cy.wait(1200, { log: false }).then(() => {
          const c = count();
          stale = c > best ? 0 : stale + 1;
          best = Math.max(best, c);
          if (i >= max || stale >= 4) return best;
          return once(i + 1);
        });
      });
    return once(1);
  }

  // Read-only replay of the list call, all pages, with `overrides`. Yields
  // { rows, pages }.
  fetchAllRows(call, overrides = {}, pageSize = 12) {
    const all = [];
    const send = (page) => {
      const fields = { ...call.fields, ...overrides, page: String(page), limit: String(pageSize) };
      const mp = buildMultipart(fields);
      const headers = { "Content-Type": `multipart/form-data; boundary=${mp.boundary}` };
      if (call.headers.authorization) headers.Authorization = call.headers.authorization;
      return cy.request({ method: "POST", url: call.url, headers, body: mp.body, timeout: 120000, failOnStatusCode: false, log: false }).then((res) => {
        const body = parseBody(res.body) || {};
        const rows = body.reorder_array || [];
        all.push(...rows);
        if (rows.length < pageSize || page >= 200) return { rows: all, pages: page };
        return send(page + 1);
      });
    };
    return send(1);
  }

  // Replay one per-metric total endpoint. Yields the numeric value (or null).
  fetchTotal(listCall, metric, overrides = {}) {
    const url = listCall.url.replace(/\/InventoryReportPk\/Reorder_list.*$/i, `/InventoryReportPk/${metric}`);
    const fields = { ...listCall.fields, ...overrides, page: "0", limit: "0" };
    const mp = buildMultipart(fields);
    const headers = { "Content-Type": `multipart/form-data; boundary=${mp.boundary}` };
    if (listCall.headers.authorization) headers.Authorization = listCall.headers.authorization;
    return cy.request({ method: "POST", url, headers, body: mp.body, timeout: 120000, failOnStatusCode: false, log: false }).then((res) => {
      const body = parseBody(res.body) || {};
      const key = metric.replace(/_total$/, "");
      const raw = body[key] ?? body[metric] ?? (body.totals && body.totals[key]);
      const n = raw == null ? null : Number(String(raw).replace(/[$,%\s]/g, ""));
      return { status: res.status, value: Number.isNaN(n) ? null : n, raw };
    });
  }
}

module.exports = new RecorderInventoryPage();
module.exports.PAGE_URL = PAGE_URL;
