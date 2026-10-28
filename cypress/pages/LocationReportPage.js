const { selectAllInSelectAllPopover } = require("./reportStorePickers");

// Reporting > Sales > Location Report. Opens with every store on the account
// already selected, and reloads its data on every change in the picker.
class LocationReportPage {
  visit() {
    cy.visit("/merchants/store-reporting/location-report");
    return this.locationsTrigger().should("be.visible");
  }

  // Reads "Locations (4)" - the number of stores on the account.
  locationsTrigger() {
    return cy.contains("button", /^Locations \(\d+\)$/, { timeout: 30000 });
  }

  selectAllLocations() {
    return selectAllInSelectAllPopover(() => this.locationsTrigger());
  }
}

module.exports = new LocationReportPage();
