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
//
// In all three pickers the menu can open before its items have loaded -
// confirmed live (one attempt per test): the Stores menu was there but its
// "All Stores" item took longer than the default 4s. So the item lookup
// gets the same 15s as the menu.
// Opens the Stores menu. A click can be lost while the picker re-renders
// (confirmed live on the test server, 20 Nov 2026: right after the page
// loaded or a date preset was clicked, the click focused the trigger but no
// menu opened) - so the click is tried again, a few times, until the menu
// is there.
function openStoresFilterMenu(attemptsLeft = 5) {
  storesFilterTrigger().should("be.visible").click();
  return cy.wait(1000, { log: false }).then(() =>
    cy.get("body").then(($body) => {
      if ($body.find('[data-testid="multi-location-menu"]:visible').length) return;
      if (attemptsLeft <= 1) throw new Error("The Stores menu never opened.");
      return openStoresFilterMenu(attemptsLeft - 1);
    })
  );
}

function selectAllInStoresFilter() {
  openStoresFilterMenu();
  cy.get('[data-testid="multi-location-menu"]', { timeout: 15000 })
    .contains('li[role="menuitem"]', /^All Stores$/, { timeout: 15000 })
    .then(($item) => {
      if (!$item.find(".Mui-checked").length) cy.wrap($item).click();
    });
  cy.get("body").click(0, 0);
  storesFilterTrigger().should("have.text", "All Stores");
  return cy.contains("button", /^Search$/).click();
}

// Leaves only the store named `name` ticked in the "Stores" menu (any case),
// closes it and runs the report with "Search". Each store is an
// li[role="menuitem"] with a checkbox and its name (confirmed live, test
// server). The picker won't untick its last ticked store (confirmed live:
// unticking the only store, then ticking another, left "2 stores
// selected"), so `name` is ticked first, then "All Stores" and every other
// store unticked.
function selectOnlyStoreInStoresFilter(name) {
  const wanted = name.trim().toLowerCase();
  const menu = () => cy.get('[data-testid="multi-location-menu"]', { timeout: 15000 });
  const isTicked = (li) => Boolean(li.querySelector(".Mui-checked, input[type=checkbox]:checked"));
  const label = (li) => li.textContent.trim();
  const storeItems = ($menu) =>
    $menu
      .find('li[role="menuitem"]')
      .toArray()
      .filter((li) => li.querySelector("input[type=checkbox]"));
  const clickItem = (text) => menu().contains('li[role="menuitem"]', new RegExp(`^${Cypress._.escapeRegExp(text)}$`, "i")).click();

  openStoresFilterMenu();
  menu().then(($menu) => {
    const target = storeItems($menu).find((li) => label(li).toLowerCase() === wanted);
    expect(target, `"${name}" in the Stores menu`).to.exist;
    if (!isTicked(target)) clickItem(label(target));
  });
  // "All Stores" first (it ticks/unticks the rest), then each other store -
  // looked up afresh each time, as every click redraws the menu.
  ["All Stores", null].forEach((only) => {
    menu().then(($menu) => {
      storeItems($menu)
        .filter((li) => (only ? label(li) === only : label(li) !== "All Stores" && label(li).toLowerCase() !== wanted))
        .map(label)
        .forEach((text) =>
          menu().then(($now) => {
            const li = storeItems($now).find((el) => label(el) === text);
            if (li && isTicked(li)) clickItem(text);
          })
        );
    });
  });
  menu().then(($menu) => {
    const target = storeItems($menu).find((li) => label(li).toLowerCase() === wanted);
    if (target && !isTicked(target)) clickItem(label(target));
  });
  cy.get("body").click(0, 0);
  storesFilterTrigger().invoke("text").should((text) => expect(text.trim().toLowerCase()).to.equal(wanted));
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
    .contains('li[role="menuitem"]', /^All$/, { timeout: 15000 })
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
    .contains("button", /^(Select|Deselect) All$/, { timeout: 15000 })
    .then(($button) => {
      if ($button.text() === "Deselect All") cy.wrap($button).click();
    });
  cy.get('[role="dialog"]').contains("button", /^Select All$/).click();
  return cy.get("body").type("{esc}");
}

// Same popover, leaving only the store the session is in: "Deselect All"
// keeps the current store (confirmed live on the Item Sold and Category Sold
// reports - the page then asked for Store B alone), so no store is clicked
// by name.
function selectCurrentStoreInSelectAllPopover(trigger) {
  trigger().click();
  cy.get('[role="dialog"]', { timeout: 15000 })
    .contains("button", /^(Select|Deselect) All$/, { timeout: 15000 })
    .then(($button) => {
      if ($button.text() === "Deselect All") cy.wrap($button).click();
    });
  return cy.get("body").type("{esc}");
}

module.exports = {
  storesFilterTrigger,
  openStoresFilterMenu,
  selectAllInStoresFilter,
  selectOnlyStoreInStoresFilter,
  outletDropDownTrigger,
  selectAllInOutletDropDown,
  selectAllInSelectAllPopover,
  selectCurrentStoreInSelectAllPopover,
};
