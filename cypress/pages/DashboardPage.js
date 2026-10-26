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

  // While the dashboard loads its data, a full-page loading backdrop
  // (.qv-dashboard-loading-backdrop) covers the controls - confirmed live
  // that clicking "Week" right after a page load failed because of it. The
  // backdrop can stay in the DOM while hidden, so this waits until none is
  // actually showing rather than until none exists.
  waitUntilLoaded() {
    return cy.get("body", { timeout: 30000 }).should(($body) => {
      const showing = $body.find(".qv-dashboard-loading-backdrop").filter((_, el) => {
        const style = el.ownerDocument.defaultView.getComputedStyle(el);
        return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0;
      });
      expect(showing.length, "dashboard loading overlay showing").to.equal(0);
    });
  }

  // The "VIEW BY" toggle: "Day", "Week" or "Month". Matched as the exact
  // text so it can't hit labels that merely contain the word.
  selectView(view) {
    this.waitUntilLoaded();
    return cy.contains(new RegExp(`^${view}$`), { timeout: 15000 }).click();
  }

  // Steps the current view back one period (previous day/week/month).
  goToPreviousPeriod() {
    this.waitUntilLoaded();
    return cy.contains(/^Previous$/, { timeout: 15000 }).click();
  }
}

module.exports = new DashboardPage();
