const { toNumber } = require("../support/csv");
const { selectAllInSelectAllPopover, selectCurrentStoreInSelectAllPopover } = require("./reportStorePickers");
const { selectReportDates } = require("./reportDateRangeButton");

// Reporting > Sales > Item Sold Report. Opens on Today with every store on
// the account selected; reloads its data on every change in the store
// picker (no Search button).
const NOT_AVAILABLE = /This report isn't available for your account/;

class ItemSoldReportPage {
  // Yields whether the report is available in this store: some accounts
  // only get "This report isn't available for your account yet" and no
  // report at all (confirmed live: jenny smoke shop).
  visit() {
    cy.visit("/merchants/store-reporting/item-sold-report");
    cy.contains(new RegExp(`Export CSV|${NOT_AVAILABLE.source}`), { timeout: 30000 }).should("be.visible");
    return cy.get("body").then(($body) => !NOT_AVAILABLE.test($body.text()));
  }

  // Reads "All Stores", "Store B", etc.
  storesTrigger() {
    return cy.contains('button[aria-haspopup="dialog"]', /Stores?\b/, { timeout: 30000 });
  }

  // Leaves only the store the session is in selected ("Deselect All").
  selectCurrentStoreOnly() {
    return selectCurrentStoreInSelectAllPopover(() => this.storesTrigger());
  }

  // Every store on the account - the same "Select All" popover as the
  // Category Sold Report.
  selectAllStores() {
    selectAllInSelectAllPopover(() => this.storesTrigger());
    return this.storesTrigger().should("have.text", "All Stores");
  }

  // `range`: { label, startDate, endDate } ("YYYY-MM-DD") - see
  // reportDateRangeButton.js.
  selectDates(range) {
    return selectReportDates(range);
  }

  exportCsv() {
    return cy.contains("button", /Export CSV/).click();
  }

  // The "Total" row under the table, as numbers: { items, Sold, Subtotal,
  // Discounts, "Subtotal w/ Discounts", Total, Cost, Profit, Margin }. Each
  // value sits in a <dd> after its <dt> label; the item count is the N in
  // "All N items matching filters". The table's own rows use the same
  // <dt> labels (confirmed live: a plain "Margin" lookup read the first
  // item's row), so the list is found from the "matching filters" label -
  // its nearest ancestor holding a <dl>.
  totalRow() {
    const totals = {};
    cy.contains(/All \d+ items? matching filters/, { timeout: 15000 }).then(($label) => {
      totals.items = toNumber($label.text().match(/All (\d+)/)[1]);
      cy.wrap($label)
        .parents()
        .filter((i, el) => el.querySelector("dl") !== null)
        .first()
        .find("dl")
        .first()
        .find("dt")
        .each(($dt) => {
          totals[$dt.text().trim()] = toNumber($dt.next("dd").text());
        });
    });
    return cy.then(() => totals);
  }
}

module.exports = new ItemSoldReportPage();
