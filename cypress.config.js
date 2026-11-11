const fs = require("fs");
const path = require("path");
const { defineConfig } = require("cypress");
const { findExportEmail } = require("./cypress/support/exportEmail");
const { otpMailboxMark, findLoginOtp, readDeviceToken, saveDeviceToken } = require("./cypress/support/loginOtp");

module.exports = defineConfig({
  e2e: {
    baseUrl: "https://quickvee.com",
    viewportWidth: 1920,
    viewportHeight: 1080,
    // `cypress run` never keeps a passed test's step-by-step command log (it
    // only collects logs when interactive) - expanding passed tests step by
    // step needs `cypress open` (npm run cypress:open). Recording video means
    // passed `cypress run` tests can still be reviewed afterward by watching
    // the recording, not just by reading screenshots (only taken on failure).
    video: true,
    // A failed test is run once more before it counts as failed (user, 5 Nov
    // 2026) - e.g. the Orders page calendar that sometimes shuts mid-pick in
    // the interactive runner. Was 0 (3 Nov) and before that 2. The report
    // specs start each attempt with an empty list, so their HTML report only
    // shows the last attempt. An emailed export test that's re-run sends
    // another export email.
    retries: { runMode: 1, openMode: 1 },
    setupNodeEvents(on, config) {
      on("task", {
        log(message) {
          console.log(message);
          return null;
        },
        // Removes a file from the downloads folder (if it's there), so an
        // export test reads the file its own click downloaded - not one left
        // from an earlier run (`cypress open` keeps old downloads).
        deleteDownload(fileName) {
          fs.rmSync(path.join(config.downloadsFolder, fileName), { force: true });
          return null;
        },
        // Long-range exports are emailed instead of downloaded ("Your export
        // has been queued"). This waits for that email in the Gmail inbox the
        // exports go to (exportEmailUser / exportEmailAppPassword in
        // cypress.env.json) and yields its "Download Report" link and Rows.
        findExportEmail(options) {
          return findExportEmail({
            ...options,
            user: config.env.exportEmailUser,
            appPassword: config.env.exportEmailAppPassword,
          });
        },
        // Merchant login's one-time password (see cypress/support/loginOtp.js
        // and LoginPage.login): the OTP inbox is otpEmailUser /
        // otpEmailAppPassword in cypress.env.json.
        otpMailboxMark() {
          return otpMailboxMark({ user: config.env.otpEmailUser, appPassword: config.env.otpEmailAppPassword });
        },
        findLoginOtp({ fromUid }) {
          return findLoginOtp({ user: config.env.otpEmailUser, appPassword: config.env.otpEmailAppPassword, fromUid });
        },
        readDeviceToken(site) {
          return readDeviceToken(site);
        },
        saveDeviceToken(entry) {
          return saveDeviceToken(entry);
        },
      });

      // Chrome checks for updates in the background and, once a new build
      // is ready, can force-relaunch itself - which killed the automated
      // window mid-session here (observed Chrome silently jumping from 153
      // to 154 between runs). This is Chrome's own documented QA/testing
      // flag to suppress that "restart to update" behavior for the launched
      // instance.
      on("before:browser:launch", (browser, launchOptions) => {
        if (browser.family === "chromium") {
          launchOptions.args.push("--simulate-outdated-no-au='Tue, 31 Dec 2099 23:59:59 GMT'");
        }
        return launchOptions;
      });

      return config;
    },
  },
  // Real credentials live in cypress.env.json (gitignored - see
  // cypress.env.json.example for the shape). Cypress loads that file
  // automatically and merges it into Cypress.env(), so nothing else here
  // needs to change.
});
