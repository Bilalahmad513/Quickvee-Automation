const { toNumber } = require("../support/csv");
const { selectAllInStoresFilter } = require("./reportStorePickers");

// "11/19/2026" -> "2026-11-19"
const isoDate = (shown) => {
  const [month, day, year] = String(shown).trim().split("/");
  return `${year}-${month}-${day}`;
};

// Reporting > Sales > Tender Wise Payments (new-sale-report/
// tender-wise-payments). Confirmed live on the test server (20 Nov 2026):
// the same filter panel as the Overall Sales Summary (presets, Start/End
// Date, Stores, Search); a "Summary (N Store)" block with one card per tender
// (Cash / Credit Card / Debit Card), each showing Gross and Net; and a table
// with one row per store and date, Gross ($) and Net ($) column groups
// (Cash, Credit Card, Debit Card each) and a GRAND TOTAL row in its <tfoot>.
const TENDERS = ["Cash", "Credit Card", "Debit Card"];

class TenderWisePaymentsPage {
  visit() {
    cy.visit("/merchants/store-reporting/new-sale-report/tender-wise-payments");
    return cy.contains("button", /^Search$/, { timeout: 60000 }).should("be.visible");
  }

  // "Today", "Yesterday", "Last 7 Days", "Last 14 Days", "Last 30 Days",
  // "Month to Date", "Year to Date" - the report reloads on Search.
  selectPreset(label) {
    return cy.contains("button", new RegExp(`^${label}$`), { timeout: 15000 }).click();
  }

  search() {
    return cy.contains("button", /^Search$/).click();
  }

  // Every store on the account in the Stores picker (the same MUI menu as
  // the Overall Sales Summary), then Search.
  selectAllStoresAndSearch() {
    return selectAllInStoresFilter();
  }

  // The Start / End Date fields as { startDate, endDate } ("YYYY-MM-DD").
  shownDates() {
    return cy.get("#start-date").invoke("val").then((start) =>
      cy.get("#end-date").invoke("val").then((end) => ({ startDate: isoDate(start), endDate: isoDate(end) }))
    );
  }

  // { Cash: { gross, net }, "Credit Card": {...}, "Debit Card": {...} } from
  // the Summary cards. A card is the nearest block around the tender's name
  // that has both its "Gross" and "Net" labels; each value is the next
  // element after its label.
  summaryCards() {
    return cy.contains(/^Summary \(\d+ Stores?\)$/, { timeout: 30000 }).then(($heading) => {
      let $block = $heading.parent();
      while ($block.length && !/Debit Card/.test($block.text())) $block = $block.parent();
      const cards = {};
      TENDERS.forEach((tender) => {
        const $name = $block.find("*").filter((i, el) => el.children.length === 0 && el.textContent.trim() === tender).first();
        let $card = $name.parent();
        while ($card.length && !(/Gross/.test($card.text()) && /Net/.test($card.text()))) $card = $card.parent();
        const valueAfter = (label) => {
          const $label = $card.find("*").filter((i, el) => el.children.length === 0 && el.textContent.trim() === label).first();
          return toNumber($label.next().text());
        };
        cards[tender] = { gross: valueAfter("Gross"), net: valueAfter("Net") };
      });
      return cards;
    });
  }

  // Table rows as { store, date, gross: { Cash, ... }, net: { Cash, ... } }.
  // Columns (confirmed live): #, Store, Date, Gross Cash / Credit Card /
  // Debit Card, Net Cash / Credit Card / Debit Card.
  // Read once the Summary has settled (see the spec); a range with no
  // payments may have no table at all, which reads as no rows.
  tableRows() {
    return cy.get("body").then(($body) =>
      $body
        .find("table tbody tr")
        .toArray()
        .filter((tr) => tr.querySelectorAll("td").length >= 9)
        .map((tr) => this.readRow(tr, 1, 2))
    );
  }

  // The GRAND TOTAL row (<tfoot>), same shape as tableRows(); null if
  // there's none (no payments in the range).
  grandTotal() {
    return cy.get("body").then(($body) => {
      const tr = $body.find("table tfoot tr").toArray().find((el) => /GRAND TOTAL/.test(el.textContent));
      return tr ? this.readRow(tr, 1, 2) : null;
    });
  }

  // Whether the page has a preset button named `label`.
  hasPreset(label) {
    return cy.get("body").then(($body) => $body.find("button").toArray().some((b) => b.textContent.trim() === label));
  }

  readRow(tr, storeCol, dateCol) {
    const cells = Array.from(tr.querySelectorAll("td")).map((td) => td.textContent.trim());
    const money = (i) => toNumber(cells[i]);
    return {
      store: cells[storeCol],
      date: cells[dateCol],
      gross: { Cash: money(3), "Credit Card": money(4), "Debit Card": money(5) },
      net: { Cash: money(6), "Credit Card": money(7), "Debit Card": money(8) },
    };
  }
}

module.exports = new TenderWisePaymentsPage();
module.exports.TENDERS = TENDERS;
