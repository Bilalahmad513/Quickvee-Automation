// Store pickers shared by several report pages - the same picker component
// shows up on more than one page, so selecting every store in it is written
// once here and used by each page object.

// The "Stores" filter (MUI menu) on Sales by Category, Overall Sales Summary
// and the Hourly Sales Report. Pages open with only the current store
// selected.
function storesFilterTrigger() {
  return cy.get(".qv-report-filter__stores .qv-multi-location__trigger", { timeout: 30000 });
}

// Ticks "All Stores" (only if it isn't ticked already - clicking it again
// would untick every store), closes the menu and runs the report with
// "Search".
function selectAllInStoresFilter() {
  storesFilterTrigger().click();
  cy.get('[data-testid="multi-location-menu"]', { timeout: 15000 })
    .contains('li[role="menuitem"]', /^All Stores$/)
    .then(($item) => {
      if (!$item.find(".Mui-checked").length) cy.wrap($item).click();
    });
  cy.get("body").click(0, 0);
  storesFilterTrigger().should("have.text", "All Stores");
  return cy.contains("button", /^Search$/).click();
}

// The "Outlet" dropdown (MUI popover) on Category Sales (Detailed) and the
// Discounts Report. Pages open with only the current store selected.
function outletDropDownTrigger() {
  return cy.get(".OutletDropDown .qv-multi-select", { timeout: 30000 });
}

// Ticks "All" (only if it isn't ticked already), closes the dropdown and
// runs the report with "Search". A page can have other dropdowns with their
// own hidden "All" item (confirmed live on Category Sales (Detailed)), so
// this only looks inside the menu that's actually open.
function selectAllInOutletDropDown() {
  outletDropDownTrigger().click();
  cy.get(".qv-multi-select__menu:visible", { timeout: 15000 })
    .contains('li[role="menuitem"]', /^All$/)
    .then(($item) => {
      if (!$item.find(".Mui-checked").length) cy.wrap($item).click();
    });
  cy.get("body").type("{esc}");
  cy.get(".qv-multi-select__menu:visible").should("not.exist");
  return cy.contains("button", /^Search$/).click();
}

// The popover with a "Select All" / "Deselect All" header button, on the
// Category Sold Report and the Location Report. Both open with every store
// already selected, which shows the button as "Deselect All" - the selection
// is cleared first then, so "Select All" is always really clicked. These
// pages reload their data on every change (no Search button).
function selectAllInSelectAllPopover(trigger) {
  trigger().click();
  cy.get('[role="dialog"]', { timeout: 15000 })
    .contains("button", /^(Select|Deselect) All$/)
    .then(($button) => {
      if ($button.text() === "Deselect All") cy.wrap($button).click();
    });
  cy.get('[role="dialog"]').contains("button", /^Select All$/).click();
  return cy.get("body").type("{esc}");
}

module.exports = {
  storesFilterTrigger,
  selectAllInStoresFilter,
  outletDropDownTrigger,
  selectAllInOutletDropDown,
  selectAllInSelectAllPopover,
};
