const { parseMultipart, buildMultipart } = require("../support/multipart");

// Reporting > Inventory Report > "Reorder Report - New"
// (/merchants/store-reporting/inventory-report/recorder-inventory?type=new),
// as seen live on quickvee-qa.com (VEON01, 2026-11-04):
//   - quick date buttons button.qv-date-filter__quick (Today / Yesterday /
//     Last 7 Days / Last 30 Days; the active one has .is-active), Start/End
//     Date inputs input.qv-date-filter__input (MM/DD/YYYY);
//   - MUI selects: report ("Reorder Report - New"), Report Type (Product /
//     Brand / Vendor / Category), Measure (On-hand-inventory / Low inventory
//     / All inventory / Out of stock);
//   - search input[placeholder="Search Product by Title"] + button "Search";
//   - the column picker behind th.right-sticky img[alt=plusIcon]: checkbox
//     groups named *_check_all, then "Apply";
//   - the table loads 12 rows a page; its last row is "Total".
// Data: POST reports-api-qa.quickvee.us/api/reports/inventory/reorder_list
// (multipart: merchant_id, page, limit, start_date, end_date, measure_type,
// report_type, search_by, outlet_ids ...) -> { reorder_array, total_records }
// and .../reorder_totals -> { totals, total_records }.
const LIST_URL = /\/api\/reports\/inventory\/reorder_list/;
const TOTALS_URL = /\/api\/reports\/inventory\/reorder_totals/;
const PAGE_URL = "/merchants/store-reporting/inventory-report/recorder-inventory?type=new";

const text = (el) => (el ? el.innerText || el.textContent || "" : "").replace(/\s+/g, " ").trim();
const parseBody = (body) => (typeof body === "string" ? Cypress._.attempt(JSON.parse, body) : body);

class ReorderReportNewPage {
  // Keeps every answered list / totals call in `calls`: { kind, fields,
  // headers, url, status, body }. Register before visit().
  recordCalls(calls) {
    cy.intercept({ method: "POST", url: /\/api\/reports\/inventory\/reorder_(list|totals)/ }, (req) => {
      const fields = parseMultipart(req.body, req.headers["content-type"]);
      const entry = { kind: LIST_URL.test(req.url) ? "list" : "totals", fields, url: req.url, headers: { ...req.headers }, at: Date.now() };
      req.on("after:response", (res) => {
        entry.status = res.statusCode;
        entry.body = parseBody(res.body);
        calls.push(entry);
      });
    });
  }

  visit() {
    cy.visit(PAGE_URL);
    return cy.contains("th", "Closing Inventory", { timeout: 60000 }).should("be.visible");
  }

  // The latest answered call after calls[from] of `kind` whose fields pass
  // `isWanted`.
  waitForCall(calls, from, kind, isWanted, describe) {
    return cy
      .wrap(calls, { log: false, timeout: 90000 })
      .should((list) => {
        expect(list.slice(from).some((c) => c.kind === kind && isWanted(c.fields)), `${kind} call for ${describe}`).to.equal(true);
      })
      .then((list) => Cypress._.findLast(list.slice(from), (c) => c.kind === kind && isWanted(c.fields)));
  }

  quickDate(label) {
    return cy.contains("button.qv-date-filter__quick", new RegExp(`^\\s*${label}\\s*$`), { timeout: 30000 });
  }

  // Opens the MUI select currently showing `current` and picks `option`.
  pickSelect(current, option) {
    cy.contains(".MuiSelect-select", new RegExp(`^\\s*${Cypress._.escapeRegExp(current)}\\s*$`), { timeout: 30000 }).click();
    return cy.contains('[role="listbox"] [role="option"]', new RegExp(`^\\s*${Cypress._.escapeRegExp(option)}\\s*$`), { timeout: 15000 }).click();
  }

  selectOptions(current) {
    cy.contains(".MuiSelect-select", new RegExp(`^\\s*${Cypress._.escapeRegExp(current)}\\s*$`), { timeout: 30000 }).click();
    return cy.get('[role="listbox"] [role="option"]', { timeout: 15000 }).then(($o) => {
      const options = $o.toArray().map(text);
      cy.get("body").type("{esc}");
      return cy.wrap(options, { log: false });
    });
  }

  searchInput() {
    return cy.get('input[placeholder="Search Product by Title"]', { timeout: 30000 });
  }

  search(term) {
    this.searchInput().clear();
    if (term !== "") this.searchInput().type(term, { parseSpecialCharSequences: false });
    return cy.contains("button", /^\s*Search\s*$/).click();
  }

  // Ticks every group in the "+" column picker and applies.
  showAllColumns() {
    cy.get("th.right-sticky img[alt='plusIcon']", { timeout: 30000 }).first().click();
    cy.get('input[type="checkbox"][name$="check_all"]', { timeout: 15000 }).each(($c) => {
      if (!$c.prop("checked")) cy.wrap($c).check({ force: true });
    });
    cy.contains("button", /^\s*Apply\s*$/).click();
    return cy.contains("th", /^\s*Sell-through rate\s*$/i, { timeout: 30000 }).should("exist");
  }

