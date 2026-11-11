// Merchant login (/merchants/login). Since 11 Nov 2026 it can ask for a
// one-time password after Store name / Username / Password (confirmed in the
// login page's own code):
//   1. "Login" -> the server answers otp_required and emails a 6-digit code
//      to the login's email; the form shows input[name="otp"] ("One-time
//      password"), "Resend code", "Trust this device", and the button turns
//      into "Verify & Sign In".
//   2. Code + "Verify & Sign In" -> logged in.
// The code is read from that email's Gmail inbox (cypress/support/
// loginOtp.js; otpEmailUser / otpEmailAppPassword in cypress.env.json).
// "Trust this device" is ticked, so the server returns a device token
// (localStorage "qv_device_token"); it's kept between runs and put back
// before the next login, so that one usually needs no code at all.

const DEVICE_TOKEN_KEY = "qv_device_token";

class LoginPage {
  // `site`: the site to log in to - baseUrl unless given (e.g. the test
  // server, https://admin-panel-test.quickvee.us).
  siteOf(site) {
    return (site || Cypress.config("baseUrl")).replace(/\/$/, "");
  }

  // The page's `load` event fires before React has rendered the form, and on
  // a slow load that gap alone outlasted the default 4s lookup timeout.
  // The device token kept from an earlier login on this site (if any) is put
  // back into localStorage, where the form reads it when Login is clicked.
  visit(site) {
    const origin = this.siteOf(site);
    cy.visit(`${origin}/merchants/login`);
    cy.get('input[name="storename"]', { timeout: 30000 }).should("be.visible");
    cy.task("readDeviceToken", origin, { log: false }).then((token) => {
      if (token) cy.window({ log: false }).then((win) => win.localStorage.setItem(DEVICE_TOKEN_KEY, token));
    });
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

  getOtpInput() {
    return cy.get('input[name="otp"]');
  }

  getLoginButton() {
    return cy.contains("button", "Login");
  }

  getVerifyButton() {
    return cy.contains("button", "Verify & Sign In");
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

  // Ticks "Trust this device" (an MUI checkbox inside its label) unless it
  // already is.
  trustThisDevice() {
    return cy
      .contains("label", "Trust this device")
      .find('input[type="checkbox"]')
      .then(($box) => {
        if (!$box.prop("checked")) cy.wrap($box).check({ force: true });
      });
  }

  // Reads the code from the email that arrived after `fromUid` (see
  // loginOtp.js), types it and clicks "Verify & Sign In".
  enterOtpFromEmail(fromUid) {
    this.trustThisDevice();
    cy.task("findLoginOtp", { fromUid }, { timeout: 200000 }).then(({ code, subject }) => {
      Cypress.log({ name: "otp", message: `one-time password from email "${subject}"` });
      this.getOtpInput().clear().type(code, { log: false });
    });
    this.getVerifyButton().click();
    return this;
  }

  login(storeName, username, password, { site } = {}) {
    const origin = this.siteOf(site);
    let mark = null;

    this.visit(origin);
    this.fillStoreName(storeName);
    this.fillUsername(username);
    this.fillPassword(password);
    // Where the OTP inbox stands before Login is clicked, so only a code
    // sent for this login can be used.
    cy.task("otpMailboxMark", null, { log: false, timeout: 60000 }).then((uid) => (mark = uid));
    this.submit();

    // Either straight in (a trusted device, or no OTP on this site), or the
    // one-time password box appears.
    cy.window({ timeout: 30000 })
      .should((win) => {
        const stillOnLogin = win.location.pathname.includes("/login");
        const askedForOtp = Boolean(win.document.querySelector('input[name="otp"]'));
        expect(!stillOnLogin || askedForOtp, "logged in, or asked for a one-time password").to.equal(true);
      })
      .then((win) => {
        if (win.document.querySelector('input[name="otp"]')) this.enterOtpFromEmail(mark);
      });

    // Without this, whatever runs next (e.g. the store directory's sidebar
    // lookup) started its own 4s timer the moment Login was clicked - so the
    // login API, redirect and dashboard render all had to fit inside it.
    cy.url({ timeout: 30000 }).should("not.include", "/login");

    // Keeps the device token the server gave (Trust this device) for the
    // next login on this site.
    cy.window({ log: false }).then((win) => {
      const token = win.localStorage.getItem(DEVICE_TOKEN_KEY);
      if (token) cy.task("saveDeviceToken", { site: origin, token }, { log: false });
    });
    return this;
  }
}

module.exports = new LoginPage();
