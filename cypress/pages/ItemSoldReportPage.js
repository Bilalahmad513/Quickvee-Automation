const { toNumber } = require("../support/csv");
const { selectAllInSelectAllPopover } = require("./reportStorePickers");

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

  // Leaves only the store the session is in selected: "Deselect All" in the
  // picker keeps the current store (confirmed live - the page then asked for
  // Store B alone), so no store is clicked by name.
  selectCurrentStoreOnly() {
    this.storesTrigger().click();
    cy.get('[role="dialog"]', { timeout: 15000 })
      .contains("button", /^(Select|Deselect) All$/, { timeout: 15000 })
      .then(($button) => {
        if ($button.text() === "Deselect All") cy.wrap($button).click();
      });
    return cy.get("body").type("{esc}");
  }

  // Every store on the account - the same "Select All" popover as the
  // Category Sold Report.
  selectAllStores() {
    selectAllInSelectAllPopover(() => this.storesTrigger());
    return this.storesTrigger().should("have.text", "All Stores");
  }

  // The date range button ("11/04/2026 - 11/04/2026") opens a
  // react-day-picker range calendar with presets beside it and Cancel /
  // Retrieve below (confirmed live). Presets used where the page has one -
  // a preset applies at once and closes the calendar (confirmed live), so
  // there's no Retrieve to click. Any other range is picked in the
  // calendar (first click = start, second click = end), then Retrieve.
  // `range`: { label, startDate, endDate } ("YYYY-MM-DD").
  selectDates(range) {
    const presets = { today: "Today", yesterday: "Yesterday", "this month": "Month-to-date", "this year": "This year" };
    cy.contains("button", /\d{2}\/\d{2}\/\d{4}\s*-\s*\d{2}\/\d{2}\/\d{4}/, { timeout: 15000 }).click();
    const calendar = () => cy.get('[role="dialog"]:visible', { timeout: 10000 }).last();

    if (presets[range.label]) {
      return calendar().contains("button", new RegExp(`^${presets[range.label]}$`)).click();
    }
    this.pickCalendarDay(calendar, range.startDate);
    this.pickCalendarDay(calendar, range.endDate);
    return calendar().contains("button", /^Retrieve$/).click();
  }

  // Steps the calendar to `date`'s month ("Go to previous/next month"), then
  // clicks that day. The grid also shows the neighbouring months' days, so
  // the day is counted from the month's own "1" - the first cell reading 1.
  pickCalendarDay(calendar, date) {
    const [year, month, day] = date.split("-").map(Number);
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const target = `${months[month - 1]} ${year}`;

    const stepTo = (stepsLeft) =>
      calendar()
        .find('[aria-live="polite"]')
        .invoke("text")
        .then((shown) => {
          if (shown.trim() === target) return;
          if (stepsLeft === 0) throw new Error(`Calendar never reached ${target} (still on ${shown}).`);
          const [name, shownYear] = shown.trim().split(" ");
          const back = Number(shownYear) * 12 + months.indexOf(name) > year * 12 + (month - 1);
          calendar().find(`button[name="${back ? "previous-month" : "next-month"}"]`).click();
          calendar().find('[aria-live="polite"]').should("not.have.text", shown);
          stepTo(stepsLeft - 1);
        });
    stepTo(24);

    return calendar()
      .find('button[name="day"]')
      .then(($days) => {
        const first = $days.toArray().findIndex((el) => el.textContent.trim() === "1");
        cy.wrap($days.eq(first + day - 1)).click();
      });
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
