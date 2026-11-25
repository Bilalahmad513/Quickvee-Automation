const { storesFilterTrigger, selectAllInStoresFilter, selectOnlyStoreInStoresFilter } = require("./reportStorePickers");
const { toNumber } = require("../support/csv");
const { pickDateRange } = require("./datePicker");

// Reporting > Sales > Overall Sales Summary. Opens with only the current
// store selected in its "Stores" picker.
class SalesSummaryPage {
  visit() {
    cy.visit("/merchants/store-reporting/new-sale-report/sales-summary");
    return storesFilterTrigger().should("be.visible");
  }

  selectAllStoresAndSearch() {
    return selectAllInStoresFilter();
  }

  // "Today", "Yesterday", "Last 7 Days", "Last 14 Days", "Month to Date",
  // "Year to Date" - fills Start/End Date; the report only reloads on
  // Search (confirmed live).
  selectPreset(label) {
    return cy.contains("button", new RegExp(`^${label}$`), { timeout: 15000 }).click();
  }

  search() {
    return cy.contains("button", /^Search$/).click();
  }

  // Whether the page has a preset button named `label` (e.g. live has no
  // "Last 30 Days").
  hasPreset(label) {
    return cy.get("body").then(($body) => $body.find("button").toArray().some((b) => b.textContent.trim() === label));
  }

  // Only the store named `name` in the Stores picker, then Search.
  selectOnlyStoreAndSearch(name) {
    return selectOnlyStoreInStoresFilter(name);
  }

  // The Start / End Date fields as { startDate, endDate } ("YYYY-MM-DD") -
  // the same filter panel as Tender Wise Payments (#start-date / #end-date,
  // confirmed live on the test server).
  shownDates() {
    const iso = (shown) => {
      const [month, day, year] = String(shown).trim().split("/");
      return `${year}-${month}-${day}`;
    };
    return cy.get("#start-date").invoke("val").then((start) =>
      cy.get("#end-date").invoke("val").then((end) => ({ startDate: iso(start), endDate: iso(end) }))
    );
  }

  // Picks `range` ({ startDate, endDate }, "YYYY-MM-DD") in the Start Date /
  // End Date calendars (react-datepicker) - for a range with no preset.
  selectDates(range) {
    return pickDateRange("reactDatepicker", range);
  }

  // The figure on a KPI / Sales Summary card, found by its label <p> (the
  // value is the next <p>, confirmed live) - e.g. "Gross Sales", "Net Sales",
  // "Profit Margin", "Discounts", "Loyalty Points Redeemed", "Refunds",
  // "Store Credit Refunds". Only <p> labels count, so the sidebar's
  // "Refunds" link isn't picked up.
  cardValue(label) {
    return cy
      .contains("p", new RegExp(`^${label}$`), { timeout: 30000 })
      .next("p")
      .invoke("text")
      .then((text) => toNumber(text));
  }

  // { label: number } for each of `labels`.
  cardValues(labels) {
    const values = {};
    labels.forEach((label) => this.cardValue(label).then((v) => (values[label] = v)));
    return cy.then(() => values);
  }

  // "Payment Method Breakdown": { Cash: { amount, refunded, transactions,
  // net }, "Credit Card": {...}, ... } for each of `tenders`. Each card is a
  // .qv-sales-summary-payment-card with the tender's name in an <h3> and
  // "Amount:" / "Refunded:" / "Transactions:" / "Net:" label <span>s, each
  // followed by its value <span> (confirmed live, test server, 20 Nov 2026).
  //
  // Yields null when the page shows "No Data Found." instead (no sales in
  // the range - the whole report is replaced by that message, confirmed live
  // on the test server, Today before the store's first sale).
  paymentBreakdown(tenders) {
    cy.contains(/No Data Found\.|Payment Method Breakdown/, { timeout: 30000 });
    return cy.get("body").then(($body) => {
      const $cards = $body.find(".qv-sales-summary-payment-card");
      if (!$cards.length && /No Data Found\./.test($body.text())) return null;
      const out = {};
      tenders.forEach((tender) => {
        const card = $cards.toArray().find((c) => (c.querySelector("h3") || {}).textContent.trim() === tender);
        if (!card) return;
        const valueAfter = (label) => {
          const span = Array.from(card.querySelectorAll("span")).find((s) => s.textContent.trim() === label);
          return span && span.nextElementSibling ? toNumber(span.nextElementSibling.textContent) : null;
        };
        out[tender] = {
          amount: valueAfter("Amount:"),
          refunded: valueAfter("Refunded:"),
          transactions: valueAfter("Transactions:"),
          net: valueAfter("Net:"),
        };
      });
      return out;
    });
  }
}

module.exports = new SalesSummaryPage();
