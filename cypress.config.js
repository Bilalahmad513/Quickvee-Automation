const fs = require("fs");
const path = require("path");
const { defineConfig } = require("cypress");
const { findExportEmail } = require("./cypress/support/exportEmail");

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
    // A failed test fails straight away - one attempt, no re-runs (on request,
    // for now). It used to be re-run up to twice, since this machine's slow,
    // low-memory page loads regularly fail one attempt and pass the next with
    // no code change - set { runMode: 2, openMode: 2 } to go back to that.
    retries: { runMode: 0, openMode: 0 },
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
