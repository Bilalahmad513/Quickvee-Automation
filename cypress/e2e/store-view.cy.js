const loginPage = require("../pages/LoginPage");
const storeDirectoryPage = require("../pages/StoreDirectoryPage");

describe("Store View", () => {
  it("finds a store under Users > Live/Inactive Stores and opens its store view", () => {
    const storeName = Cypress.env("storeUnderTest");

    loginPage.login(
      Cypress.env("storeName"),
      Cypress.env("username"),
      Cypress.env("password")
    );

    // 1. Search Inactive Stores first.
    storeDirectoryPage.goToInactiveStores();
    storeDirectoryPage.search(storeName);
    storeDirectoryPage.waitForResultsToSettle(storeName);

    // 2. Not found there? Fall back to Live Stores and search again.
    // The cy chain built inside the branch has to be `return`ed, otherwise
    // Cypress does not reliably schedule it before the commands that follow
    // this .then() - a well-known Cypress conditional-testing gotcha.
    storeDirectoryPage.isShowingNoResults().then((notFoundInInactive) => {
      if (notFoundInInactive) {
        storeDirectoryPage.goToLiveStores();
        storeDirectoryPage.search(storeName);
        return storeDirectoryPage.waitForResultsToSettle(storeName);
      }
    });

    // 3. The store should now be visible in whichever tab it was found.
    cy.contains(storeName, { matchCase: false }).should("be.visible");

    // 4. Open it via the eye/View icon.
    storeDirectoryPage.clickViewIconForFirstResult();

    // Landing inside a store's own admin view shows this switch-back button,
    // which only appears once a specific store has been opened.
    cy.contains("Back to Super Admin", { timeout: 15000 }).should("be.visible");

    // The store's own header displays its formatted name ("Store B"), not the
    // raw login name used for searching ("storeb") - matching letter-by-letter
    // with optional whitespace between them tolerates that formatting gap.
    const escaped = storeName.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const flexibleNamePattern = new RegExp(escaped.split("").join("\\s*"), "i");
    cy.contains(flexibleNamePattern).should("be.visible");
  });
});
