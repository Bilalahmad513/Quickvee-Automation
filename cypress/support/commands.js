// Custom Cypress commands go here.
const loginPage = require("../pages/LoginPage");
const storeDirectoryPage = require("../pages/StoreDirectoryPage");

// Caches the login + store-entry session (cookies/localStorage) keyed by the
// given credentials, so specs that just need to already be inside a store as
// a precondition (not testing login/store-view itself, which keep running
// those UI steps fresh every time) skip re-running them on every test -
// Cypress restores the cached session instead after the first run.
Cypress.Commands.add("loginAndEnterStore", (storeName, username, password, storeUnderTest) => {
  cy.session(
    // baseUrl is part of the key: a spec can run against another environment
    // (suite-level baseUrl), whose cookies a cached session wouldn't have.
    ["loginAndEnterStore", Cypress.config("baseUrl"), storeName, username, storeUnderTest],
    () => {
      loginPage.login(storeName, username, password);
      storeDirectoryPage.enterStore(storeUnderTest);
    },
    { cacheAcrossSpecs: true }
  );
});
