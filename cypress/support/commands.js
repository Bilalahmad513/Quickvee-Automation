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
    ["loginAndEnterStore", storeName, username, storeUnderTest],
    () => {
      loginPage.login(storeName, username, password);
      storeDirectoryPage.enterStore(storeUnderTest);
    },
    { cacheAcrossSpecs: true }
  );
});

// Stores where tests may create data (products, categories, orders) - the
// "dataStores" list in cypress.env.json (an array, or "a,b"). Every other
// store is for checking reports only. No list means no store is allowed.
function dataStores() {
  const configured = Cypress.env("dataStores");
  if (Array.isArray(configured)) return configured;
  if (typeof configured === "string") return configured.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

// The only way tests that create data get into a store: enters
// storeUnderTest like loginAndEnterStore, but first fails the test - before
// anything is opened, let alone saved - unless that store is in dataStores.
// Keeps a store meant only for report checks from ever getting test
// products or orders, even if storeUnderTest is set to it by mistake.
Cypress.Commands.add("enterDataStore", () => {
  const store = Cypress.env("storeUnderTest");
  const allowed = dataStores();
  if (!allowed.includes(store)) {
    throw new Error(
      `Store "${store}" is not allowed for creating data (products, categories, orders). ` +
        `Allowed (dataStores in cypress.env.json): ${allowed.length ? allowed.join(", ") : "none"}.`
    );
  }
  return cy.loginAndEnterStore(Cypress.env("storeName"), Cypress.env("username"), Cypress.env("password"), store);
});
