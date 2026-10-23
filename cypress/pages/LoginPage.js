class LoginPage {
  // The page's `load` event fires before React has rendered the form, and on
  // a slow load that gap alone outlasted the default 4s lookup timeout.
  visit() {
    cy.visit("/merchants/login");
    cy.get('input[name="storename"]', { timeout: 30000 }).should("be.visible");
    return this;
  }

  getStoreNameInput() {
    return cy.get('input[name="storename"]');
  }

  getUsernameInput() {
    return cy.get('input[name="username"]');
  }

  getPasswordInput() {
    return cy.get('input[name="password"]');
  }

  getLoginButton() {
    return cy.contains("button", "Login");
  }

  fillStoreName(storeName) {
    this.getStoreNameInput().clear().type(storeName);
    return this;
  }

  fillUsername(username) {
    this.getUsernameInput().clear().type(username);
    return this;
  }

  fillPassword(password) {
    this.getPasswordInput().clear().type(password, { log: false });
    return this;
  }

  submit() {
    this.getLoginButton().click();
    return this;
  }

  login(storeName, username, password) {
    this.visit();
    this.fillStoreName(storeName);
    this.fillUsername(username);
    this.fillPassword(password);
    this.submit();
    // Without this, whatever runs next (e.g. the store directory's sidebar
    // lookup) started its own 4s timer the moment Login was clicked - so the
    // login API, redirect and dashboard render all had to fit inside it.
    cy.url({ timeout: 30000 }).should("not.include", "/login");
    return this;
  }
}

module.exports = new LoginPage();
