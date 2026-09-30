class LoginPage {
  visit() {
    cy.visit("/merchants/login");
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
    return this;
  }
}

module.exports = new LoginPage();
