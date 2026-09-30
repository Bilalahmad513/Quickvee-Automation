const loginPage = require("../pages/LoginPage");

describe("Merchant Login", () => {
  it("logs in successfully with valid super admin credentials", () => {
    loginPage.login(
      Cypress.env("storeName"),
      Cypress.env("username"),
      Cypress.env("password")
    );

    // Give the login API a generous window - the default 4s assertion
    // timeout can fire while the create_session request is still in flight
    // on a slower response.
    cy.url({ timeout: 15000 }).should("not.include", "/login");
  });
});
