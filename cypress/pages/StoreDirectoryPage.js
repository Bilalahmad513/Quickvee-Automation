class StoreDirectoryPage {
  // The sidebar's "Users" section is a collapsible accordion
  // (aria-expanded="false" when closed); its sub-links ("Live Stores",
  // "Inactive Stores", ...) are not even rendered in the DOM until it is
  // expanded. It can end up collapsed again after other interactions on the
  // page, so this is checked/expanded before every navigation attempt rather
  // than just once.
  //
  // Generous timeouts throughout this class: right after login (or after
  // "Back to Super Admin") the sidebar and the directory table render only
  // once the app's own API calls return, which on a slow load regularly
  // outlasted the default 4s and failed session setup.
  ensureUsersMenuExpanded() {
    return cy.get('[title="Users"]', { timeout: 30000 }).then(($trigger) => {
      if ($trigger.attr("aria-expanded") !== "true") {
        return cy.wrap($trigger).click({ force: true });
      }
    });
  }

  goToInactiveStores() {
    this.ensureUsersMenuExpanded();
    // The sidebar link for the currently-active page gets `pointer-events:
    // none`, so a plain click is rejected by Cypress's actionability checks
    // when we're already there right after login - force it through either way.
    return cy.contains(/^Inactive Stores$/, { timeout: 15000 }).click({ force: true });
  }

  goToLiveStores() {
    this.ensureUsersMenuExpanded();
    return cy.contains(/^Live Stores$/, { timeout: 15000 }).click({ force: true });
  }

  search(term) {
    return cy.get('input[placeholder*="Search" i]', { timeout: 20000 }).clear().type(term);
  }

  // The list re-filters asynchronously after typing (debounced), so right
  // after typing the table can still show the old, unfiltered page for a
  // moment. Waiting for "any row" is not a safe settle signal, since the
  // stale unfiltered list always has rows too - so this waits specifically
  // for either the empty state or a row that actually contains the search
  // term itself.
  waitForResultsToSettle(term) {
    return cy.get("body", { timeout: 10000 }).should(($body) => {
      const text = $body.text().toLowerCase();
      const settled = text.includes("no data found") || text.includes(term.toLowerCase());
      expect(settled).to.equal(true);
    });
  }

  isShowingNoResults() {
    return cy.get("body").then(($body) => $body.text().includes("No Data Found"));
  }

  // The site used to render this as `<img class="view">`; it now renders as
  // `<span class="qv-users-directory-icon" title="View">` wrapping an inline
  // SVG - confirmed live via a DOM dump after `img.view` started reliably
  // finding nothing.
  clickViewIconForFirstResult() {
    return cy.get('span.qv-users-directory-icon[title="View"]', { timeout: 15000 }).first().click();
  }

  // Searches Inactive Stores first, falling back to Live Stores, then opens
  // the matching store's own admin view via the eye/View icon. This is the
  // same flow store-view.cy.js tests explicitly step by step - this version
  // is for specs that just need to land inside a given store as a
  // precondition, not for testing the search/fallback behavior itself.
  enterStore(storeName) {
    this.goToInactiveStores();
    this.search(storeName);
    this.waitForResultsToSettle(storeName);

    this.isShowingNoResults().then((notFoundInInactive) => {
      if (notFoundInInactive) {
        this.goToLiveStores();
        this.search(storeName);
        return this.waitForResultsToSettle(storeName);
      }
    });

    cy.contains(storeName, { matchCase: false, timeout: 15000 }).should("be.visible");
    this.clickViewIconForFirstResult();
    return cy.contains("Back to Super Admin", { timeout: 15000 }).should("be.visible");
  }

  // Leaves the current store's admin view for the super admin view, from
  // where enterStore() can open a different store without logging in again.
  backToSuperAdmin() {
    cy.contains("Back to Super Admin", { timeout: 15000 }).click();
    return cy.get('[title="Users"]', { timeout: 30000 }).should("exist");
  }
}

module.exports = new StoreDirectoryPage();