  // The column picker's labels and help texts, as { group, label, help }.
  readColumnPicker() {
    cy.get("th.right-sticky img[alt='plusIcon']", { timeout: 30000 }).first().click();
    return cy.contains("Choose other measure to show", { timeout: 15000 }).then(() => {
      const $box = Cypress.$("*").filter((_, e) => /Choose other measure to show/.test(e.textContent) && e.children.length > 3).last();
      const lines = ($box[0] ? $box[0].innerText : "").split("\n").map((s) => s.trim()).filter(Boolean);
      cy.contains("button", /^\s*Cancel\s*$/).click();
      return cy.wrap(lines, { log: false });
    });
  }

  // { headers, rows: [[cells]], total: [cells] | null, noData } as shown now.
  readTable() {
    return cy.contains("th", "Closing Inventory", { timeout: 60000 }).then(() => {
      const $table = Cypress.$("th").filter((_, th) => text(th) === "Closing Inventory").closest("table");
      const headers = $table.find("thead th").toArray().map(text);
      // A cell spanning several columns is repeated as blanks, so cells line
      // up with the headers.
      // The Total row sits in <tfoot>.
      const all = $table
        .find("tbody tr, tfoot tr")
        .toArray()
        .map((tr) => Cypress.$(tr).children("td,th").toArray().flatMap((td) => [text(td), ...Array(Math.max(0, (td.colSpan || 1) - 1)).fill("")]));
      const totalIndex = all.findIndex((cells) => cells[0] === "Total");
      // The empty state ("No Data Found") is a single wide cell, not a row.
      const rows = all.filter((cells, i) => i !== totalIndex && cells.length > 2 && !/^No Data Found\.?$/i.test(cells.filter(Boolean).join(" ")));
      return {
        headers,
        rows,
        total: totalIndex >= 0 ? all[totalIndex] : null,
        noData: /No Data Found/i.test($table.parent().text()) || /No Data Found/i.test(Cypress.$("main").text()),
      };
    });
  }

  // The data rows' scroll box (div.measure-container) scrolled to the bottom
  // `times` times; yields the most rows seen.
  scrollToLoadAll(totalRecords, maxScrolls = 60) {
    let best = 0;
    let stale = 0;
    const once = (i) =>
      cy.get("body", { log: false }).then(() => {
        const box = Cypress.$(".measure-container")[0];
        if (box) box.scrollTop = box.scrollHeight;
        window.top && Cypress.$(cy.state("window")).scrollTop(1e6);
        const lastRow = Cypress.$("tbody tr").last()[0];
        if (lastRow) lastRow.scrollIntoView({ block: "end" });
        return cy.wait(1500, { log: false }).then(() => {
          const count = Cypress.$("tbody tr").toArray().filter((tr) => text(tr.children[0]) !== "Total" && tr.children.length > 2).length;
          // Stops after 4 scrolls in a row that load nothing new.
          stale = count > best ? 0 : stale + 1;
          best = Math.max(best, count);
          if (count >= totalRecords || i >= maxScrolls || stale >= 4) return best;
          return once(i + 1);
        });
      });
    return once(1);
  }

  // Replays the page's own list call for every row (pages of `pageSize`),
  // with the fields changed by `overrides`. Read only - the same request
  // the page makes. Yields { rows, total, pages }.
  fetchAllRows(call, overrides = {}, pageSize = 100) {
    const all = [];
    const send = (page) => {
      const fields = { ...call.fields, ...overrides, page: String(page), limit: String(pageSize) };
      const multipart = buildMultipart(fields);
      const headers = { "Content-Type": `multipart/form-data; boundary=${multipart.boundary}` };
      if (call.headers.authorization) headers.Authorization = call.headers.authorization;
      return cy
        .request({ method: "POST", url: call.url, headers, body: multipart.body, timeout: 120000, failOnStatusCode: false, log: false })
        .then((res) => {
          const body = parseBody(res.body) || {};
          if (res.status !== 200 || body.status === false) throw new Error(`reorder_list replay page ${page}: HTTP ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
          const rows = body.reorder_array || [];
          all.push(...rows);
          const total = Number(body.total_records || 0);
          if (rows.length === 0 || all.length >= total || page >= 200) return { rows: all, total, pages: page };
          return send(page + 1);
        });
    };
    return send(1);
  }

  // Same for the totals call.
  fetchTotals(call, overrides = {}) {
    const fields = { ...call.fields, ...overrides };
    const multipart = buildMultipart(fields);
    const headers = { "Content-Type": `multipart/form-data; boundary=${multipart.boundary}` };
    if (call.headers.authorization) headers.Authorization = call.headers.authorization;
    return cy
      .request({ method: "POST", url: call.url, headers, body: multipart.body, timeout: 120000, failOnStatusCode: false, log: false })
      .then((res) => ({ status: res.status, body: parseBody(res.body) || {} }));
  }
}

module.exports = new ReorderReportNewPage();
module.exports.PAGE_URL = PAGE_URL;
