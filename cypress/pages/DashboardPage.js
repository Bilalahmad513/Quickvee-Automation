// The dashboard remembers the last view it showed (Day/Week/Month and which
// date) in these sessionStorage keys - confirmed live: after Month + Previous,
// a fresh load of the page (even for another store) opened on that same
// previous month instead of today.
const REMEMBERED_VIEW_KEYS = ["qv_dashboard_activeType", "qv_dashboard_presentDate"];

class DashboardPage {
  // Opens the dashboard on its default view (Day, today) by dropping the
  // remembered view before the page's own scripts read it.
  visitOnToday() {
    return cy.visit("/merchants/dashboard", {
      onBeforeLoad(win) {
        REMEMBERED_VIEW_KEYS.forEach((key) => win.sessionStorage.removeItem(key));
      },
    });
  }

  // The "VIEW BY" toggle: "Day", "Week" or "Month". Matched as the exact
  // text so it can't hit labels that merely contain the word.
  selectView(view) {
    return cy.contains(new RegExp(`^${view}$`), { timeout: 15000 }).click();
  }

  // Steps the current view back one period (previous day/week/month).
  goToPreviousPeriod() {
    return cy.contains(/^Previous$/, { timeout: 15000 }).click();
  }
}

module.exports = new DashboardPage();
