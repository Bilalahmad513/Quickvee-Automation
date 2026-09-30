class StoreDirectoryPage {
  // The sidebar's "Users" section is a collapsible accordion
  // (aria-expanded="false" when closed); its sub-links ("Live Stores",
  // "Inactive Stores", ...) are not even rendered in the DOM until it is
  // expanded. It can end up collapsed again after other interactions on the
  // page, so this is checked/expanded before every navigation attempt rather
  // than just once.
  ensureUsersMenuExpanded() {
    return cy.get('[title="Users"]').then(($trigger) => {
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
    return cy.contains(/^Inactive Stores$/).click({ force: true });
  }

  goToLiveStores() {
    this.ensureUsersMenuExpanded();
    return cy.contains(/^Live Stores$/).click({ force: true });
  }

  search(term) {
    return cy.get('input[placeholder*="Search" i]').clear().type(term);
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

  clickViewIconForFirstResult() {
    return cy.get("img.view").first().click();
  }
}

module.exports = new StoreDirectoryPage();
