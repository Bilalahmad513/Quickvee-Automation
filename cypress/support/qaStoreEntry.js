const loginPage = require("../pages/LoginPage");
const storeDirectoryPage = require("../pages/StoreDirectoryPage");

// Logs in to QA as super admin and opens one exact store - matched by its
// Merchant ID cell, never by the first search result (searching "Veon01"
// also lists VEON015). Inactive Stores is searched first, then Live Stores.
// The directory search is unreliable on QA (seen live: "No Data Found" for a
// store the same search found a minute earlier), so each list is searched by
// name, then by merchant id, up to 3 times. Credentials: qaStoreName /
// qaUsername / qaPassword in cypress.env.json.
// Yields { list, term, tries } - where the store was found.
const LISTS = ["Inactive", "Live"];

function openList(list) {
  return list === "Inactive" ? storeDirectoryPage.goToInactiveStores() : storeDirectoryPage.goToLiveStores();
}

// Waits for the search to settle: the store's row, or "No Data Found", or
// rows that don't match (a stale list). Yields the row element or null.
function searchOnce(list, term, merchantId, notes) {
  openList(list);
  storeDirectoryPage.search(term);
  return cy
    .get("body", { timeout: 25000 })
    .should(($body) => {
      const hasRow = $body.find("tbody tr td").toArray().some((td) => td.textContent.trim() === merchantId);
      const empty = /No Data Found/i.test($body.text());
      const rows = $body.find("tbody tr").length;
      expect(hasRow || empty || rows > 0, "store list settled").to.equal(true);
    })
    .then(($body) => {
      // Give a stale list a moment to refilter before judging it.
      const hasRow = () => Cypress.$("tbody tr td").toArray().some((td) => td.textContent.trim() === merchantId);
      if (hasRow()) return Cypress.$("tbody tr td").toArray().find((td) => td.textContent.trim() === merchantId).closest("tr");
      return cy.wait(4000, { log: false }).then(() => {
        if (hasRow()) return Cypress.$("tbody tr td").toArray().find((td) => td.textContent.trim() === merchantId).closest("tr");
        notes.push(`${list} Stores, search "${term}": ${/No Data Found/i.test(Cypress.$("body").text()) ? "No Data Found" : `${Cypress.$("tbody tr").length} other rows`}`);
        return null;
      });
    });
}

function enterQaStore(storeName, merchantId) {
  const notes = [];
  const attempts = [];
  LISTS.forEach((list) => [1, 2, 3].forEach((tries) => [storeName, merchantId].forEach((term) => attempts.push({ list, term, tries }))));

  function tryNext(i) {
    if (i >= attempts.length) throw new Error(`${storeName} (${merchantId}) not found in Inactive or Live Stores.\n${notes.join("\n")}`);
    const a = attempts[i];
    return searchOnce(a.list, a.term, merchantId, notes).then((row) => {
      if (!row) return tryNext(i + 1);
      cy.wrap(row).find('span.qv-users-directory-icon[title="View"]').click();
      return cy.url({ timeout: 60000 }).should("not.include", "/users/").then(() => ({ ...a, notes }));
    });
  }

  cy.clearAllCookies();
  cy.clearAllLocalStorage();
  cy.clearAllSessionStorage();
  return login(2).then(() => tryNext(0));
}

// QA's login API (create_session) was seen taking over 30s - waits 90s,
// and logs in once more if it still hasn't answered.
function login(triesLeft) {
  cy.intercept("POST", /\/LoginApiReact\/create_session/).as("qaLogin");
  loginPage.visit();
  loginPage.fillStoreName(Cypress.env("qaStoreName"));
  loginPage.fillUsername(Cypress.env("qaUsername"));
  loginPage.fillPassword(Cypress.env("qaPassword"));
  loginPage.submit();
  return cy.wait("@qaLogin", { timeout: 90000, requestTimeout: 30000, responseTimeout: 90000 }).then(({ response }) => {
    const body = response && (typeof response.body === "string" ? Cypress._.attempt(JSON.parse, response.body) : response.body);
    if ((!response || response.statusCode >= 500) && triesLeft > 1) return login(triesLeft - 1);
    expect(response && response.statusCode, `QA login answered (${JSON.stringify(body && body.message)})`).to.equal(200);
    return cy.url({ timeout: 60000 }).should("not.include", "/login");
  });
}

module.exports = { enterQaStore };
