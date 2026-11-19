const { storesFilterTrigger, selectAllInStoresFilter } = require("./reportStorePickers");
const { toNumber } = require("../support/csv");

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
}

module.exports = new SalesSummaryPage();
