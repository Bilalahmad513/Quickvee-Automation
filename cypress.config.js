const { defineConfig } = require("cypress");

module.exports = defineConfig({
  e2e: {
    baseUrl: "https://admin-panel-test.quickvee.us",
    viewportWidth: 1920,
    viewportHeight: 1080,
    // `cypress run` (used instead of `cypress open` - see scripts/run-cypress.js
    // for why) doesn't keep each test's step-by-step command log in the UI
    // once it passes, to save memory. Recording video means passed tests can
    // still be reviewed afterward by watching the recording, not just by
    // reading screenshots (which only get captured on failure).
    video: true,
    setupNodeEvents(on, config) {
      on("task", {
        log(message) {
          console.log(message);
          return null;
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
